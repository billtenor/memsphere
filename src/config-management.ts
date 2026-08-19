import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ZodError, type z } from "zod";
import { globalConfigSchema, type MemsphereConfig } from "./config.js";
import {
  resolveProjectControlPlane,
  type AcpProviderConfigFile,
  type ProjectControlPlaneConfigFile
} from "./control-plane/index.js";
import { atomicWriteJson, withFileLock } from "./persistence.js";
import { projectConfigSchema, type ProjectConfigFile } from "./project/model.js";

export type ConfigFieldError = { path: string; message: string };

export type ConfigChange = {
  path: string;
  before?: unknown;
  after?: unknown;
  kind: "added" | "removed" | "changed";
};

type GlobalConfigFile = z.infer<typeof globalConfigSchema>;

export type GlobalConfigDocument = {
  configPath: string;
  scopeRoot: string;
  revision: string;
  source: string;
  raw: GlobalConfigFile;
};

export type ProjectConfigDocument = {
  configPath: string;
  scopeRoot: string;
  revision: string;
  source: string;
  raw: ProjectConfigFile;
  resolved: MemsphereConfig;
};

export type EditableGlobalConfigDraft = {
  language?: "zh-CN" | "en";
  view?: { host: string; port: number };
  acp_providers?: AcpProviderConfigFile;
};

export type EditableProjectConfigDraft = {
  control_plane?: ProjectControlPlaneConfigFile;
};

export type ProjectConfigReference = {
  name: string;
  config: ProjectConfigFile;
};

export type GlobalConfigDraftValidation = {
  valid: boolean;
  errors: ConfigFieldError[];
  candidate?: GlobalConfigFile;
  normalizedJson?: string;
  changes: ConfigChange[];
};

export type ProjectConfigDraftValidation = {
  valid: boolean;
  errors: ConfigFieldError[];
  candidate?: ProjectConfigFile;
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
  constructor(readonly expectedRevision: string, readonly actualRevision: string) {
    super(`config revision conflict: expected ${expectedRevision}; current revision is ${actualRevision}`);
  }
}

export class ConfigDraftValidationError extends Error {
  constructor(readonly errors: ConfigFieldError[]) {
    super("config draft is invalid");
  }
}

export async function readGlobalConfigDocument(configPath: string): Promise<GlobalConfigDocument> {
  const source = await readOptionalConfig(configPath);
  return {
    configPath,
    scopeRoot: dirname(configPath),
    revision: configRevision(source),
    source,
    raw: parseGlobalConfigSource(source)
  };
}

export async function readProjectConfigDocument(
  configPath: string,
  resolved: MemsphereConfig
): Promise<ProjectConfigDocument> {
  const source = await readFile(configPath, "utf8");
  return {
    configPath,
    scopeRoot: dirname(configPath),
    revision: configRevision(source),
    source,
    raw: parseProjectConfigSource(source),
    resolved
  };
}

export function editableGlobalConfigDraft(document: GlobalConfigDocument): EditableGlobalConfigDraft {
  return {
    ...(document.raw.language === undefined ? {} : { language: document.raw.language }),
    ...(document.raw.view === undefined ? {} : { view: structuredClone(document.raw.view) }),
    ...(document.raw.acp_providers === undefined
      ? {}
      : { acp_providers: structuredClone(document.raw.acp_providers) })
  };
}

export function editableProjectConfigDraft(document: ProjectConfigDocument): EditableProjectConfigDraft {
  return document.raw.control_plane === undefined
    ? {}
    : { control_plane: structuredClone(document.raw.control_plane) };
}

export function validateGlobalConfigDraft(
  document: GlobalConfigDocument,
  draft: EditableGlobalConfigDraft,
  projects: ProjectConfigReference[] = []
): GlobalConfigDraftValidation {
  const candidateInput = {
    ...(draft.language === undefined ? {} : { language: draft.language }),
    ...(draft.view === undefined ? {} : { view: structuredClone(draft.view) }),
    ...(document.raw.debug === undefined ? {} : { debug: structuredClone(document.raw.debug) }),
    ...(draft.acp_providers === undefined ? {} : { acp_providers: structuredClone(draft.acp_providers) })
  };

  try {
    const candidate = globalConfigSchema.parse(candidateInput);
    const referenceErrors = validateProjectReferences(document.raw, candidate, projects);
    if (referenceErrors.length) return { valid: false, errors: referenceErrors, changes: [] };
    const normalized = normalizeGlobalDraft(candidate);
    return {
      valid: true,
      errors: [],
      candidate,
      normalizedJson: `${JSON.stringify(normalized, null, 2)}\n`,
      changes: diffConfig(editableGlobalConfigDraft(document), normalized)
    };
  } catch (error) {
    return { valid: false, errors: configFieldErrors(error), changes: [] };
  }
}

export function validateProjectConfigDraft(
  document: ProjectConfigDocument,
  draft: EditableProjectConfigDraft,
  global: GlobalConfigFile
): ProjectConfigDraftValidation {
  const candidateInput = {
    store: structuredClone(document.raw.store),
    ...(draft.control_plane === undefined ? {} : { control_plane: structuredClone(draft.control_plane) })
  };

  try {
    const candidate = projectConfigSchema.parse(candidateInput);
    if (candidate.control_plane) resolveProjectControlPlane(candidate.control_plane, global.acp_providers);
    const normalized = normalizeProjectDraft(candidate);
    return {
      valid: true,
      errors: [],
      candidate,
      normalizedJson: `${JSON.stringify(normalized, null, 2)}\n`,
      changes: diffConfig(editableProjectConfigDraft(document), normalized),
      resolvedPaths: {
        memoryRoot: document.resolved.memoryRoot,
        reviewsRoot: document.resolved.reviewsRoot,
        runsRoot: document.resolved.runsRoot,
        archiveRoot: document.resolved.archiveRoot
      }
    };
  } catch (error) {
    return { valid: false, errors: configFieldErrors(error), changes: [] };
  }
}

