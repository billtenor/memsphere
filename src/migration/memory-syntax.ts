import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { isMap, type Document, type ParsedNode, type Scalar } from "yaml";
import type { MemsphereConfig } from "../config.js";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { memorySyntaxRegistry } from "../memory/schema.js";
import { listMemoryFiles, parseMemoryEntity, readAllMemoryFiles } from "../memory/store.js";
import {
  assertMemorySyntaxIdentifier,
  currentMemorySyntax,
  readMemorySyntax,
  startMemorySyntax,
  type MemorySyntaxVersion
} from "../memory/syntax.js";
import { parseMemoryYaml, parseMemoryYamlDocument } from "../memory/yaml.js";
import { checkArtifactContractV2Migration } from "./artifact-contract-v2.js";
import { checkSchemaContractV2Migration } from "./schema-contract-v2.js";
import { memorySyntaxMigrationRegistry } from "./memory-syntax-path.js";
import { assertMigrationSourcesUnchanged, withMemoryStoreMigrationLock } from "./store-write.js";

export {
  MemorySyntaxMigrationRegistry,
  memorySyntaxMigrationRegistry,
  type MemorySyntaxMigrationStep
} from "./memory-syntax-path.js";

export type MemorySyntaxMigrationIssue = {
  code: string;
  file: string;
  path: string;
  message: string;
};

export type MemorySyntaxMigrationFile = {
  path: string;
  from: MemorySyntaxVersion;
  to: MemorySyntaxVersion;
  changed: boolean;
  sha256: string;
  outputSha256: string;
};

export type MemorySyntaxMigrationManifest = {
  migration: "memory-syntax";
  target: MemorySyntaxVersion;
  status: "ready" | "blocked";
  memoryRoot: string;
  files: MemorySyntaxMigrationFile[];
  issues: MemorySyntaxMigrationIssue[];
  generatedAt: string;
  backupRoot?: string;
};

type PreparedFile = MemorySyntaxMigrationFile & {
  absolutePath: string;
  output: string;
};

type SourceFile = {
  kind: MemoryKind;
  path: string;
  absolutePath: string;
  source: string;
};

export async function checkMemorySyntaxMigration(
  config: MemsphereConfig,
  target: MemorySyntaxVersion = currentMemorySyntax
): Promise<{ manifest: MemorySyntaxMigrationManifest; prepared: PreparedFile[] }> {
  assertMemorySyntaxIdentifier(target);
  memorySyntaxRegistry.require(target);
  memorySyntaxMigrationRegistry.path(startMemorySyntax, target);
  const issues: MemorySyntaxMigrationIssue[] = [];
  const prepared: PreparedFile[] = [];
  const sourceFiles = await readMigrationSourceFiles(config.memoryRoot);
  const staged = target === currentMemorySyntax
    ? await stageLegacyContractMigrations(config, sourceFiles)
    : undefined;

  if (staged?.issues.length) {
    issues.push(...staged.issues);
    for (const file of sourceFiles) {
      let from = startMemorySyntax;
      try {
        from = readMemorySyntax(parseMemoryYaml(file.source));
      } catch {
        // The contract migration issue is the actionable diagnostic for this file.
      }
      prepared.push({
        path: file.path,
        absolutePath: file.absolutePath,
        from,
        to: target,
        changed: false,
        sha256: sha256(file.source),
        outputSha256: sha256(file.source),
        output: file.source
      });
    }
    await rm(staged.root, { recursive: true, force: true });
    return migrationResult(config, target, prepared, issues);
  }

  try {
    for (const file of sourceFiles) {
      const { kind, path, absolutePath, source } = file;
      let from = startMemorySyntax;
      let output = source;

      try {
        const contractOutput = staged?.paths.has(path)
          ? await readFile(join(staged.memoryRoot, path), "utf8")
          : source;
        const parsedSource = parseMemoryYaml(source);
        from = readMemorySyntax(parsedSource);
        if (from === target) {
          parseMemoryEntity(kind, parsedSource);
          output = source;
          prepared.push({
            path,
            absolutePath,
            from,
            to: target,
            changed: false,
            sha256: sha256(source),
            outputSha256: sha256(source),
            output: source
          });
          continue;
        }
        const document = parseMemoryYamlDocument(contractOutput);
        const steps = memorySyntaxMigrationRegistry.path(from, target);
        for (const step of steps) {
          step.migrate(document);
          setDocumentSyntax(document, step.to);
        }
        setDocumentSyntax(document, target);
        output = document.toString({ lineWidth: 0 });
        const parsed = parseMemoryYaml(output);
        const entity = parseMemoryEntity(kind, parsed);
        if (entity.syntax !== target) {
          throw new Error(`migration produced syntax ${entity.syntax}, expected ${target}`);
        }
      } catch (error) {
        issues.push({
          code: "migration.syntax.invalid",
          file: path,
          path: "syntax",
          message: error instanceof Error ? error.message : String(error)
        });
      }

      prepared.push({
        path,
        absolutePath,
        from,
        to: target,
        changed: output !== source,
        sha256: sha256(source),
        outputSha256: sha256(output),
        output
      });
    }
  } finally {
    if (staged) await rm(staged.root, { recursive: true, force: true });
  }

  return migrationResult(config, target, prepared, issues);
}

