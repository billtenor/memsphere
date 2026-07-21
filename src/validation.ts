import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { createArtifactReviewAssignments } from "./artifact-review.js";
import { configSchema, findConfigPath, readConfigAt, type MemsphereConfig } from "./config.js";
import {
  createControlPlaneSnapshot,
  mergeRoleBindings,
  resolveArtifactControlPlane,
  validateControlPlaneReferences,
  type ControlPlaneSnapshot,
  type PermissionGrants as ControlPlanePermissionGrants,
  type ResolvedRoleBindings
} from "./control-plane/index.js";
import type { FlowNode, PermissionGrants, ProcedureMemory } from "./memory/ast.js";
import { analyzeMemoryDescriptors } from "./memory/catalog.js";
import { memoryKinds, type MemoryKind } from "./memory/kinds.js";
import type { ProviderMemoryDescriptor } from "./memory/provider.js";
import { listMemoryFiles, pathExists, readMemoryFile, type MemoryFile } from "./memory/store.js";
import { currentMemorySyntax, readMemorySyntax } from "./memory/syntax.js";
import { parseMemoryYaml } from "./memory/yaml.js";
import { canMigrateMemorySyntax } from "./migration/memory-syntax-path.js";

export type ValidationIssue = {
  path: string;
  message: string;
  migration?: "syntax";
};

export type ValidationResult = {
  configPath: string;
  memoryRoot?: string;
  reviewsRoot?: string;
  runsRoot?: string;
  issues: ValidationIssue[];
};

export async function ensureMemoryDirectories(memoryRoot: string): Promise<void> {
  await mkdir(memoryRoot, { recursive: true });

  for (const kind of memoryKinds) {
    await mkdir(join(memoryRoot, kind), { recursive: true });
  }
}

function formatError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function validateMemoryStore(configPath?: string): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const resolvedConfigPath = configPath ?? await findConfigPath();

  if (!resolvedConfigPath || !(await pathExists(resolvedConfigPath))) {
    return {
      configPath: resolvedConfigPath ?? "(not found)",
      issues: [{ path: resolvedConfigPath ?? "(not found)", message: "config file does not exist. Run memsphere init." }]
    };
  }

  let memoryRoot: string | undefined;
  let reviewsRoot: string | undefined;
  let runsRoot: string | undefined;
  let config: MemsphereConfig;

  try {
    const parsedConfig = configSchema.safeParse(JSON.parse(await readFile(resolvedConfigPath, "utf8")));
    if (!parsedConfig.success) {
      return {
        configPath: resolvedConfigPath,
        issues: parsedConfig.error.issues.map((issue) => ({
          path: configIssuePath(resolvedConfigPath, issue.path),
          message: issue.message
        }))
      };
    }
    config = await readConfigAt(resolvedConfigPath);
    memoryRoot = config.memoryRoot;
    reviewsRoot = config.reviewsRoot;
    runsRoot = config.runsRoot;
  } catch (error) {
    return {
      configPath: resolvedConfigPath,
      issues: [{ path: resolvedConfigPath, message: formatError(error) }]
    };
  }

  if (!(await pathExists(memoryRoot))) {
    issues.push({ path: memoryRoot, message: "memory root does not exist" });
  }

  if (!(await pathExists(reviewsRoot))) {
    issues.push({ path: reviewsRoot, message: "reviews root does not exist" });
  }

  if (!(await pathExists(runsRoot))) {
    issues.push({ path: runsRoot, message: "runs root does not exist" });
  }

  const descriptors: ProviderMemoryDescriptor[] = [];
  const validFiles: MemoryFile[] = [];
  for (const kind of memoryKinds) {
    const dir = join(memoryRoot, kind);

    if (!(await pathExists(dir))) {
      issues.push({ path: dir, message: "memory kind directory does not exist" });
      continue;
    }

    descriptors.push(...await validateKindDirectory(memoryRoot, kind, issues, validFiles));
  }

  const catalogIssues = analyzeMemoryDescriptors(descriptors);
  for (const issue of catalogIssues) {
    issues.push({
      path: join(memoryRoot, issue.kind),
      message: issue.message
    });
  }

  validateControlPlaneMemories(validFiles, config.controlPlane ? createControlPlaneSnapshot(config.controlPlane) : undefined, issues);

  return {
    configPath: resolvedConfigPath,
    memoryRoot,
    reviewsRoot,
    runsRoot,
    issues
  };
}

async function validateKindDirectory(
  memoryRoot: string,
  kind: MemoryKind,
  issues: ValidationIssue[],
  validFiles: MemoryFile[]
): Promise<ProviderMemoryDescriptor[]> {
  let filePaths: string[];

  try {
    filePaths = await listMemoryFiles(memoryRoot, kind);
  } catch (error) {
    issues.push({
      path: join(memoryRoot, kind),
      message: formatError(error)
    });
    return [];
  }

  const descriptors: ProviderMemoryDescriptor[] = [];
  for (const filePath of filePaths) {
    try {
      const file = await readMemoryFile(kind, filePath);
      validFiles.push(file);
      descriptors.push({
        id: filePath,
        kind,
        names: [...file.entity.names],
        defines: structuredClone(file.entity.defines)
      });
    } catch (error) {
      issues.push({
        path: filePath,
        message: formatError(error),
        migration: await usesMigratableSyntax(filePath) ? "syntax" : undefined
      });
    }
  }
  return descriptors;
}

function configIssuePath(configPath: string, path: PropertyKey[]): string {
  let suffix = "";
  for (const part of path) {
    suffix += typeof part === "number" ? `[${part}]` : `${suffix ? "." : ""}${String(part)}`;
  }
  return suffix ? `${configPath}#${suffix}` : configPath;
}

