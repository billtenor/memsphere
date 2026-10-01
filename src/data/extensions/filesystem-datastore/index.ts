import type { Stats } from "node:fs";
import { Config } from "../../api/config.js";
import type { Context } from "../../api/context.js";
import type { Data, DataId, ModelRef } from "../../api/data.js";
import type { AppendableDataStore, DataStoreFactory, StoredData } from "../../api/data-store.js";
import type { DataExtension } from "../../api/extension.js";
import type { DeleteOptions, ListOptions, ListResult, StoreId, UpdateOptions } from "../../api/store.js";
import {
  appendFileContent, atomicPublish, cleanupCreatedDirectories, deleteFile, findFile, listRelativeFilenames, paginate, prepareDirectory,
  readFileSnapshot, requirePositiveInteger, requireString, resolveFileParent,
  validateFilename, validateRelativeFilePath
} from "../shared/filesystem.js";
import { bytesContent, throwIfAborted } from "../shared/payload.js";

const DEFAULT_CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  "application/json": [".json"],
  "application/octet-stream": [".bin"],
  "application/pdf": [".pdf"],
  "application/yaml": [".yaml", ".yml"],
  "image/gif": [".gif"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/svg+xml": [".svg"],
  "image/webp": [".webp"],
  "text/csv": [".csv"],
  "text/html": [".html", ".htm"],
  "text/markdown": [".md", ".markdown"],
  "text/plain": [".txt"]
};

/**
 * Raw, human-readable files: directory is the exact Store root and each ID is a
 * portable relative file path, including its extension, with '/' separators.
 * Files contain only Payload bytes; create makes missing parent directories.
 * contentTypeExtensions optionally overrides each type's default suffixes.
 *
 * No locks, private metadata or revision numbers are maintained. Complete-file
 * creation/replacement is atomic, but an update racing a delete can recreate the
 * file; callers coordinate conflicting operations. list reads names, not bodies.
 * Append writes progressively into the existing file; chunks may be visible
 * before EOF and survive a failure. Concurrent operations are not serialized.
 */
export class FilesystemDataStoreFactory implements DataStoreFactory {
  readonly id = "memsphere/filesystem";

  async createStore(context: Context, id: StoreId, model: ModelRef, config: Config): Promise<AppendableDataStore> {
    throwIfAborted(context);
    requireString(id, "store id");
    requireString(model, "model");
    // Snapshot and validate the entire configuration before the first await.
    const { directory, extensions } = parseConfig(config);
    const root = await prepareDirectory(context, new Config({ directory }));
    return new FilesystemDataStore(id, model, root, extensions);
  }
}

class FilesystemDataStore implements AppendableDataStore {
  readonly kind = "DataStore" as const;
  private readonly cursorScope: string;

  constructor(
    readonly id: StoreId,
    readonly model: ModelRef,
    private readonly directory: string,
    private readonly extensions: ReadonlyArray<readonly [string, string]>
  ) {
    this.cursorScope = JSON.stringify(["filesystem", id, directory, model, extensions]);
  }

  async get(context: Context, id: DataId): Promise<StoredData | undefined> {
    throwIfAborted(context);
    const contentType = this.requireContentType(id);
    const parent = await resolveFileParent(context, this.directory, id);
    if (!parent) return undefined;
    const snapshot = await readFileSnapshot(context, parent.directory, parent.filename);
    return snapshot && this.stored(id, contentType, snapshot.bytes, snapshot.stat);
  }

  async has(context: Context, id: DataId): Promise<boolean> {
    throwIfAborted(context);
    this.requireContentType(id);
    const parent = await resolveFileParent(context, this.directory, id);
    return parent !== undefined && (await findFile(context, parent.directory, parent.filename)) !== undefined;
  }

  async create(context: Context, data: Data): Promise<void> {
    await this.write(context, data, "create");
  }

  async update(context: Context, data: Data, options?: UpdateOptions): Promise<void> {
    rejectRevision(options?.expectedRevision);
    await this.write(context, data, "replace");
  }

  async append(context: Context, data: Data): Promise<void> {
    throwIfAborted(context);
    const { id, content } = this.writeTarget(data);
    const parent = await resolveFileParent(context, this.directory, id);
    if (!parent) throw Object.assign(new Error(`Data does not exist: ${id}`), { code: "ENOENT" });
    await appendFileContent(context, parent.directory, parent.filename, content);
  }

  async delete(context: Context, id: DataId, options?: DeleteOptions): Promise<boolean> {
    throwIfAborted(context);
    rejectRevision(options?.expectedRevision);
    this.requireContentType(id);
    const parent = await resolveFileParent(context, this.directory, id);
    return parent !== undefined && deleteFile(context, parent.directory, parent.filename);
  }

