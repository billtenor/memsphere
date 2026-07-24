import { createHash } from "node:crypto";
import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ZodError } from "zod";
import {
  configSchema,
  parseConfigFile,
  readConfigAt,
  resolveConfigPath,
  type MemsphereConfig,
  type MemsphereConfigFile
} from "./config.js";

export type ConfigFieldError = {
  path: string;
  message: string;
};

export type ConfigChange = {
  path: string;
  before?: unknown;
  after?: unknown;
  kind: "added" | "removed" | "changed";
};

export type ConfigExplicitFields = {
  memoryRoot: boolean;
  reviewsRoot: boolean;
  runsRoot: boolean;
  archiveRoot: boolean;
  view: boolean;
  controlPlane: boolean;
};

export type ConfigDocument = {
  configPath: string;
  scopeRoot: string;
  revision: string;
  source: string;
  raw: MemsphereConfigFile;
  resolved: MemsphereConfig;
  explicit: ConfigExplicitFields;
};

export type EditableConfigDraft = {
  memoryRoot?: string;
  reviewsRoot?: string;
  runsRoot?: string;
  archiveRoot?: string;
  view?: {
    host: string;
    port: number;
  };
  control_plane?: unknown;
};

export type ConfigDraftValidation = {
  valid: boolean;
  errors: ConfigFieldError[];
  candidate?: MemsphereConfigFile;
  normalizedJson?: string;
  changes: ConfigChange[];
  resolvedPaths?: {
    memoryRoot: string;
    reviewsRoot: string;
    runsRoot: string;
    archiveRoot: string;
  };
};

export class ConfigRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: string,
    readonly actualRevision: string
  ) {
    super(`config revision conflict: expected ${expectedRevision}; current revision is ${actualRevision}`);
  }
}

export async function readConfigDocument(configPath: string): Promise<ConfigDocument> {
  const source = await readFile(configPath, "utf8");
  const parsed = parseConfigSource(source);
  parseConfigFile(parsed);
  const raw = structuredClone(parsed) as MemsphereConfigFile;
  const resolved = await readConfigAt(configPath);

  return {
    configPath,
    scopeRoot: dirname(configPath),
    revision: configRevision(source),
    source,
    raw,
    resolved,
    explicit: {
      memoryRoot: Object.hasOwn(raw, "memoryRoot"),
      reviewsRoot: Object.hasOwn(raw, "reviewsRoot"),
      runsRoot: Object.hasOwn(raw, "runsRoot"),
      archiveRoot: Object.hasOwn(raw, "archiveRoot"),
      view: Object.hasOwn(raw, "view"),
      controlPlane: Object.hasOwn(raw, "control_plane")
    }
  };
}

export function editableConfigDraft(document: ConfigDocument): EditableConfigDraft {
  return editableConfigFromRaw(document.raw);
}

function editableConfigFromRaw(raw: MemsphereConfigFile): EditableConfigDraft {
  return {
    ...(raw.memoryRoot === undefined ? {} : { memoryRoot: raw.memoryRoot }),
    ...(raw.reviewsRoot === undefined ? {} : { reviewsRoot: raw.reviewsRoot }),
    ...(raw.runsRoot === undefined ? {} : { runsRoot: raw.runsRoot }),
    ...(raw.archiveRoot === undefined ? {} : { archiveRoot: raw.archiveRoot }),
    ...(raw.view === undefined ? {} : { view: structuredClone(raw.view) }),
    ...(raw.control_plane === undefined ? {} : { control_plane: serializeControlPlaneInput(raw.control_plane) })
  };
}

export function validateConfigDraft(
  document: ConfigDocument,
  draft: EditableConfigDraft
): ConfigDraftValidation {
  const candidate = mergeEditableConfig(document.raw, draft);
  try {
    configSchema.parse(candidate);
    const normalizedJson = `${JSON.stringify(editableConfigFromRaw(candidate), null, 2)}\n`;
    return {
      valid: true,
      errors: [],
      candidate,
      normalizedJson,
      changes: diffConfig(document.raw, candidate),
      resolvedPaths: {
        memoryRoot: resolveConfigPath(candidate.memoryRoot ?? "memory", document.scopeRoot),
        reviewsRoot: resolveConfigPath(candidate.reviewsRoot ?? "reviews", document.scopeRoot),
        runsRoot: resolveConfigPath(candidate.runsRoot ?? "runs", document.scopeRoot),
        archiveRoot: resolveConfigPath(candidate.archiveRoot ?? "archives", document.scopeRoot)
      }
    };
  } catch (error) {
    return {
      valid: false,
      errors: configFieldErrors(error),
      changes: []
    };
  }
}

