import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { isMap, isSeq, type Document, type ParsedNode, type Scalar, type YAMLMap, type YAMLSeq } from "yaml";
import type { MemsphereConfig } from "../config.js";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { memorySyntaxRegistry } from "../memory/schema.js";
import { currentMemorySyntax } from "../memory/syntax.js";
import { parseMemoryYaml, parseMemoryYamlDocument } from "../memory/yaml.js";
import { assertMigrationSourcesUnchanged, withMemoryStoreMigrationLock } from "./store-write.js";
import { validateMigrationOutputRoot } from "./validate-output.js";

export type SchemaContractMigrationIssue = {
  code: string;
  file: string;
  path: string;
  message: string;
};

export type SchemaContractMigrationFile = {
  path: string;
  changed: boolean;
  sha256: string;
  outputSha256: string;
};

export type SchemaContractMigrationManifest = {
  migration: "schema-contract-v2";
  status: "ready" | "blocked";
  memoryRoot: string;
  files: SchemaContractMigrationFile[];
  issues: SchemaContractMigrationIssue[];
  generatedAt: string;
  backupRoot?: string;
};

type PreparedFile = SchemaContractMigrationFile & {
  absolutePath: string;
  output: string;
};

type MigrationDocument = {
  path: string;
  absolutePath: string;
  source: string;
  document: Document.Parsed;
};

type RepresentationContract = {
  type: string;
  format: string;
  layout?: string;
};