export async function writeGlobalConfigDraft(input: {
  document: GlobalConfigDocument;
  expectedRevision: string;
  draft: EditableGlobalConfigDraft;
  projects?: ProjectConfigReference[] | (() => Promise<ProjectConfigReference[]>);
}): Promise<GlobalConfigDocument> {
  const lockPath = join(dirname(input.document.configPath), ".runtime", "settings.lock");
  return withFileLock(lockPath, async () => {
    const latest = await readGlobalConfigDocument(input.document.configPath);
    assertExpectedRevision(input.expectedRevision, latest.revision);
    const projects = typeof input.projects === "function" ? await input.projects() : input.projects;
    const validation = validateGlobalConfigDraft(latest, input.draft, projects);
    if (!validation.valid || !validation.candidate) throw new ConfigDraftValidationError(validation.errors);
    await atomicWriteJson(latest.configPath, validation.candidate);
    return readGlobalConfigDocument(latest.configPath);
  });
}

export async function writeProjectConfigDraft(input: {
  document: ProjectConfigDocument;
  expectedRevision: string;
  draft: EditableProjectConfigDraft;
  globalConfigPath: string;
}): Promise<ProjectConfigDocument> {
  const globalLockPath = join(dirname(input.globalConfigPath), ".runtime", "settings.lock");
  const projectLockPath = join(input.document.scopeRoot, ".runtime", "settings.lock");
  return withFileLock(globalLockPath, () => withFileLock(projectLockPath, async () => {
    const [latest, global] = await Promise.all([
      readProjectConfigDocument(input.document.configPath, input.document.resolved),
      readGlobalConfigDocument(input.globalConfigPath)
    ]);
    assertExpectedRevision(input.expectedRevision, latest.revision);
    const validation = validateProjectConfigDraft(latest, input.draft, global.raw);
    if (!validation.valid || !validation.candidate) throw new ConfigDraftValidationError(validation.errors);
    await atomicWriteJson(latest.configPath, validation.candidate);
    return readProjectConfigDocument(latest.configPath, latest.resolved);
  }));
}

export function configRevision(source: string | Buffer): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function assertExpectedRevision(expected: string, actual: string): void {
  if (expected !== actual) throw new ConfigRevisionConflictError(expected, actual);
}

function validateProjectReferences(
  previous: GlobalConfigFile,
  candidate: GlobalConfigFile,
  projects: ProjectConfigReference[]
): ConfigFieldError[] {
  const errors = projects.flatMap(({ name, config }) => {
    if (!config.control_plane) return [];
    try {
      resolveProjectControlPlane(config.control_plane, candidate.acp_providers);
      return [];
    } catch (error) {
      return [{
        path: `projects.${name}.control_plane`,
        message: `Project "${name}": ${error instanceof Error ? error.message : String(error)}`
      }];
    }
  });
  const removed = Object.keys(previous.acp_providers ?? {})
    .filter((provider) => !Object.hasOwn(candidate.acp_providers ?? {}, provider));
  for (const provider of removed) {
    for (const project of projects) {
      for (const [actorId, actor] of Object.entries(project.config.control_plane?.actors ?? {})) {
        if (actor.kind !== "agent" || actor.agent?.provider !== provider) continue;
        errors.push({
          path: `acp_providers.${provider}`,
          message: `ACP Provider "${provider}" is referenced by Project "${project.name}" Actor "${actorId}"`
        });
      }
    }
  }
  return errors;
}

async function readOptionalConfig(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isCode(error, "ENOENT")) return "{}\n";
    throw error;
  }
}

function parseGlobalConfigSource(source: string): GlobalConfigFile {
  try {
    return globalConfigSchema.parse(JSON.parse(source));
  } catch (error) {
    throw parseConfigError(error);
  }
}

export function parseProjectConfigSource(source: string): ProjectConfigFile {
  try {
    return projectConfigSchema.parse(JSON.parse(source));
  } catch (error) {
    throw parseConfigError(error);
  }
}

function normalizeGlobalDraft(global: GlobalConfigFile): EditableGlobalConfigDraft {
  return {
    ...(global.language === undefined ? {} : { language: global.language }),
    ...(global.view === undefined ? {} : { view: structuredClone(global.view) }),
    ...(global.acp_providers === undefined ? {} : { acp_providers: structuredClone(global.acp_providers) })
  };
}

function normalizeProjectDraft(project: ProjectConfigFile): EditableProjectConfigDraft {
  return project.control_plane === undefined
    ? {}
    : { control_plane: structuredClone(project.control_plane) };
}

function parseConfigError(error: unknown): Error {
  if (error instanceof ConfigDraftValidationError) return error;
  if (error instanceof SyntaxError) {
    return new ConfigDraftValidationError([{ path: "", message: error.message }]);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function configFieldErrors(error: unknown): ConfigFieldError[] {
  if (error instanceof ConfigDraftValidationError) return error.errors;
  if (error instanceof ZodError) {
    return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
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

function isCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