  /** Defaults to 100 IDs per page, at most 1,000, in ascending JS string order. */
  async list(context: Context, options?: ListOptions): Promise<ListResult> {
    throwIfAborted(context);
    const snapshot = options && { ...options };
    // Validate options even when the directory is empty, before starting I/O.
    paginate([], snapshot, this.cursorScope);
    const names = await listRelativeFilenames(context, this.directory);
    return paginate(names.filter((name) => this.contentType(name) !== undefined), snapshot, this.cursorScope);
  }

  private contentType(id: string): string | undefined {
    const lower = id.slice(id.lastIndexOf("/") + 1).toLowerCase();
    return this.extensions.find(([extension]) => lower.endsWith(extension))?.[1];
  }

  private requireContentType(id: DataId): string {
    validateRelativeFilePath(id);
    const contentType = this.contentType(id);
    if (!contentType) throw new TypeError(`No contentType configured for filename: ${id}`);
    return contentType;
  }

  private writeTarget(data: Data) {
    const { id, model, payload } = data;
    const { contentType, content } = payload;
    const expectedType = this.requireContentType(id);
    if (model !== this.model) throw new TypeError(`Data model does not match the store model: ${this.model}`);
    if (contentType !== expectedType) {
      throw new TypeError(`payload.contentType must match the filename mapping (${expectedType}): ${id}`);
    }
    return { id, content };
  }

  private async write(context: Context, data: Data, mode: "create" | "replace"): Promise<void> {
    throwIfAborted(context);
    const { id, content } = this.writeTarget(data);
    const createdDirectories: string[] = [];
    try {
      const parent = await resolveFileParent(context, this.directory, id, mode === "create", createdDirectories);
      if (!parent) throw Object.assign(new Error(`Data does not exist: ${id}`), { code: "ENOENT" });
      await atomicPublish(context, parent.directory, parent.filename, content, mode);
    } catch (error) {
      await cleanupCreatedDirectories(createdDirectories);
      throw error;
    }
  }

  private stored(id: DataId, contentType: string, bytes: Uint8Array, stat: Stats): StoredData {
    return {
      data: { id, model: this.model, payload: { contentType, content: bytesContent(bytes) } },
      updatedAt: stat.mtimeMs
    };
  }
}

function rejectRevision(expectedRevision: number | undefined): void {
  if (expectedRevision === undefined) return;
  requirePositiveInteger(expectedRevision, "expectedRevision");
  throw new Error("Filesystem DataStore does not support expectedRevision");
}

function parseConfig(config: Config): { directory: string; extensions: Array<readonly [string, string]> } {
  const json = config.json;
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new TypeError("config must be a JSON object");
  for (const key of Object.keys(json)) {
    if (key !== "directory" && key !== "contentTypeExtensions") throw new TypeError(`Unknown filesystem DataStore config field: ${key}`);
  }
  const directory = json.directory;
  requireString(directory, "config.directory");
  const mappings = new Map(Object.entries(DEFAULT_CONTENT_TYPE_EXTENSIONS));
  const configured = json.contentTypeExtensions;
  if (configured !== undefined) {
    if (typeof configured !== "object" || configured === null || Array.isArray(configured)) {
      throw new TypeError("config.contentTypeExtensions must be an object");
    }
    for (const [contentType, values] of Object.entries(configured)) {
      // Bare, lowercase MIME types make the filename-to-type mapping reversible.
      if (!/^[a-z0-9!#$%&'+.^_`|~-]+\/[a-z0-9!#$%&'+.^_`|~-]+$/.test(contentType)) {
        throw new TypeError(`contentTypeExtensions requires a canonical bare contentType: ${contentType}`);
      }
      if (!Array.isArray(values)) throw new TypeError(`Extensions for ${contentType} must be an array`);
      const extensions = values.map((extension) => {
        if (typeof extension !== "string" || !/^\.[a-z0-9][a-z0-9_+-]*(?:\.[a-z0-9][a-z0-9_+-]*)*$/i.test(extension)) {
          throw new TypeError(`Invalid filename extension for ${contentType}: ${String(extension)}`);
        }
        validateFilename(`file${extension}`);
        return extension.toLowerCase();
      });
      if (new Set(extensions).size !== extensions.length) throw new TypeError(`Duplicate extensions for ${contentType}`);
      mappings.set(contentType, extensions);
    }
  }
  const inverse = new Map<string, string>();
  for (const [contentType, extensions] of mappings) {
    for (const extension of extensions) {
      if (inverse.has(extension)) throw new TypeError(`Conflicting contentType mapping for extension: ${extension}`);
      inverse.set(extension, contentType);
    }
  }
  // Compound suffixes win over their shorter suffix, independent of config order.
  const extensions = [...inverse].sort(([left], [right]) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0));
  return { directory, extensions };
}

export const filesystemDataStoreExtension: DataExtension = {
  id: "memsphere/filesystem-datastore",
  version: "0.1.0",
  dataStoreFactories: [new FilesystemDataStoreFactory()]
};
