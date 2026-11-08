import { readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Relative POSIX paths keep discovery identical on every CI platform.
export async function discoverTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async entry => {
    if (entry.isDirectory()) {
      return (await discoverTestFiles(join(directory, entry.name))).map(file => `${entry.name}/${file}`);
    }
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [entry.name] : [];
  }));
  return groups.flat().sort();
}

export const testSuites = {
  regression: { title: "Unit, module & integration tests", categories: [] },
  unit: { title: "Unit tests", categories: [] },
  module: { title: "Module tests", categories: [] },
  system: { title: "System tests", categories: [] },
  e2e: { title: "End-to-end tests", categories: [] },
  integration: { title: "Integration tests", categories: [] },
  "integration-model-ui": { title: "Integration · Models & Settings UI", categories: ["model-ui"] },
  "integration-review-ui": { title: "Integration · Content, Reviews & Shell UI", categories: ["review-ui"] },
  "integration-browser": { title: "Integration · Browser UI", categories: ["model-ui", "review-ui"] },
  "integration-cli": { title: "Integration · CLI contracts", categories: ["memory-cli", "app-cli"] },
  "integration-memory-and-projects": { title: "Integration · Memory & Projects", categories: ["project-core", "project-upgrade", "runtime-upgrades", "memory-core"] },
  "integration-runtime-core": { title: "Integration · Run, Data & SDK", categories: ["runtime-core"] },
  "platform-locks": { title: "Platform integration · Cross-process locks", categories: [] },
  "platform-context": { title: "Platform integration · Context & Review", categories: [] },
  "platform-artifacts": { title: "Platform integration · Artifacts & Archives", categories: [] },
  "platform-models": { title: "Platform integration · Model storage", categories: [] },
  "platform-cli": { title: "Platform integration · Native CLI sessions", categories: [] },
  "platform-process": { title: "Platform integration · Processes & launchers", categories: [] },
  "platform-rewind": { title: "Platform integration · Rewind & process ownership", categories: [] },
  "platform-filesystem": { title: "Platform integration · Filesystem & paths", categories: [] },
  "platform-upgrade": { title: "Platform integration · Project upgrades", categories: [] },
  "platform-memory-publication": { title: "Platform integration · Memory publication", categories: [] },
  "platform-git": { title: "Platform integration · Git & worktrees", categories: [] },
  platform: { title: "Platform integration", categories: [] },
  "model-ui": { title: "Models & Settings UI", categories: ["model-ui"] },
  "review-ui": { title: "Review & Shell UI", categories: ["review-ui"] },
  "memory-cli": { title: "Memory & Project CLI", categories: ["memory-cli"] },
  "app-cli": { title: "App, Model & Data CLI", categories: ["app-cli"] },
  "project-core": { title: "Project Lifecycle", categories: ["project-core"] },
  "project-upgrade": { title: "Project Upgrades", categories: ["project-upgrade", "runtime-upgrades"] },
  "memory-core": { title: "Memory Stores & Changes", categories: ["memory-core"] },
  "runtime-core": { title: "Run, Data & SDK", categories: ["runtime-core"] },
  browser: { title: "Browser UI", categories: ["model-ui", "review-ui"] },
  cli: { title: "CLI & Packaging", categories: ["memory-cli", "app-cli"] },
  "memory-and-projects": { title: "Projects & Memory", categories: ["project-core", "project-upgrade", "runtime-upgrades", "memory-core"] },
  core: { title: "Projects, Memory & Runtime", categories: ["project-core", "project-upgrade", "runtime-upgrades", "memory-core", "runtime-core"] }
};

/** Categories describe the primary contract; integration tests remain whole. */
export function testCategory(file, source) {
  const name = basename(file).replace(/\.(unit|module|integration|system|e2e)\.test\.ts$/, ".test.ts");
  if (["legacy-general-task-upgrade.test.ts", "system-upgrade-changeset.test.ts"].includes(name)) return "runtime-upgrades";
  if (name === "embedded-changeset.test.ts") return "memory-core";
  if (source.includes("helpers/browser") || /from ["']playwright["']/.test(source)) {
    return /model|settings/.test(name) ? "model-ui" : "review-ui";
  }
  if (name.startsWith("project-upgrade")) return "project-upgrade";
  if (/^(app-install|data-command|model-command|model-market-package|system-model-creation)/.test(name)) return "app-cli";
  if (/cli|windows-prerequisites/.test(name)) return "memory-cli";
  if (/^(project|config|home|git|file-lock)/.test(name)) return "project-core";
  if (/^(memory|market|archive-store|reserved-store|file-memory|validate|embedded)/.test(name)) return "memory-core";
  // Newly added contract tests always run, even before their category is refined.
  return "runtime-core";
}

const testDirectory = fileURLToPath(new URL("../../test/", import.meta.url));
const key = file => (isAbsolute(file) ? relative(testDirectory, file) : file).split(sep).join("/");
export const isUnitTest = file => file.endsWith(".unit.test.ts");
export const isModuleTest = file => file.endsWith(".module.test.ts");
export const isIntegrationTest = file => file.endsWith(".integration.test.ts");
export const isSystemTest = file => file.endsWith(".system.test.ts");
export const isE2ETest = file => file.endsWith(".e2e.test.ts");
export const isPlatformTest = (file, source = "") => /(?:^|\/)platform\//.test(key(file)) || source.includes("// @integration-platform: native");
export function platformGroup(file, source = "") {
  const declared = key(file).match(/(?:^|\/)platform\/([^/]+)\//)?.[1];
  if (declared) return declared;
  if (!isPlatformTest(file, source)) return undefined;
  const name = basename(file);
  if (/^(context-|procedure-graph-|review-node)/.test(name)) return "context";
  if (/^(run-model|run-rule|archive-)/.test(name)) return "artifacts";
  if (/^(model-|project-model|system-model|data-manager|data-extensions|data-raw)/.test(name)) return "models";
  if (/^(memory-|file-memory|project-memory|market-store|artifact-migration|schema-contract-migration|checkpoint-publication|example-relocation|legacy-general)/.test(name)) return "memory-publication";
  if (/^runner-identity/.test(name)) return "process";
  return "filesystem";
}

/** Layer and native-system contracts are declared by placement, not timing or business-name guesses. */
export function selectTests(files, sources, suite = "all") {
  if (suite !== "all" && !testSuites[suite]) throw new Error(`Unknown test suite: ${suite}`);
  return files.filter(file => {
    if (suite === "all") return true;
    if (suite === "regression") return !isSystemTest(file) && !isE2ETest(file);
    if (suite === "unit") return isUnitTest(file);
    if (suite === "module") return isModuleTest(file);
    if (suite === "system") return isSystemTest(file);
    if (suite === "e2e") return isE2ETest(file);
    if (suite === "integration") return isIntegrationTest(file);
    if (suite === "platform") return isIntegrationTest(file) && isPlatformTest(file, sources[file]);
    if (suite.startsWith("platform-")) return isIntegrationTest(file) && platformGroup(file, sources[file]) === suite.slice(9);
    if (suite.startsWith("integration-")) return isIntegrationTest(file) && !isPlatformTest(file, sources[file]) && testSuites[suite].categories.includes(testCategory(file, sources[file]));
    return testSuites[suite].categories.includes(testCategory(file, sources[file]));
  }).sort((a, b) => a.localeCompare(b, "en"));
}
