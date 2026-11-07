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

// Fixed exclusions preserve the previous native PR coverage. New test paths
// are included automatically; adding an exclusion is a protected CI change.
export const defaultTestExclusions = [
  "agent-activity.test.ts",
  "archive-run-data.test.ts",
  "archive-worker-guard.test.ts",
  "artifact-format-fixtures.test.ts",
  "artifact-migration.test.ts",
  "artifact-review-browser.test.ts",
  "artifact-review-view.test.ts",
  "artifact-review.test.ts",
  "artifact-validation.test.ts",
  "builtin-memory-view.test.ts",
  "builtin-run-view.test.ts",
  "ci/ci-change-guard.test.ts",
  "ci/ci-workflow.test.ts",
  "ci/full-health.test.ts",
  "ci/test-plan.test.ts",
  "ci/test-runner.test.ts",
  "cli-output-format.test.ts",
  "cli-presentation.test.ts",
  "command-state-store.test.ts",
  "config.test.ts",
  "context-control-cli.test.ts",
  "context-control-graph.test.ts",
  "context-control-invariants.test.ts",
  "context-control-lifecycle.test.ts",
  "context-control-memory-store.test.ts",
  "context-control-outputs.test.ts",
  "context-control-run-lock.test.ts",
  "context-control-upgrade.test.ts",
  "context-control-view-browser.test.ts",
  "context-control-view-read.test.ts",
  "context-control-view.test.ts",
  "context-control.test.ts",
  "context-run-summaries.test.ts",
  "control-plane.test.ts",
  "daemon-integration.test.ts",
  "data-command.test.ts",
  "data-extension-registry.test.ts",
  "data-extensions.test.ts",
  "data-filesystem-hierarchy-process.test.ts",
  "data-interfaces.test.ts",
  "data-json-schema-metamodel.test.ts",
  "data-json-schema.test.ts",
  "data-json-serializer.test.ts",
  "data-manager.test.ts",
  "data-plain-reflection.test.ts",
  "data-preparation.test.ts",
  "data-raw.test.ts",
  "default-content-style.test.ts",
  "disclosure-state.test.ts",
  "file-memory-provider.test.ts",
  "json-patch.test.ts",
  "json-path.test.ts",
  "legacy-general-task-upgrade.test.ts",
  "list-pagination-cli.test.ts",
  "market-changeset.test.ts",
  "market-store.test.ts",
  "market-view.test.ts",
  "memory-catalog.test.ts",
  "memory-changeset-collaboration.test.ts",
  "memory-cli.test.ts",
  "memory-command.test.ts",
  "memory-diff.test.ts",
  "memory-navigation.test.ts",
  "memory-references.test.ts",
  "memory-rules.test.ts",
  "memory-schema.test.ts",
  "memory-serializer.test.ts",
  "memory-store.test.ts",
  "memory-syntax.test.ts",
  "memory-write-access.test.ts",
  "model-asset-checkout.test.ts",
  "model-browser-state.test.ts",
  "model-command.test.ts",
  "model-definition-component-browser.test.ts",
  "model-market-package.test.ts",
  "model-market.test.ts",
  "model-prototype-tree.test.ts",
  "model-publication.test.ts",
  "model-registration-browser.test.ts",
  "model-schema-references.test.ts",
  "model-unavailable.test.ts",
  "model-upgrade.test.ts",
  "model-validation.test.ts",
  "models-builtin-view-browser.test.ts",
  "models-view-slots-browser.test.ts",
  "module-manifest.test.ts",
  "package-release.test.ts",
  "page-layout-view.test.ts",
  "pagination.test.ts",
  "procedure-graph-canvas-browser.test.ts",
  "procedure-graph-cli.test.ts",
  "procedure-graph-content.test.ts",
  "procedure-graph-presentation.test.ts",
  "procedure-graph-review.test.ts",
  "procedure-graph-rewind.test.ts",
  "procedure-graph-runtime.test.ts",
  "procedure-graph-syntax.test.ts",
  "procedure-graph-view-browser.test.ts",
  "procedure-graph-view.test.ts",
  "product-positioning.test.ts",
  "project-memory-provider.test.ts",
  "project-model-registration-cli.test.ts",
  "project-models.test.ts",
  "project-preparation.test.ts",
  "prompt-renderer.test.ts",
  "review-node-cli.test.ts",
  "review-node-content-cli.test.ts",
  "review-node-graph-paths.test.ts",
  "review-node-order.test.ts",
  "review-node-prompt-contract.test.ts",
  "review-node-receipts.test.ts",
  "review-node-regressions.test.ts",
  "review-node-rewind.test.ts",
  "review-node-store.test.ts",
  "review-node-target-race.test.ts",
  "review-nodes.test.ts",
  "run-abandonment-view.test.ts",
  "run-changeset.test.ts",
  "run-command.test.ts",
  "run-data-access.test.ts",
  "run-model-storage.test.ts",
  "run-start-cli.test.ts",
  "run-summary-requests.test.ts",
  "runner-delegated-review-cli.test.ts",
  "runner-identity.test.ts",
  "schema-contract-migration.test.ts",
  "schema-writing-view.test.ts",
  "settings-builtin-module.test.ts",
  "settings-builtin-view-browser.test.ts",
  "skill-command.test.ts",
  "system-model-creation.test.ts",
  "system-models.test.ts",
  "validate-command.test.ts",
  "view-browser.test.ts",
  "view-fault-isolation-browser.test.ts",
  "view-global-style-contract.test.ts",
  "view-host-composition.test.ts",
  "view-host.test.ts",
  "view-locales.test.ts",
  "view-models.test.ts",
  "view-package-browser.test.ts",
  "view-package-config.test.ts",
  "view-package-example.test.ts",
  "view-package-router-browser.test.ts",
  "view-project-switch.test.ts",
  "view-responsive.test.ts",
  "view-sdk.test.ts",
  "view-settings-browser.test.ts",
  "view-settings.test.ts",
  "view-shell-layout.test.ts",
  "view-style-contract.test.ts",
  "view-theme-registry.test.ts"
];
const defaultExclusions = new Set(defaultTestExclusions);
const testDirectory = fileURLToPath(new URL("../../test/", import.meta.url));
const testKey = file => (isAbsolute(file) ? relative(testDirectory, file) : file).split(sep).join("/");
// Routing changes only the owning job, never whether a discovered test runs.
function nativeGroup(file, source) {
  const key = testKey(file);
  if (key === "project-command.test.ts") return "package-platform";
  if (["system-upgrade-changeset.test.ts", "run-model-artifact.test.ts", "memory-changeset.test.ts"].includes(key) || testCategory(file, source) === "project-upgrade") return "platform-upgrades";
  return "platform-core";
}
export const testSuites = {
  "package-platform": { title: "Packaged Job Platform Contracts", categories: [] },
  "platform-core": { title: "Platform Core Contracts", categories: [] },
  "platform-upgrades": { title: "Platform Publication & Upgrades", categories: [] },
  platform: { title: "Platform Contracts", categories: [] },
  "platform-and-upgrades": { title: "Platform & Upgrade Contracts", categories: [] },
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

// Default native jobs use the same category boundaries as full, with fixed exclusions.
for (const [name, definition] of Object.entries({ ...testSuites })) {
  if (definition.categories.length) testSuites[`native-${name}`] = definition;
}

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
    if (suite.startsWith("native-")) {
      return !defaultExclusions.has(testKey(file)) && testSuites[suite].categories.includes(testCategory(file, sources[file]));
    }
    if (["platform", "platform-and-upgrades", "platform-core", "platform-upgrades", "package-platform"].includes(suite)) {
      if (defaultExclusions.has(testKey(file))) return false;
      return suite === "platform" || suite === "platform-and-upgrades" || nativeGroup(file, sources[file]) === suite;
    }
    return testSuites[suite].categories.includes(testCategory(file, sources[file]));
  })
    .sort((a, b) => (durations[basename(b)] ?? 2) - (durations[basename(a)] ?? 2) || a.localeCompare(b, "en"));
}

/** Partition whole files, keeping every eligible test in exactly one shard. */
export function selectTestShard(files, durations, shard) {
  if (!shard) return files;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
  const index = Number(match?.[1]), count = Number(match?.[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count || count > files.length) {
    throw new Error("Shard must be index/count with 1 <= index <= count <= eligible file count");
  }
  const groups = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  // The Linux planner sees relative POSIX names; Windows workers see absolute
  // native paths. Both must assign exactly the same logical files to each shard.
  const key = file => testKey(file).replaceAll("\\", "/");
  const seconds = file => durations[basename(key(file))] ?? 2;
  const ordered = [...files].sort((a, b) => seconds(b) - seconds(a) || key(a).localeCompare(key(b), "en"));
  for (const [position, file] of ordered.entries()) {
    const group = position < count ? groups[position]
      : groups.reduce((least, candidate) => candidate.seconds < least.seconds ? candidate : least);
    group.files.push(file);
    group.seconds += seconds(file);
  }
  return groups[index - 1].files;
}