function validateControlPlaneMemories(
  files: readonly MemoryFile[],
  snapshot: ControlPlaneSnapshot | undefined,
  issues: ValidationIssue[]
): void {
  for (const file of files) {
    if (file.entity.tag !== "!procedure") continue;
    const procedure = file.entity as ProcedureMemory;
    validateGovernanceFields({
      filePath: file.path,
      nodePath: "root",
      roleBindings: procedure.roleBindings,
      snapshot,
      issues
    });
    const procedureBindings = snapshot
      ? mergeRoleBindings({}, procedure.roleBindings, `${file.path}#root`)
      : {};
    validateFlowGovernance(procedure.flow, "flow", file.path, snapshot, procedureBindings, issues);
  }
}

function validateFlowGovernance(
  flow: readonly FlowNode[],
  path: string,
  filePath: string,
  snapshot: ControlPlaneSnapshot | undefined,
  procedureBindings: ResolvedRoleBindings,
  issues: ValidationIssue[]
): void {
  for (const [index, node] of flow.entries()) {
    const nodePath = `${path}[${index}]`;
    if (node.tag === "!action") {
      validateGovernanceFields({
        filePath,
        nodePath: `${nodePath}.artifact`,
        roleBindings: node.artifact.roleBindings,
        permissionGrants: node.artifact.permissionGrants,
        reviewPolicy: node.artifact.review,
        procedureBindings,
        snapshot,
        issues
      });
      continue;
    }
    if (node.tag === "!if") {
      validateGovernanceFields({
        filePath,
        nodePath: `${nodePath}.condition.artifact`,
        roleBindings: node.condition.artifact.roleBindings,
        permissionGrants: node.condition.artifact.permissionGrants,
        reviewPolicy: node.condition.artifact.review,
        procedureBindings,
        snapshot,
        issues
      });
      validateFlowGovernance(node.then, `${nodePath}.then`, filePath, snapshot, procedureBindings, issues);
      if (node.elseif) validateFlowGovernance([node.elseif], `${nodePath}.elseif`, filePath, snapshot, procedureBindings, issues);
      if (node.else) validateFlowGovernance(node.else, `${nodePath}.else`, filePath, snapshot, procedureBindings, issues);
      continue;
    }
    if (node.tag === "!while") {
      validateGovernanceFields({
        filePath,
        nodePath: `${nodePath}.condition.artifact`,
        roleBindings: node.condition.artifact.roleBindings,
        permissionGrants: node.condition.artifact.permissionGrants,
        reviewPolicy: node.condition.artifact.review,
        procedureBindings,
        snapshot,
        issues
      });
      validateFlowGovernance(node.do, `${nodePath}.do`, filePath, snapshot, procedureBindings, issues);
    }
  }
}

function validateGovernanceFields(input: {
  filePath: string;
  nodePath: string;
  roleBindings?: Record<string, string[]>;
  permissionGrants?: PermissionGrants;
  reviewPolicy?: string;
  procedureBindings?: ResolvedRoleBindings;
  snapshot: ControlPlaneSnapshot | undefined;
  issues: ValidationIssue[];
}): void {
  if (!input.roleBindings && !input.permissionGrants && !input.reviewPolicy) return;
  if (!input.snapshot) {
    input.issues.push({
      path: `${input.filePath}#${input.nodePath}`,
      message: "control_plane config is required when Memory declares role_bindings, permission_grants, or Artifact review"
    });
    return;
  }
  for (const issue of validateControlPlaneReferences({
    snapshot: input.snapshot,
    roleBindings: input.roleBindings,
    permissionGrants: input.permissionGrants,
    path: `${input.filePath}#${input.nodePath}`
  })) {
    input.issues.push(issue);
  }
  if (input.reviewPolicy) validateArtifactReviewGovernance(input);
}

function validateArtifactReviewGovernance(input: {
  filePath: string;
  nodePath: string;
  roleBindings?: Record<string, string[]>;
  permissionGrants?: PermissionGrants;
  reviewPolicy?: string;
  procedureBindings?: ResolvedRoleBindings;
  snapshot: ControlPlaneSnapshot | undefined;
  issues: ValidationIssue[];
}): void {
  if (!input.snapshot || !input.reviewPolicy) return;
  try {
    const controlPlane = resolveArtifactControlPlane({
      snapshot: input.snapshot,
      procedureBindings: input.procedureBindings ?? {},
      artifactBindings: input.roleBindings,
      permissionGrants: input.permissionGrants as ControlPlanePermissionGrants | undefined,
      artifactScope: `${input.filePath}#${input.nodePath}`,
      artifactBindingSource: `${input.filePath}#${input.nodePath}.role_bindings`,
      artifactGrantSource: `${input.filePath}#${input.nodePath}.permission_grants`
    });
    if (!controlPlane.permissions.runner?.effective.includes("artifact.read")) {
      throw new Error("Artifact Review requires runner artifact.read for run review wait");
    }
    createArtifactReviewAssignments({
      snapshot: input.snapshot,
      controlPlane,
      now: "1970-01-01T00:00:00.000Z"
    });
  } catch (error) {
    input.issues.push({
      path: `${input.filePath}#${input.nodePath}.review`,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function usesMigratableSyntax(filePath: string): Promise<boolean> {
  try {
    const entity = parseMemoryYaml(await readFile(filePath, "utf8"));
    const syntax = readMemorySyntax(entity);
    return canMigrateMemorySyntax(syntax, currentMemorySyntax);
  } catch {
    return false;
  }
}