export async function checkSchemaContractV2Migration(
  config: MemsphereConfig
): Promise<{ manifest: SchemaContractMigrationManifest; prepared: PreparedFile[] }> {
  const issues: SchemaContractMigrationIssue[] = [];
  const documents: MigrationDocument[] = [];
  const dirty = new Set<Document.Parsed>();

  for (const kind of memoryKinds) {
    for (const path of await listYamlFiles(join(config.memoryRoot, kind))) {
      const source = await readFile(path, "utf8");
      documents.push({
        path: relative(config.memoryRoot, path).replace(/\\/g, "/"),
        absolutePath: path,
        source,
        document: parseMemoryYamlDocument(source)
      });
    }
  }

  const externalContracts = collectExternalSchemaContracts(documents);
  for (const source of documents) migrateDocument(source, externalContracts, issues, dirty);

  const prepared = documents.map(({ path, absolutePath, source, document }) => {
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
  if (!issues.length) validatePreparedOutputs(prepared, issues);

  const manifest: SchemaContractMigrationManifest = {
    migration: "schema-contract-v2",
    status: issues.length ? "blocked" : "ready",
    memoryRoot: config.memoryRoot,
    files: prepared.map(({ absolutePath: _absolutePath, output: _output, ...file }) => file),
    issues,
    generatedAt: new Date().toISOString()
  };
  return { manifest, prepared };
}

export async function writeSchemaContractV2Migration(config: MemsphereConfig): Promise<SchemaContractMigrationManifest> {
  return withMemoryStoreMigrationLock(config, "Schema Contract v2 migration", async () => {
    const { manifest, prepared } = await checkSchemaContractV2Migration(config);
    if (manifest.status !== "ready") {
      throw new Error(`Schema Contract v2 migration is blocked by ${manifest.issues.length} issue(s)`);
    }
    const changed = prepared.filter((file) => file.changed);
    if (!changed.length) return manifest;

    const timestamp = manifest.generatedAt.replace(/[:.]/g, "-");
    const migrationRoot = join(config.scopeRoot, "migrations", "schema-contract-v2", timestamp);
    const stagedRoot = join(migrationRoot, "staged");
    const backupRoot = join(migrationRoot, "backup");
    await mkdir(stagedRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    for (const file of prepared) {
      const stagedPath = join(stagedRoot, file.path);
      await mkdir(dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, file.output, "utf8");
    }
    await validateMemoryRoot(stagedRoot);

    await assertMigrationSourcesUnchanged(changed);
    for (const file of changed) {
      const backupPath = join(backupRoot, file.path);
      await mkdir(dirname(backupPath), { recursive: true });
      await copyFile(file.absolutePath, backupPath);
    }
    await assertMigrationSourcesUnchanged(changed);

    const written: PreparedFile[] = [];
    try {
      for (const file of changed) {
        await assertMigrationSourcesUnchanged([file]);
        const tempPath = join(dirname(file.absolutePath), `.${basename(file.absolutePath)}.schema-v2.tmp`);
        await writeFile(tempPath, file.output, "utf8");
        await rename(tempPath, file.absolutePath);
        written.push(file);
      }
      await validateMemoryRoot(config.memoryRoot);
    } catch (error) {
      for (const file of written.reverse()) await copyFile(join(backupRoot, file.path), file.absolutePath);
      throw error;
    }

    const completed = { ...manifest, backupRoot };
    await writeFile(join(migrationRoot, "manifest.json"), `${JSON.stringify(completed, null, 2)}\n`, "utf8");
    return completed;
  });
}

function collectExternalSchemaContracts(documents: MigrationDocument[]): Map<string, RepresentationContract | undefined> {
  const contracts = new Map<string, RepresentationContract[]>();
  for (const source of documents) {
    walk(source.document.contents as ParsedNode | null, "", (node) => {
      if (!isMap(node) || node.tag !== "!artifact") return;
      const schemaName = scalarString(node.get("schema", true) as ParsedNode | undefined);
      const contract = artifactContract(node);
      if (!schemaName || !contract) return;
      const values = contracts.get(schemaName) ?? [];
      values.push(contract);
      contracts.set(schemaName, values);
    });
  }

  return new Map([...contracts].map(([name, values]) => {
    const first = values[0];
    const consistent = first && values.every((value) => sameContract(value, first));
    return [name, consistent ? first : undefined];
  }));
}

function migrateDocument(
  source: MigrationDocument,
  externalContracts: Map<string, RepresentationContract | undefined>,
  issues: SchemaContractMigrationIssue[],
  dirty: Set<Document.Parsed>
): void {
  const root = source.document.contents as ParsedNode | null;
  if (!root) return;
  const seen = new Set<YAMLMap>();
  if (isMap(root) && root.tag === "!schema") {
    const names = stringSequence(root.get("names", true) as ParsedNode | undefined);
    const contracts = names.map((name) => externalContracts.get(name)).filter((value): value is RepresentationContract => Boolean(value));
    const inherited = contracts.length && contracts.every((contract) => sameContract(contract, contracts[0]))
      ? contracts[0]
      : undefined;
    migrateSchemaNode(source.document, root, source.path, "", inherited, issues, dirty, seen, true);
    return;
  }

  walk(root, "", (node, path) => {
    if (!isMap(node) || node.tag !== "!artifact") return;
    const contract = artifactContract(node);
    const schema = node.get("schema", true) as ParsedNode | undefined;
    if (contract && schema && isMap(schema) && schema.tag === "!schema") {
      migrateSchemaNode(source.document, schema, source.path, `${path}.schema`, contract, issues, dirty, seen, true);
    }
  });
  walk(root, "", (node, path) => {
    if (isMap(node) && node.tag === "!schema") {
      migrateSchemaNode(source.document, node, source.path, path, undefined, issues, dirty, seen);
    }
  });
}

function migrateSchemaNode(
  document: Document.Parsed,
  schema: YAMLMap,
  file: string,
  path: string,
  inherited: RepresentationContract | undefined,
  issues: SchemaContractMigrationIssue[],
  dirty: Set<Document.Parsed>,
  seen: Set<YAMLMap>,
  bindTypeToInherited = false
): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const legacyFormat = scalarString(schema.get("format", true) as ParsedNode | undefined);
  let migratedLegacyContract: RepresentationContract | undefined;
  if (legacyFormat === "outline" || legacyFormat === "table") {
    migratedLegacyContract = {
      type: legacyFormat === "table" ? "array" : "object",
      format: "markdown",
      layout: legacyFormat
    };
    schema.set("type", legacyFormat === "table" ? "array" : "object");
    schema.set("format", document.createNode({ name: "markdown", layout: legacyFormat }));
    dirty.add(document);
  }

  if (
    bindTypeToInherited &&
    inherited &&
    !schema.has("type") &&
    inferredSchemaType(schema) !== inherited.type
  ) {
    schema.set("type", document.createNode(inherited.type));
    dirty.add(document);
  }

  const effective = migratedLegacyContract ?? resolveMigrationSchemaContract(schema, inherited);
  const legacyItems = schema.get("items", true) as ParsedNode | undefined;
  if (isSeq(legacyItems) && legacyItems.items.every((item) => scalarString(item as ParsedNode | undefined) !== undefined)) {
    migrateLegacyArrayMembers(
      document,
      schema,
      stringSequence(legacyItems),
      "items",
      file,
      path,
      effective,
      issues,
      dirty
    );
  }

  if (schema.has("element_types")) {
    migrateLegacyArrayMembers(
      document,
      schema,
      stringSequence(schema.get("element_types", true) as ParsedNode | undefined),
      "element_types",
      file,
      path,
      effective,
      issues,
      dirty
    );
  }

  const directFields = schema.get("fields", true) as ParsedNode | undefined;
  if (
    effective?.type === "array" &&
    isSeq(directFields) &&
    !schema.has("item") &&
    !schema.has("items")
  ) {
    const item = createSchemaCandidate(document, "object");
    item.set("fields", directFields);
    schema.delete("fields");
    schema.set("item", item);
    if (!schema.has("type")) schema.set("type", document.createNode("array"));
    dirty.add(document);
  }

  const childInherited = migratedLegacyContract ?? resolveMigrationSchemaContract(schema, inherited);
  const fields = schema.get("fields", true) as ParsedNode | undefined;
  if (isSeq(fields)) {
    fields.items.forEach((field, index) => {
      if (!field || !isMap(field)) return;
      if (field.tag === "!schema") {
        migrateSchemaNode(document, field, file, `${childPath(path, "fields")}[${index}]`, childInherited, issues, dirty, seen);
        return;
      }
      if (field.tag !== "!repeat") return;
      const body = field.get("body", true) as ParsedNode | undefined;
      if (!isSeq(body)) return;
      body.items.forEach((bodyField, bodyIndex) => {
        if (bodyField && isMap(bodyField) && bodyField.tag === "!schema") {
          migrateSchemaNode(
            document,
            bodyField,
            file,
            `${childPath(path, "fields")}[${index}].body[${bodyIndex}]`,
            childInherited,
            issues,
            dirty,
            seen
          );
        }
      });
    });
  }

  const item = schema.get("item", true) as ParsedNode | undefined;
  if (item && isMap(item) && item.tag === "!schema") {
    migrateSchemaNode(document, item, file, childPath(path, "item"), childInherited, issues, dirty, seen);
  }
  const items = schema.get("items", true) as ParsedNode | undefined;
  if (isSeq(items)) {
    items.items.forEach((candidate, index) => {
      if (candidate && isMap(candidate) && candidate.tag === "!schema") {
        migrateSchemaNode(document, candidate, file, `${childPath(path, "items")}[${index}]`, childInherited, issues, dirty, seen);
      }
    });
  }
}

function migrateLegacyArrayMembers(
  document: Document.Parsed,
  schema: YAMLMap,
  memberTypes: string[],
  sourceKey: "element_types" | "items",
  file: string,
  path: string,
  effective: RepresentationContract | undefined,
  issues: SchemaContractMigrationIssue[],
  dirty: Set<Document.Parsed>
): void {
  if (effective?.type !== "array") {
    issues.push({
      code: "migration.schema.array_context_required",
      file,
      path: childPath(path, sourceKey),
      message: `${sourceKey} requires an effective array Schema contract`
    });
    return;
  }
  if (!memberTypes.length) {
    issues.push({
      code: "migration.schema.member_type_required",
      file,
      path: childPath(path, sourceKey),
      message: `${sourceKey} must contain at least one supported member type`
    });
    return;
  }

  const fields = schema.get("fields", true) as ParsedNode | undefined;
  const candidates: YAMLMap[] = [];
  let structuredCandidate: YAMLMap | undefined;
  for (const memberType of memberTypes) {
    const migratedType = migrateLegacyMemberType(memberType);
    if (!migratedType) {
      issues.push({
        code: "migration.schema.member_type_unsupported",
        file,
        path: childPath(path, sourceKey),
        message: `Schema member type ${memberType} cannot be represented by an Artifact value type`
      });
      return;
    }
    const candidate = createSchemaCandidate(document, migratedType);
    if (memberType === "Schema") structuredCandidate = candidate;
    candidates.push(candidate);
  }

  if (isSeq(fields)) {
    if (!structuredCandidate && candidates.length === 1 && candidates[0]?.get("type") === "object") {
      structuredCandidate = candidates[0];
    }
    if (!structuredCandidate) {
      issues.push({
        code: "migration.schema.fields_without_object_member",
        file,
        path: childPath(path, "fields"),
        message: `Schema fields require an object member in ${sourceKey}`
      });
      return;
    }
    structuredCandidate.set("fields", fields);
    schema.delete("fields");
  }

  schema.delete(sourceKey);
  if (!schema.has("type")) schema.set("type", document.createNode("array"));
  if (candidates.length === 1) {
    schema.set("item", candidates[0]);
  } else {
    const items = document.createNode([]) as YAMLSeq;
    items.items.push(...candidates);
    schema.set("items", items);
  }
  dirty.add(document);
}

function migrateLegacyMemberType(type: string): string | undefined {
  if (["boolean", "number", "string", "object", "array"].includes(type)) return type;
  return type === "Schema" ? "object" : undefined;
}

function createSchemaCandidate(document: Document.Parsed, type: string): YAMLMap {
  const candidate = document.createNode({ type }) as YAMLMap;
  candidate.tag = "!schema";
  return candidate;
}

function artifactContract(artifact: YAMLMap): RepresentationContract | undefined {
  const type = scalarString(artifact.get("type", true) as ParsedNode | undefined) ?? "string";
  const format = formatContract(artifact.get("format", true) as ParsedNode | undefined) ?? { format: "plain" };
  return { type, ...format };
}

function inferredSchemaType(schema: YAMLMap): string {
  const explicit = scalarString(schema.get("type", true) as ParsedNode | undefined);
  if (explicit) return explicit;
  const fields = schema.get("fields", true) as ParsedNode | undefined;
  return isSeq(fields) ? "object" : "string";
}

function resolveMigrationSchemaContract(
  schema: YAMLMap,
  inherited: RepresentationContract | undefined
): RepresentationContract {
  const type = scalarString(schema.get("type", true) as ParsedNode | undefined) ?? inferredSchemaType(schema);
  const explicitFormat = formatContract(schema.get("format", true) as ParsedNode | undefined);
  if (explicitFormat) return { type, ...explicitFormat };
  if (!inherited) return { type, format: "plain" };

  const compatibleLayout =
    (inherited.layout === "outline" && type === "object") ||
    (inherited.layout === "table" && type === "array");
  return {
    type,
    format: inherited.format,
    ...(compatibleLayout ? { layout: inherited.layout } : {})
  };
}

function formatContract(node: ParsedNode | undefined): Pick<RepresentationContract, "format" | "layout"> | undefined {
  const scalar = scalarString(node);
  if (scalar) return { format: scalar };
  if (!node || !isMap(node)) return undefined;
  const format = scalarString(node.get("name", true) as ParsedNode | undefined);
  if (!format) return undefined;
  const layout = scalarString(node.get("layout", true) as ParsedNode | undefined);
  return { format, layout };
}

function sameContract(left: RepresentationContract, right: RepresentationContract): boolean {
  return left.type === right.type && left.format === right.format && left.layout === right.layout;
}

function validatePreparedOutputs(prepared: PreparedFile[], issues: SchemaContractMigrationIssue[]): void {
  for (const file of prepared) {
    const kind = file.path.split("/")[0] as MemoryKind;
    try {
      const entity = parseMemoryYaml(file.output);
      const result = memorySyntaxRegistry.require(currentMemorySyntax).schemas[kind].safeParse({
        ...(entity as Record<string, unknown>),
        syntax: currentMemorySyntax
      });
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

function walk(node: ParsedNode | null, path: string, visit: (node: ParsedNode, path: string) => void): void {
  if (!node) return;
  visit(node, path);
  if (isMap(node)) {
    for (const item of node.items) {
      const key = scalarString(item.key as ParsedNode | undefined) ?? "?";
      walk(item.value as ParsedNode | null, childPath(path, key), visit);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => walk(item as ParsedNode | null, `${path}[${index}]`, visit));
  }
}

function childPath(parent: string, child: string): string {
  return parent ? `${parent}.${child}` : child;
}

function scalarString(node: ParsedNode | undefined): string | undefined {
  const value = (node as Scalar | undefined)?.value;
  return typeof value === "string" ? value : undefined;
}

function stringSequence(node: ParsedNode | undefined): string[] {
  return isSeq(node)
    ? node.items.map((item) => scalarString(item as ParsedNode | undefined)).filter((value): value is string => Boolean(value))
    : [];
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

async function validateMemoryRoot(root: string): Promise<void> {
  await validateMigrationOutputRoot(root);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
