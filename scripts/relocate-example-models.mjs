#!/usr/bin/env node
// One-time, explicit maintenance. Runtime dependencies are shipped in this package.
import { readFile, writeFile } from "node:fs/promises";
import { resolveProjectContext } from "../dist/project/resolver.js";
import { applyExampleRelocation, planExampleRelocation, restoreExampleRelocation } from "../dist/project/example-relocation.js";

const usage = "Usage: node scripts/relocate-example-models.mjs plan [--project memsphere] [--out <file>] | apply --plan <file> | restore --backup <dir>";
try {
  const [command, ...args] = process.argv.slice(2);
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || options.has(key)) throw new Error(usage);
    options.set(key, value);
  }
  let result;
  if (command === "plan" && [...options.keys()].every(key => ["--project", "--out"].includes(key))) {
    const context = await resolveProjectContext({ project: options.get("--project") });
    result = await planExampleRelocation({}, { name: context.primary.name, root: context.primary.paths.root });
    if (options.has("--out")) await writeFile(options.get("--out"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } else if (command === "apply" && options.size === 1 && options.has("--plan")) {
    result = await applyExampleRelocation({}, JSON.parse(await readFile(options.get("--plan"), "utf8")));
  } else if (command === "restore" && options.size === 1 && options.has("--backup")) {
    result = await restoreExampleRelocation({}, options.get("--backup"));
  } else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code, backup: error.backup, restoreCommand: error.restoreCommand, rollbackErrors: error.rollbackErrors }, null, 2));
  process.exitCode = 1;
}
