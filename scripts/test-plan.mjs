import { basename } from "node:path";

// Native filesystem/process risks retained on every supported PR platform.
// See docs/ci-performance.md for the source-boundary audit and full-run policy.
export const platformTests = [
  "agent-review.test.ts",
  "app-install.test.ts",
  "archive-store.test.ts",
  "business-data-service.test.ts",
  "cli-errors.test.ts",
  "config-management.test.ts",
  "data-filesystem-datastore.test.ts",
  "data-filesystem-helpers.test.ts",
  "data-filesystem-json-valuestore.test.ts",
  "data-filesystem-open.test.ts",
  "data-filesystem-process.test.ts",
  "data-filesystem-revisions.test.ts",
  "embedded-changeset.test.ts",
  "example-relocation.test.ts",
  "file-lock.test.ts",
  "git.test.ts",
  "home.test.ts",
  "memory-changeset.test.ts",
  "memory-sync.test.ts",
  "model-operation.test.ts",
  "model-registration.test.ts",
  "model-service.test.ts",
  "model-storage-paths.test.ts",
  "persistence.test.ts",
  "project-command.test.ts",
  "project-registry.test.ts",
  "project-resolver.test.ts",
  "report-execution.test.ts",
  "reserved-models.test.ts",
  "reserved-store.test.ts",
  "run-memory-backfill.test.ts",
  "run-model-artifact.test.ts",
  "run-output.test.ts",
  "run-rule-integration.test.ts",
  "run-store.test.ts",
  "system-upgrade-changeset.test.ts",
  "view-package-registry.test.ts",
  "view-service.test.ts",
  "windows-prerequisites.test.ts"
];

// Balance the two existing Windows jobs using full-run file timings.
const platformUpgradeTests = [
  "system-upgrade-changeset.test.ts", "run-model-artifact.test.ts", "memory-changeset.test.ts"
];

export const testSuites = {
  "platform-core": { title: "Platform Core Contracts", categories: [] },
  "platform-upgrades": { title: "Platform Publication & Upgrades", categories: [] },
  platform: { title: "Platform Contracts", categories: [] },
  "platform-and-upgrades": { title: "Platform & Upgrade Contracts", categories: [] },
  "model-ui": { title: "Models & Settings UI", categories: ["model-ui"] },
  "review-ui": { title: "Review & Shell UI", categories: ["review-ui"] },
  "memory-cli": { title: "Memory & Project CLI", categories: ["memory-cli"] },
  "app-cli": { title: "App, Model & Data CLI", categories: ["app-cli"] },
  "project-core": { title: "Project Lifecycle", categories: ["project-core"] },
  "project-upgrade": { title: "Project Upgrades", categories: ["project-upgrade"] },
  "memory-core": { title: "Memory Stores & Changes", categories: ["memory-core"] },
  "runtime-core": { title: "Run, Data & SDK", categories: ["runtime-core"] },
  browser: { title: "Browser UI", categories: ["model-ui", "review-ui"] },
  cli: { title: "CLI & Packaging", categories: ["memory-cli", "app-cli"] },
  "memory-and-projects": { title: "Projects & Memory", categories: ["project-core", "project-upgrade", "memory-core"] },
  core: { title: "Projects, Memory & Runtime", categories: ["project-core", "project-upgrade", "memory-core", "runtime-core"] }
};

/** Categories describe the primary contract; integration tests remain whole. */
export function testCategory(file, source) {
  const name = basename(file);
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
    if (suite === "platform-core") {
      return platformTests.includes(basename(file)) && !platformUpgradeTests.includes(basename(file));
    }
    if (suite === "platform-upgrades") {
      return platformUpgradeTests.includes(basename(file)) || testCategory(file, sources[file]) === "project-upgrade";
    }
    if (suite === "platform" || suite === "platform-and-upgrades") {
      return platformTests.includes(basename(file)) || (suite === "platform-and-upgrades" && testCategory(file, sources[file]) === "project-upgrade");
    }
    return testSuites[suite].categories.includes(testCategory(file, sources[file]));
  })
    .sort((a, b) => (durations[basename(b)] ?? 2) - (durations[basename(a)] ?? 2) || a.localeCompare(b, "en"));
}
