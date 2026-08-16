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
import { homePaths } from "./home.js";
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

export type ConfigExplicitFields = {
  language: boolean;
  view: boolean;
  acpProviders: boolean;
  controlPlane: boolean;
};

export type ConfigDocument = {
  configPath: string;
  globalConfigPath: string;
  scopeRoot: string;
  revision: string;
  globalRevision: string;
  projectRevision: string;
  globalSource: string;
  projectSource: string;
  globalRaw: GlobalConfigFile;
  projectRaw: ProjectConfigFile;
  resolved: MemsphereConfig;
  explicit: ConfigExplicitFields;
};

export type EditableConfigDraft = {
  language?: "zh-CN" | "en";
  view?: { host: string; port: number };
  acp_providers?: AcpProviderConfigFile;
  control_plane?: ProjectControlPlaneConfigFile;
};

export type ConfigDraftValidation = {
  valid: boolean;
  errors: ConfigFieldError[];
  candidate?: { global: GlobalConfigFile; project: ProjectConfigFile };
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

export async function readConfigDocument(
  projectConfigPath: string,
  options: { globalConfigPath?: string; resolved: MemsphereConfig }
): Promise<ConfigDocument> {
  const globalConfigPath = options.globalConfigPath
    ?? homePaths(options.resolved.homeRoot).configPath;
  const [globalSource, projectSource] = await Promise.all([
    readOptionalConfig(globalConfigPath),
    readFile(projectConfigPath, "utf8")
  ]);
  const globalRaw = parseGlobalConfigSource(globalSource);
  const projectRaw = parseProjectConfigSource(projectSource);
  validateCombinedConfig(globalRaw, projectRaw);
  const globalRevision = configRevision(globalSource);
  const projectRevision = configRevision(projectSource);

  return {
    configPath: projectConfigPath,
    globalConfigPath,
    scopeRoot: dirname(projectConfigPath),
    revision: combinedRevision(globalRevision, projectRevision),
    globalRevision,
    projectRevision,
    globalSource,
    projectSource,
    globalRaw,
    projectRaw,
    resolved: options.resolved,
    explicit: {
      language: Object.hasOwn(globalRaw, "language"),
      view: Object.hasOwn(globalRaw, "view"),
      acpProviders: Object.hasOwn(globalRaw, "acp_providers"),
      controlPlane: Object.hasOwn(projectRaw, "control_plane")
    }
  };
}

export function editableConfigDraft(document: ConfigDocument): EditableConfigDraft {
  return {
    ...(document.globalRaw.language === undefined ? {} : { language: document.globalRaw.language }),
    ...(document.globalRaw.view === undefined ? {} : { view: structuredClone(document.globalRaw.view) }),
    ...(document.globalRaw.acp_providers === undefined
      ? {}
      : { acp_providers: structuredClone(document.globalRaw.acp_providers) }),
    ...(document.projectRaw.control_plane === undefined
      ? {}
      : { control_plane: structuredClone(document.projectRaw.control_plane) })
  };
}

export function validateConfigDraft(
  document: ConfigDocument,
  draft: EditableConfigDraft
): ConfigDraftValidation {
  const globalCandidate = {
    ...(draft.language === undefined ? {} : { language: draft.language }),
    ...(draft.view === undefined ? {} : { view: structuredClone(draft.view) }),
    ...(document.globalRaw.debug === undefined ? {} : { debug: structuredClone(document.globalRaw.debug) }),
    ...(draft.acp_providers === undefined ? {} : { acp_providers: structuredClone(draft.acp_providers) })
  };
  const projectCandidate = {
    store: structuredClone(document.projectRaw.store),
    ...(draft.control_plane === undefined ? {} : { control_plane: structuredClone(draft.control_plane) })
  };

  try {
    const global = globalConfigSchema.parse(globalCandidate);
    const project = projectConfigSchema.parse(projectCandidate);
    validateCombinedConfig(global, project);
    const normalized = normalizeDraft(global, project);
    return {
      valid: true,
      errors: [],
      candidate: { global, project },
      normalizedJson: `${JSON.stringify(normalized, null, 2)}\n`,
      changes: diffConfig(editableConfigDraft(document), normalized),
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

export async function writeConfigDraft(input: {
  document: ConfigDocument;
  expectedRevision: string;
  draft: EditableConfigDraft;
}): Promise<ConfigDocument> {
  const lockPath = join(dirname(input.document.globalConfigPath), ".runtime", "settings.lock");
  return withFileLock(lockPath, async () => {
    const latest = await readConfigDocument(input.document.configPath, {
      globalConfigPath: input.document.globalConfigPath,
      resolved: input.document.resolved
    });
    if (latest.revision !== input.expectedRevision) {
      throw new ConfigRevisionConflictError(input.expectedRevision, latest.revision);
    }
    const validation = validateConfigDraft(latest, input.draft);
    if (!validation.valid || !validation.candidate) {
      throw new ConfigDraftValidationError(validation.errors);
    }
    await atomicWriteJson(latest.globalConfigPath, validation.candidate.global);
    await atomicWriteJson(latest.configPath, validation.candidate.project);
    return readConfigDocument(latest.configPath, {
      globalConfigPath: latest.globalConfigPath,
      resolved: latest.resolved
    });
  });
}

export class ConfigDraftValidationError extends Error {
  constructor(readonly errors: ConfigFieldError[]) {
    super("config draft is invalid");
  }
}

export function configRevision(source: string | Buffer): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function combinedRevision(globalRevision: string, projectRevision: string): string {
  return configRevision(`${globalRevision}\n${projectRevision}`);
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

function parseProjectConfigSource(source: string): ProjectConfigFile {
  try {
    return projectConfigSchema.parse(JSON.parse(source));
  } catch (error) {
    throw parseConfigError(error);
  }
}

function validateCombinedConfig(global: GlobalConfigFile, project: ProjectConfigFile): void {
  if (project.control_plane) {
    resolveProjectControlPlane(project.control_plane, global.acp_providers);
  }
}

function normalizeDraft(global: GlobalConfigFile, project: ProjectConfigFile): EditableConfigDraft {
  return {
    ...(global.language === undefined ? {} : { language: global.language }),
    ...(global.view === undefined ? {} : { view: structuredClone(global.view) }),
    ...(global.acp_providers === undefined ? {} : { acp_providers: structuredClone(global.acp_providers) }),
    ...(project.control_plane === undefined ? {} : { control_plane: structuredClone(project.control_plane) })
  };
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
