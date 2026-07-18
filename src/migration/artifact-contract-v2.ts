import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isMap, isSeq, type Document, type ParsedNode, type Scalar, type YAMLMap } from "yaml";
import type { MemsphereConfig } from "../config.js";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { memorySchemas } from "../memory/schema.js";
import { readMemoryFile } from "../memory/store.js";
import { parseMemoryYaml, parseMemoryYamlDocument } from "../memory/yaml.js";
import { listRuns } from "../run/store.js";

export type ArtifactContractMigrationIssue = {
  code: string;
  file: string;
  path: string;
  message: string;
};

export type ArtifactContractMigrationFile = {
  path: string;
  changed: boolean;
  sha256: string;
  outputSha256: string;
};

export type ArtifactContractMigrationManifest = {
  migration: "artifact-contract-v2";
  status: "ready" | "blocked";
  memoryRoot: string;
  files: ArtifactContractMigrationFile[];
  issues: ArtifactContractMigrationIssue[];
  generatedAt: string;
  backupRoot?: string;
};

type PreparedFile = ArtifactContractMigrationFile & {
  absolutePath: string;
  output: string;
};

type MigrationDocument = {
  path: string;
  absolutePath: string;
  source: string;
  document: Document.Parsed;
};

type ExternalSchemaDefinition = {
  file: string;
  path: string;
  names: string[];
  node: YAMLMap;
  document: Document.Parsed;
};

type ExternalSchemaConsumer = {
  file: string;
  path: string;
  schemaName: string;
  artifact: YAMLMap;
  document: Document.Parsed;
  legacy: boolean;
};

export async function checkArtifactContractV2Migration(
  config: MemsphereConfig,
  options: { includeRuns?: boolean } = {}
): Promise<{ manifest: ArtifactContractMigrationManifest; prepared: PreparedFile[] }> {
  const issues: ArtifactContractMigrationIssue[] = [];
  const documents: MigrationDocument[] = [];
  const dirty = new Set<Document.Parsed>();
  const externalConsumers: ExternalSchemaConsumer[] = [];

  for (const kind of memoryKinds) {
    const directory = join(config.memoryRoot, kind);
    for (const path of await listYamlFiles(directory)) {
      const source = await readFile(path, "utf8");
      const document = parseMemoryYamlDocument(source);
      const relativePath = relative(config.memoryRoot, path).replace(/\\/g, "/");
      documents.push({ path: relativePath, absolutePath: path, source, document });
      migrateDocument(document, relativePath, issues, dirty, externalConsumers);
    }
  }

  resolveExternalSchemas(documents, externalConsumers, issues, dirty);
  const prepared: PreparedFile[] = documents.map(({ path, absolutePath, source, document }) => {
    const output = dirty.has(document) ? document.toString({ lineWidth: 0 }) : source;
    return {
      path,
      absolutePath,
      changed: output !== source,
      sha256: sha256(source),
      outputSha256: sha256(output),
      output
    };
  });

  if (issues.length === 0) validatePreparedOutputs(prepared, issues);

  if (options.includeRuns !== false) {
    for (const run of await listRuns(config.runsRoot)) {
      if (run.contractVersion === 1 && run.status === "running") {
        issues.push({
          code: "migration.artifact.running_v1_run",
          file: run.id,
          path: "status",
          message: "running v1 Run must be completed, archived, or abandoned before migration"
        });
      }
    }
  }

  const manifest: ArtifactContractMigrationManifest = {
    migration: "artifact-contract-v2",
    status: issues.length ? "blocked" : "ready",
    memoryRoot: config.memoryRoot,
    files: prepared.map(({ absolutePath: _absolutePath, output: _output, ...file }) => file),
    issues,
    generatedAt: new Date().toISOString()
  };
  return { manifest, prepared };
}

