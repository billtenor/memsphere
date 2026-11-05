import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

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

// Suites partition discovered tests; no per-file inclusion list is required.
export const testSuites = {
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
  const name = basename(file);
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

export function selectTests(files, sources, durations, suite = "all") {
  if (suite !== "all" && !testSuites[suite]) throw new Error(`Unknown test suite: ${suite}`);
  return files.filter(file => {
    if (suite === "all") return true;
    return testSuites[suite].categories.includes(testCategory(file, sources[file]));
  })
    .sort((a, b) => (durations[basename(b)] ?? 2) - (durations[basename(a)] ?? 2) || a.localeCompare(b, "en"));
}