export async function writeMemorySyntaxMigration(
  config: MemsphereConfig,
  target: MemorySyntaxVersion = currentMemorySyntax
): Promise<MemorySyntaxMigrationManifest> {
  return withMemoryStoreMigrationLock(config, "Memory syntax migration", async () => {
    const { manifest, prepared } = await checkMemorySyntaxMigration(config, target);
    if (manifest.status !== "ready") {
      throw new Error(`Memory syntax migration is blocked by ${manifest.issues.length} issue(s)`);
    }
    const changed = prepared.filter((file) => file.changed);
    if (!changed.length) return manifest;

    const timestamp = manifest.generatedAt.replace(/[:.]/g, "-");
    const migrationRoot = join(config.scopeRoot, "migrations", "memory-syntax", timestamp);
    const stagedRoot = join(migrationRoot, "staged");
    const backupRoot = join(migrationRoot, "backup");
    await mkdir(stagedRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    for (const file of prepared) {
      const stagedPath = join(stagedRoot, file.path);
      await mkdir(dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, file.output, "utf8");
    }
    await assertMemoryRootSyntax(stagedRoot, target);

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
        const tempPath = join(dirname(file.absolutePath), `.${basename(file.absolutePath)}.syntax.tmp`);
        await writeFile(tempPath, file.output, "utf8");
        await rename(tempPath, file.absolutePath);
        written.push(file);
      }
      await assertMemoryRootSyntax(config.memoryRoot, target);
    } catch (error) {
      for (const file of written.reverse()) await copyFile(join(backupRoot, file.path), file.absolutePath);
      throw error;
    }

    const completed = { ...manifest, backupRoot };
    await writeFile(join(migrationRoot, "manifest.json"), `${JSON.stringify(completed, null, 2)}\n`, "utf8");
    return completed;
  });
}

async function readMigrationSourceFiles(memoryRoot: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const kind of memoryKinds) {
    for (const absolutePath of await listMemoryFiles(memoryRoot, kind)) {
      files.push({
        kind,
        path: relative(memoryRoot, absolutePath).replace(/\\/g, "/"),
        absolutePath,
        source: await readFile(absolutePath, "utf8")
      });
    }
  }
  return files;
}

async function stageLegacyContractMigrations(
  config: MemsphereConfig,
  sourceFiles: readonly SourceFile[]
): Promise<{ root: string; memoryRoot: string; paths: ReadonlySet<string>; issues: MemorySyntaxMigrationIssue[] }> {
  const root = await mkdtemp(join(tmpdir(), "memsphere-syntax-migration-"));
  const memoryRoot = join(root, "memory");
  const stagedConfig: MemsphereConfig = {
    ...config,
    configPath: join(root, "config.json"),
    scopeRoot: root,
    memoryRoot,
    runsRoot: join(root, "runs"),
    archiveRoot: join(root, "archives")
  };

  const legacyFiles = sourceFiles.filter((file) => {
    try {
      return readMemorySyntax(parseMemoryYaml(file.source)) === startMemorySyntax;
    } catch {
      return false;
    }
  });
  const paths = new Set(legacyFiles.map((file) => file.path));

  for (const kind of memoryKinds) await mkdir(join(memoryRoot, kind), { recursive: true });
  for (const file of legacyFiles) {
    const target = join(memoryRoot, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.source, "utf8");
  }

  const artifact = await checkArtifactContractV2Migration(stagedConfig, {
    includeRuns: false,
    validateOutputs: false
  });
  if (artifact.manifest.issues.length) {
    return { root, memoryRoot, paths, issues: contractIssues("artifact", artifact.manifest.issues) };
  }
  await writePreparedOutputs(artifact.prepared);

  const schema = await checkSchemaContractV2Migration(stagedConfig);
  if (schema.manifest.issues.length) {
    return { root, memoryRoot, paths, issues: contractIssues("schema", schema.manifest.issues) };
  }
  await writePreparedOutputs(schema.prepared);
  return { root, memoryRoot, paths, issues: [] };
}

async function writePreparedOutputs(files: readonly { absolutePath: string; output: string }[]): Promise<void> {
  for (const file of files) await writeFile(file.absolutePath, file.output, "utf8");
}

function contractIssues(
  contract: "artifact" | "schema",
  issues: readonly { code: string; file: string; path: string; message: string }[]
): MemorySyntaxMigrationIssue[] {
  return issues.map((issue) => ({
    code: `migration.syntax.${contract}.${issue.code}`,
    file: issue.file,
    path: issue.path,
    message: issue.message
  }));
}

function migrationResult(
  config: MemsphereConfig,
  target: MemorySyntaxVersion,
  prepared: PreparedFile[],
  issues: MemorySyntaxMigrationIssue[]
): { manifest: MemorySyntaxMigrationManifest; prepared: PreparedFile[] } {
  return {
    manifest: {
      migration: "memory-syntax",
      target,
      status: issues.length ? "blocked" : "ready",
      memoryRoot: config.memoryRoot,
      files: prepared.map(({ absolutePath: _absolutePath, output: _output, ...file }) => file),
      issues,
      generatedAt: new Date().toISOString()
    },
    prepared
  };
}

function setDocumentSyntax(document: Document.Parsed, syntax: MemorySyntaxVersion): void {
  const root = document.contents as ParsedNode | null;
  if (!root || !isMap(root)) throw new Error("Memory YAML root must be a mapping");
  root.set("syntax" as never, syntax as never);
  const index = root.items.findIndex((pair) => {
    const key = pair.key as string | Scalar | null;
    return typeof key === "string" ? key === "syntax" : key?.value === "syntax";
  });
  if (index > 0) root.items.unshift(...root.items.splice(index, 1));
}

async function assertMemoryRootSyntax(memoryRoot: string, syntax: MemorySyntaxVersion): Promise<void> {
  for (const file of await readAllMemoryFiles(memoryRoot)) {
    if (file.entity.syntax !== syntax) {
      throw new Error(`${file.path} uses syntax ${file.entity.syntax}, expected ${syntax}`);
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