function validatePreparedOutputs(
  prepared: PreparedFile[],
  issues: ArtifactContractMigrationIssue[]
): void {
  for (const file of prepared) {
    const kind = file.path.split("/")[0] as MemoryKind;
    const schema = memorySchemas[kind];

    try {
      const result = schema.safeParse(parseMemoryYaml(file.output));
      if (result.success) continue;
      for (const issue of result.error.issues) {
        issues.push({
          code: "migration.output.invalid",
          file: file.path,
          path: issue.path.join("."),
          message: issue.message
        });
      }
    } catch (error) {
      issues.push({
        code: "migration.output.invalid",
        file: file.path,
        path: "",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export async function writeArtifactContractV2Migration(config: MemsphereConfig): Promise<ArtifactContractMigrationManifest> {
  const lockPath = join(config.scopeRoot, "migrations", "artifact-contract-v2.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, "wx").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error(`Artifact Contract v2 migration is already running: ${lockPath}`);
    }
    throw error;
  });

  try {
    const { manifest, prepared } = await checkArtifactContractV2Migration(config);
    if (manifest.status !== "ready") {
      throw new Error(`Artifact Contract v2 migration is blocked by ${manifest.issues.length} issue(s)`);
    }
    const changed = prepared.filter((file) => file.changed);
    if (!changed.length) return manifest;

    const timestamp = manifest.generatedAt.replace(/[:.]/g, "-");
    const migrationRoot = join(config.scopeRoot, "migrations", "artifact-contract-v2", timestamp);
    const stagedRoot = join(migrationRoot, "staged");
    const backupRoot = join(migrationRoot, "backup");
    await mkdir(stagedRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    for (const file of prepared) {
      const stagedPath = join(stagedRoot, file.path);
      await mkdir(dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, file.output, "utf8");
    }
    await validateStagedRoot(stagedRoot);

    for (const file of changed) {
      const backupPath = join(backupRoot, file.path);
      await mkdir(dirname(backupPath), { recursive: true });
      await copyFile(file.absolutePath, backupPath);
    }

    const written: PreparedFile[] = [];
    try {
      for (const file of changed) {
        const tempPath = join(dirname(file.absolutePath), `.${basename(file.absolutePath)}.artifact-v2.tmp`);
        await writeFile(tempPath, file.output, "utf8");
        await rename(tempPath, file.absolutePath);
        written.push(file);
      }
      await validateRealRoot(config.memoryRoot);
    } catch (error) {
      for (const file of written.reverse()) await copyFile(join(backupRoot, file.path), file.absolutePath);
      throw error;
    }

    const completed = { ...manifest, backupRoot };
    await writeFile(join(migrationRoot, "manifest.json"), `${JSON.stringify(completed, null, 2)}\n`, "utf8");
    return completed;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

function migrateDocument(
  document: Document.Parsed,
  file: string,
  issues: ArtifactContractMigrationIssue[],
  dirty: Set<Document.Parsed>,
  externalConsumers: ExternalSchemaConsumer[]
): void {
  walk(document.contents as ParsedNode | null, "", (node, path) => {
    if (!isMap(node) || node.tag !== "!artifact") return;
    migrateArtifactMap(document, node, file, path, issues, dirty, externalConsumers);
  });
}

function migrateArtifactMap(
  document: Document.Parsed,
  artifact: YAMLMap,
  file: string,
  path: string,
  issues: ArtifactContractMigrationIssue[],
  dirty: Set<Document.Parsed>,
  externalConsumers: ExternalSchemaConsumer[]
): void {
  const schemaValue = artifact.get("schema", true) as ParsedNode | undefined;
  const schemaName = scalarString(schemaValue);
  const existingType = scalarString(artifact.get("type", true) as ParsedNode | undefined);
  if (existingType) {
    if (schemaName) externalConsumers.push({ file, path, schemaName, artifact, document, legacy: false });
    return;
  }
  const format = scalarString(artifact.get("format", true) as ParsedNode | undefined);
  if (!format) return;

  if (["boolean", "number", "string"].includes(format)) {
    if (format !== "string") artifact.set("type", format);
    artifact.delete("format");
    dirty.add(document);
    return;
  }
  if (format === "markdown") {
    return;
  }
  if (format === "json" || format === "yaml") {
    issues.push({
      code: "migration.artifact.structured_type_required",
      file,
      path: `${path}.type`,
      message: `${format} Artifact requires a manual object or array type`
    });
    return;
  }
  if (format !== "schema") {
    issues.push({ code: "migration.artifact.unknown_format", file, path: `${path}.format`, message: `Unknown v1 Artifact format: ${format}` });
    return;
  }

  if (schemaName) {
    externalConsumers.push({ file, path, schemaName, artifact, document, legacy: true });
    return;
  }
  if (!schemaValue || !isMap(schemaValue)) {
    issues.push({ code: "migration.artifact.schema_required", file, path: `${path}.schema`, message: "schema Artifact requires an inline or external Schema" });
    return;
  }
  const layout = scalarString(schemaValue.get("format", true) as ParsedNode | undefined) ?? "outline";
  if (layout !== "outline" && layout !== "table") {
    issues.push({ code: "migration.artifact.schema_layout", file, path: `${path}.schema.format`, message: `Unsupported Schema layout: ${layout}` });
    return;
  }
  artifact.set("type", layout === "table" ? "array" : "object");
  artifact.set("format", document.createNode({ name: "markdown", layout }));
  schemaValue.delete("format");
  dirty.add(document);
}

function resolveExternalSchemas(
  documents: MigrationDocument[],
  consumers: ExternalSchemaConsumer[],
  issues: ArtifactContractMigrationIssue[],
  dirty: Set<Document.Parsed>
): void {
  const definitions = documents.flatMap(collectExternalSchemaDefinitions);
  const consumed = new Set<YAMLMap>();
  for (const consumer of consumers) {
    const matches = definitions.filter((definition) => definition.names.includes(consumer.schemaName));
    if (matches.length !== 1) {
      issues.push({
        code: matches.length ? "migration.artifact.external_schema_ambiguous" : "migration.artifact.external_schema_missing",
        file: consumer.file,
        path: `${consumer.path}.schema`,
        message: `external Schema ${consumer.schemaName} resolved to ${matches.length} definitions`
      });
      continue;
    }
    const definition = matches[0];
    const layout = scalarString(definition.node.get("format", true) as ParsedNode | undefined) ?? "outline";
    if (layout !== "outline" && layout !== "table") {
      issues.push({ code: "migration.artifact.schema_layout", file: definition.file, path: `${definition.path}.format`, message: `Unsupported Schema layout: ${layout}` });
      continue;
    }
    if (consumer.legacy) {
      consumer.artifact.set("type", layout === "table" ? "array" : "object");
      consumer.artifact.set("format", consumer.document.createNode({ name: "markdown", layout }));
      dirty.add(consumer.document);
    } else if (!v2ConsumerMatchesLayout(consumer.artifact, layout)) {
      issues.push({
        code: "migration.artifact.external_schema_layout_conflict",
        file: consumer.file,
        path: consumer.path,
        message: `v2 Artifact contract does not match external Schema legacy layout ${layout}`
      });
      continue;
    }
    consumed.add(definition.node);
  }

  for (const definition of definitions) {
    const format = scalarString(definition.node.get("format", true) as ParsedNode | undefined);
    if (!format) continue;
    if (!consumed.has(definition.node)) {
      issues.push({
        code: "migration.artifact.orphan_schema_layout",
        file: definition.file,
        path: `${definition.path}.format`,
        message: `Schema layout ${format} has no resolvable Artifact consumer and must be migrated manually`
      });
      continue;
    }
    definition.node.delete("format");
    dirty.add(definition.document);
  }
}

function collectExternalSchemaDefinitions(source: MigrationDocument): ExternalSchemaDefinition[] {
  const root = source.document.contents as ParsedNode | null;
  if (!root || !isMap(root) || root.tag !== "!schema") return [];
  const namesNode = root.get("names", true) as ParsedNode | undefined;
  const names = isSeq(namesNode)
    ? namesNode.items.map((item) => scalarString(item as ParsedNode | undefined)).filter((name): name is string => Boolean(name))
    : [];
  return [{ file: source.path, path: "", names, node: root, document: source.document }];
}

function v2ConsumerMatchesLayout(artifact: YAMLMap, layout: "outline" | "table"): boolean {
  const expectedType = layout === "table" ? "array" : "object";
  const type = scalarString(artifact.get("type", true) as ParsedNode | undefined);
  const formatNode = artifact.get("format", true) as ParsedNode | undefined;
  if (!formatNode || !isMap(formatNode)) return false;
  return type === expectedType &&
    scalarString(formatNode.get("name", true) as ParsedNode | undefined) === "markdown" &&
    scalarString(formatNode.get("layout", true) as ParsedNode | undefined) === layout;
}

function walk(node: ParsedNode | null, path: string, visit: (node: ParsedNode, path: string) => void): void {
  if (!node) return;
  visit(node, path);
  if (isMap(node)) {
    for (const item of node.items) {
      const key = scalarString(item.key as ParsedNode | undefined) ?? "?";
      walk(item.value as ParsedNode | null, path ? `${path}.${key}` : key, visit);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => walk(item as ParsedNode | null, `${path}[${index}]`, visit));
  }
}

function scalarString(node: ParsedNode | undefined): string | undefined {
  const value = (node as Scalar | undefined)?.value;
  return typeof value === "string" ? value : undefined;
}

async function listYamlFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function validateStagedRoot(root: string): Promise<void> {
  await validateRealRoot(root);
}

async function validateRealRoot(root: string): Promise<void> {
  for (const kind of memoryKinds) {
    for (const path of await listYamlFiles(join(root, kind))) await readMemoryFile(kind as MemoryKind, path);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
