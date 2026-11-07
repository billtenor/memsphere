import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { readAllMemoryFiles } from "../../../src/memory/store.js";
import { currentMemorySyntax } from "../../../src/memory/syntax.js";
import {
  bundledReservedMemoryRoot,
  bundledOfficialMemoryRoot,
  bundledSystemMemoryRoot,
  readBundledSystemMemories,
  readBundledMarketMemories,
  readReservedMemoryManifest,
  reservedMemoryManifestSchema,
  reservedSystemMemoryRemovalTombstones,
  systemMemoryRemovalDigest
} from "../../../src/reserved/store.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-reserved-test-"));

  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("manifest requires install sources to be regular YAML files but allows removed sources to be absent", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    await mkdir(join(sourceRoot, "concepts"), { recursive: true });
    await writeManifest(sourceRoot, ["concepts/missing.yaml"], ["concepts/removed.yaml"]);
    await assert.rejects(readReservedMemoryManifest(sourceRoot), /system memory source not found/);

    await symlink(join(sourceRoot, "concepts", "missing-target.yaml"), join(sourceRoot, "concepts", "missing.yaml"));
    await assert.rejects(readReservedMemoryManifest(sourceRoot), /not a regular file/);

    await rm(join(sourceRoot, "concepts", "missing.yaml"));
    await writeFile(join(sourceRoot, "concepts", "missing.yaml"), conceptYaml("System"));
    const manifest = await readReservedMemoryManifest(sourceRoot);
    assert.deepEqual(manifest.system_memory.remove, ["concepts/removed.yaml"]);
  });
});

test("manifest v4 requires every market dependency to be declared by System or Market install", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    const systemRoot = join(sourceRoot, "system-memory");
    const officialRoot = join(sourceRoot, "official-memory");
    await Promise.all([
      mkdir(join(systemRoot, "statements"), { recursive: true }),
      mkdir(join(officialRoot, "statements"), { recursive: true })
    ]);
    await writeFile(join(systemRoot, "statements", "system-rule.yaml"), statementYaml("system-rule"));
    await writeFile(join(officialRoot, "statements", "market-b.yaml"), statementYaml("market-b"));
    await writeFile(
      join(officialRoot, "statements", "market-a.yaml"),
      statementYaml("market-a", ["statements/system-rule", "statements/market-b"])
    );

    await writeV4Manifest(sourceRoot, ["statements/system-rule.yaml"], [
      "statements/market-a.yaml",
      "statements/market-b.yaml"
    ]);
    await readReservedMemoryManifest(sourceRoot);

    await writeV4Manifest(sourceRoot, ["statements/system-rule.yaml"], ["statements/market-a.yaml"]);
    await assert.rejects(
      readReservedMemoryManifest(sourceRoot),
      /market Memory dependency is not declared.*statements\/market-b/
    );

    await writeFile(
      join(officialRoot, "statements", "market-a.yaml"),
      statementYaml("market-a", ["statements/definitely-missing"])
    );
    await assert.rejects(
      readReservedMemoryManifest(sourceRoot),
      /market Memory dependency is not declared.*statements\/definitely-missing/
    );
  });
});

async function writeManifest(sourceRoot: string, install: string[], removePaths: string[]): Promise<void> {
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(
    join(sourceRoot, "manifest.json"),
    `${JSON.stringify({ version: 1, system_memory: { install, remove: removePaths } }, null, 2)}\n`
  );
}

function conceptYaml(name: string): string {
  return `!concept\nnames:\n  - ${name}\ndefines:\n  - ${name} definition.\n`;
}

async function writeV4Manifest(sourceRoot: string, systemInstall: string[], marketInstall: string[]): Promise<void> {
  await writeFile(join(sourceRoot, "manifest.json"), `${JSON.stringify({
    version: 4,
    memory_syntax: currentMemorySyntax,
    system_memory: { install: systemInstall, remove: [] },
    market_memory: { install: marketInstall }
  }, null, 2)}\n`);
}

function statementYaml(name: string, references: string[] = []): string {
  const asserts = references.length
    ? references.map((reference) => `  - !ref\n    target: ${reference}`).join("\n")
    : "  - A valid rule.";
  return `!statement\nsyntax: ${currentMemorySyntax}\nnames: [${name}]\nasserts:\n${asserts}\n`;
}
