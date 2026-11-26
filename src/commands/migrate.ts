import { z } from "zod";
import { nextAction } from "../prompts/cli-output.js";
import { savedResult, cliCommand, publishResult } from "./output.js";
import { readConfig } from "../config.js";
import {
  checkArtifactContractV2Migration,
  writeArtifactContractV2Migration
} from "../migration/artifact-contract-v2.js";
import {
  checkSchemaContractV2Migration,
  writeSchemaContractV2Migration
} from "../migration/schema-contract-v2.js";
import {
  checkMemorySyntaxMigration,
  writeMemorySyntaxMigration
} from "../migration/memory-syntax.js";

const migrationResult = z.object({
  mode: z.enum(["check", "write"]),
  migration: z.enum(["memory-syntax", "artifact-contract-v2", "schema-contract-v2"]),
  status: z.enum(["ready", "blocked"]),
  target: z.string().optional(),
  affectedFiles: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  issues: z.array(z.object({ code: z.string(), file: z.string(), path: z.string() }).strict()).max(10),
  backupPath: z.string().optional(),
  nextAction
}).strict();

type Manifest = {
  migration: z.infer<typeof migrationResult>["migration"];
  status: "ready" | "blocked";
  target?: string;
  files: { changed: boolean }[];
  issues: { code: string; file: string; path: string }[];
  backupRoot?: string;
};

function emitMigration(manifest: Manifest, options: { write?: boolean; to?: string }): void {
  const command = manifest.migration === "memory-syntax" ? "syntax" : manifest.migration;
  const issues = manifest.issues.slice(0, 10).map(({ code, file, path }) => ({ code, file, path }));
  publishResult(`migrate ${command}`, () => migrationResult.parse({
    mode: options.write ? "write" : "check",
    migration: manifest.migration,
    status: manifest.status,
    target: manifest.target,
    affectedFiles: manifest.files.filter(file => file.changed).length,
    issueCount: manifest.issues.length,
    issues,
    backupPath: manifest.backupRoot,
    nextAction: manifest.status === "blocked"
      ? cliCommand(["migrate", command, "--check", ...(options.to ? ["--to", options.to] : [])])
      : options.write ? cliCommand(["validate"]) : undefined
  }), { itemsField: "issues", saved: options.write && manifest.status === "ready" && manifest.files.some(file => file.changed) ? savedResult(manifest.target ?? manifest.migration) : undefined });
  if (manifest.status === "blocked") process.exitCode = 1;
}

export async function migrateArtifactContractV2Command(options: { check?: boolean; write?: boolean }): Promise<void> {
  if (Boolean(options.check) === Boolean(options.write)) {
    throw new Error("choose exactly one of --check or --write");
  }
  const config = await readConfig();
  assertMigrationWriteAllowed(config, options.write);
  const manifest = options.write
    ? await writeArtifactContractV2Migration(config)
    : (await checkArtifactContractV2Migration(config)).manifest;
  emitMigration(manifest, options);
}

export async function migrateSchemaContractV2Command(options: { check?: boolean; write?: boolean }): Promise<void> {
  if (Boolean(options.check) === Boolean(options.write)) {
    throw new Error("choose exactly one of --check or --write");
  }
  const config = await readConfig();
  assertMigrationWriteAllowed(config, options.write);
  const manifest = options.write
    ? await writeSchemaContractV2Migration(config)
    : (await checkSchemaContractV2Migration(config)).manifest;
  emitMigration(manifest, options);
}

export async function migrateMemorySyntaxCommand(options: {
  check?: boolean;
  write?: boolean;
  to?: string;
}): Promise<void> {
  if (Boolean(options.check) === Boolean(options.write)) {
    throw new Error("choose exactly one of --check or --write");
  }
  const config = await readConfig();
  assertMigrationWriteAllowed(config, options.write);
  const manifest = options.write
    ? await writeMemorySyntaxMigration(config, options.to)
    : (await checkMemorySyntaxMigration(config, options.to)).manifest;
  emitMigration(manifest, options);
}

function assertMigrationWriteAllowed(
  config: Awaited<ReturnType<typeof readConfig>>,
  write: boolean | undefined
): void {
  if (write && config.project?.store?.type === "managed") {
    throw new Error("Migration --write cannot modify a Managed Memory Store directly; apply the migration through a ChangeSet.");
  }
}
