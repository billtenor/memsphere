import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverTestFiles, platformTests, selectTests, testSuites } from "./test-plan.mjs";

export function ciProfile(event, input = "default") {
  if (event === "push") return "full";
  if (event !== "workflow_dispatch") return "default";
  if (!["default", "full"].includes(input)) throw new Error(`Unknown CI profile: ${input}`);
  return input;
}

const linux = [
  ["ubuntu-24.04", "browser", 3], ["ubuntu-24.04", "cli", 3],
  ["ubuntu-24.04", "memory-and-projects", 2], ["ubuntu-24.04", "runtime-core", 2]
];
const defaultRows = [...linux,
  ["macos-latest", "platform-and-upgrades", 4],
  ["windows-latest", "platform-core", 4], ["windows-latest", "platform-upgrades", 4]
];
const fullRows = [...linux,
  ["macos-latest", "model-ui", 3], ["macos-latest", "review-ui", 3],
  ["macos-latest", "cli", 4], ["macos-latest", "memory-and-projects", 3], ["macos-latest", "runtime-core", 3],
  ["windows-latest", "model-ui", 2], ["windows-latest", "review-ui", 3],
  ["windows-latest", "memory-cli", 2], ["windows-latest", "app-cli", 2],
  ["windows-latest", "project-core", 3], ["windows-latest", "project-upgrade", 3],
  ["windows-latest", "memory-core", 2], ["windows-latest", "runtime-core", 3]
];

export function createCiPlan(profile, files, sources) {
  if (!["default", "full"].includes(profile)) throw new Error(`Unknown CI profile: ${profile}`);
  for (const file of platformTests) {
    if (!files.includes(file)) throw new Error(`Platform protection is missing: ${file}`);
  }
  return { include: (profile === "full" ? fullRows : defaultRows).map(([os, suite, workers]) => {
    const selected = selectTests(files, sources, {}, suite);
    if (!selected.length) throw new Error(`Empty CI suite: ${suite}`);
    const browser = selected.some(file => sources[file].includes("helpers/browser") || /from ["']playwright["']/.test(sources[file]));
    return { os, suite, title: testSuites[suite].title, workers, browser };
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = fileURLToPath(new URL("../test/", import.meta.url));
  const files = await discoverTestFiles(directory);
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(join(directory, file), "utf8")])));
  const profile = ciProfile(process.env.GITHUB_EVENT_NAME, process.env.CI_PROFILE);
  console.log(`profile=${profile}`);
  console.log(`matrix=${JSON.stringify(createCiPlan(profile, files, sources))}`);
}