export async function writeConfigDraft(input: {
  document: ConfigDocument;
  expectedRevision: string;
  draft: EditableConfigDraft;
}): Promise<ConfigDocument> {
  const latest = await readConfigDocument(input.document.configPath);
  if (latest.revision !== input.expectedRevision) {
    throw new ConfigRevisionConflictError(input.expectedRevision, latest.revision);
  }

  const validation = validateConfigDraft(latest, input.draft);
  if (!validation.valid || !validation.candidate) {
    throw new ConfigDraftValidationError(validation.errors);
  }
  const serializedConfig = `${JSON.stringify(validation.candidate, null, 2)}\n`;

  const fileStat = await stat(latest.configPath);
  const temporaryPath = join(
    dirname(latest.configPath),
    `.${latest.configPath.split("/").at(-1)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    await writeFile(temporaryPath, serializedConfig, { encoding: "utf8", mode: fileStat.mode });
    const handle = await open(temporaryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    const beforeRename = await readConfigDocument(latest.configPath);
    if (beforeRename.revision !== input.expectedRevision) {
      throw new ConfigRevisionConflictError(input.expectedRevision, beforeRename.revision);
    }
    await rename(temporaryPath, latest.configPath);
    const directory = await open(dirname(latest.configPath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return readConfigDocument(latest.configPath);
}

export class ConfigDraftValidationError extends Error {
  constructor(readonly errors: ConfigFieldError[]) {
    super("config draft is invalid");
  }
}

export function configRevision(source: string | Buffer): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function mergeEditableConfig(
  current: MemsphereConfigFile,
  draft: EditableConfigDraft
): MemsphereConfigFile {
  return {
    ...(draft.memoryRoot === undefined ? {} : { memoryRoot: draft.memoryRoot }),
    ...(draft.reviewsRoot === undefined ? {} : { reviewsRoot: draft.reviewsRoot }),
    ...(draft.runsRoot === undefined ? {} : { runsRoot: draft.runsRoot }),
    ...(draft.archiveRoot === undefined ? {} : { archiveRoot: draft.archiveRoot }),
    ...(draft.view === undefined ? {} : { view: structuredClone(draft.view) }),
    ...(current.debug === undefined ? {} : { debug: structuredClone(current.debug) }),
    ...(draft.control_plane === undefined ? {} : {
      control_plane: structuredClone(draft.control_plane) as MemsphereConfigFile["control_plane"]
    })
  };
}

function parseConfigSource(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new ConfigDraftValidationError([{
      path: "",
      message: error instanceof Error ? error.message : String(error)
    }]);
  }
}

function configFieldErrors(error: unknown): ConfigFieldError[] {
  if (error instanceof ConfigDraftValidationError) return error.errors;
  if (error instanceof ZodError) {
    return error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
  }
  return [{ path: "", message: error instanceof Error ? error.message : String(error) }];
}

function diffConfig(before: unknown, after: unknown, path = ""): ConfigChange[] {
  if (Object.is(before, after)) return [];
  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].sort().flatMap((key) => {
      const childPath = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(before, key)) {
        return [{ path: childPath, after: structuredClone(after[key]), kind: "added" as const }];
      }
      if (!Object.hasOwn(after, key)) {
        return [{ path: childPath, before: structuredClone(before[key]), kind: "removed" as const }];
      }
      return diffConfig(before[key], after[key], childPath);
    });
  }
  if (Array.isArray(before) && Array.isArray(after) && JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{
    path,
    ...(before === undefined ? {} : { before: structuredClone(before) }),
    ...(after === undefined ? {} : { after: structuredClone(after) }),
    kind: before === undefined ? "added" : after === undefined ? "removed" : "changed"
  }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function serializeControlPlaneInput(value: unknown): unknown {
  const controlPlane = structuredClone(value);
  if (!isRecord(controlPlane) || !isRecord(controlPlane.actors)) return controlPlane;
  for (const actor of Object.values(controlPlane.actors)) {
    if (!isRecord(actor) || actor.kind !== "agent" || !isRecord(actor.agent)) continue;
    actor.agent = {
      provider: typeof actor.agent.provider === "string" ? actor.agent.provider : "traex",
      ...(typeof actor.agent.model === "string" ? { model: actor.agent.model } : {})
    };
  }
  return controlPlane;
}
