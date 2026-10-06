import fs from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "../../api/context.js";
import {
  atomicPublish, FILESYSTEM_JSON_METADATA_DIRECTORY, isCode, readFileSnapshot,
  recordStateKey, requirePositiveInteger, validateFilename
} from "../shared/filesystem.js";

const FORMAT = "memsphere/filesystem-json-revision/1";
type RevisionState = { format: typeof FORMAT; filename: string; revision: number };
const REVISION_FILE = /^[a-f0-9]{64}\.revision\.json$/;
const LOCK_FILE = /^[a-f0-9]{64}\.lock$/;
const TEMP_FILE = /^\.memsphere-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

/** The caller holds this record's native lock, which also creates the directory. */
export async function readDeletedRevision(context: Context, directory: string, filename: string): Promise<number> {
  const metadata = join(directory, FILESYSTEM_JSON_METADATA_DIRECTORY);
  const stateName = `${recordStateKey(filename)}.revision.json`;
  const file = await readFileSnapshot(context, metadata, stateName);
  if (!file) return 0;
  const state = parseState(file.bytes, stateName);
  if (state.filename !== filename) throw new TypeError(`Record filename case alias conflicts with retained revision: ${filename} / ${state.filename}`);
  return state.revision;
}

/** Persist before unlink: interruption can retain extra history, never reuse it. */
export async function retainDeletedRevision(context: Context, directory: string, filename: string, revision: number): Promise<void> {
  const previous = await readDeletedRevision(context, directory, filename);
  if (previous >= revision) return;
  requirePositiveInteger(revision, "deleted record revision");
  const state: RevisionState = { format: FORMAT, filename, revision };
  await atomicPublish(context, join(directory, FILESYSTEM_JSON_METADATA_DIRECTORY), `${recordStateKey(filename)}.revision.json`,
    new TextEncoder().encode(`${JSON.stringify(state)}\n`), previous === 0 ? "create" : "replace");
}

/** Pure validation for explicit registration of a nonempty Store directory. */
export async function validateFilesystemJsonStoreMetadata(context: Context, directory: string): Promise<void> {
  context.signal?.throwIfAborted();
  const metadata = join(directory, FILESYSTEM_JSON_METADATA_DIRECTORY);
  try {
    if (!(await fs.lstat(metadata)).isDirectory()) throw new TypeError(`Store metadata must be a directory, not a symlink or file: ${metadata}`);
  } catch (error) {
    if (isCode(error, "ENOENT")) return;
    throw error;
  }
  for (const entry of await fs.readdir(metadata, { withFileTypes: true })) {
    context.signal?.throwIfAborted();
    if (!entry.isFile()) throw new TypeError(`Unknown filesystem JSON Store metadata: ${join(metadata, entry.name)}`);
    if (REVISION_FILE.test(entry.name)) {
      const file = await readFileSnapshot(context, metadata, entry.name);
      if (file) parseState(file.bytes, entry.name);
    } else if (LOCK_FILE.test(entry.name)) {
      if ((await fs.stat(join(metadata, entry.name))).size !== 0) throw new TypeError(`Invalid filesystem JSON Store lock file: ${entry.name}`);
    } else if (!TEMP_FILE.test(entry.name)) {
      throw new TypeError(`Unknown filesystem JSON Store metadata: ${join(metadata, entry.name)}`);
    }
  }
  context.signal?.throwIfAborted();
}

function parseState(bytes: Uint8Array, stateName: string): RevisionState {
  try {
    const state = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as RevisionState;
    if (!state || typeof state !== "object" || Array.isArray(state) || Object.keys(state).sort().join(",") !== "filename,format,revision" || state.format !== FORMAT) throw new TypeError("Invalid revision metadata format");
    validateFilename(state.filename);
    if (!state.filename.endsWith(".json") || `${recordStateKey(state.filename)}.revision.json` !== stateName) throw new TypeError("Revision metadata filename mismatch");
    validateFilename(state.filename.slice(0, -5));
    requirePositiveInteger(state.revision, "retained revision");
    return state;
  } catch (cause) {
    throw Object.assign(new Error(`Invalid retained revision metadata: ${stateName}`, { cause }), { code: "INVALID_STORE_METADATA" });
  }
}
