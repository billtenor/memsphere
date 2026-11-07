import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverTestFiles, selectTests, selectTestShard, testSuites } from "./test-plan.mjs";

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
const fullRows = [...linux,
  ["macos-latest", "model-ui", 3], ["macos-latest", "review-ui", 3],
  ["macos-latest", "cli", 4], ["macos-latest", "memory-and-projects", 3], ["macos-latest", "runtime-core", 3],
  ["windows-latest", "model-ui", 2], ["windows-latest", "review-ui", 3],
  ["windows-latest", "memory-cli", 2], ["windows-latest", "app-cli", 2],
  ["windows-latest", "project-core", 3], ["windows-latest", "project-upgrade", 3],
  ["windows-latest", "memory-core", 2], ["windows-latest", "runtime-core", 3]
];

export function createCiPlan(profile, files, sources, durationsByPlatform = {}) {
  if (!["default", "full"].includes(profile)) throw new Error(`Unknown CI profile: ${profile}`);
  return { include: fullRows.flatMap(([os, categorySuite, workers]) => {
    const suite = profile === "default" && os !== "ubuntu-24.04" ? `native-${categorySuite}` : categorySuite;
    const platform = os === "ubuntu-24.04" ? "linux" : os === "macos-latest" ? "darwin" : "win32";
    const durations = durationsByPlatform[platform] ?? {};
    const selected = selectTests(files, sources, durations, suite);
    if (!selected.length) {
      if (profile === "full") throw new Error(`Empty CI suite: ${suite}`);
      return [];
    }
    const split = profile === "default" && categorySuite === "runtime-core" && os !== "macos-latest" && selected.length > 1;
    return (split ? ["1/2", "2/2"] : [""]).map(shard => {
      const assigned = selectTestShard(selected, durations, shard);
      const browser = assigned.some(file => sources[file].includes("helpers/browser") || /from ["']playwright["']/.test(sources[file]));
      const title = testSuites[suite].title;
      return { os, suite, title, label: title + (shard ? ` [${shard}]` : ""), workers, browser,
        shard, shardArgs: shard ? `--shard=${shard}` : "", shardSuffix: shard ? `-shard-${shard.replace("/", "-of-")}` : "" };
    });
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = fileURLToPath(new URL("../../test/", import.meta.url));
  const files = await discoverTestFiles(directory);
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(join(directory, file), "utf8")])));
  const profile = ciProfile(process.env.GITHUB_EVENT_NAME, process.env.CI_PROFILE);
  const durations = JSON.parse(await readFile(new URL("./test-durations.json", import.meta.url), "utf8"));
  console.log(`profile=${profile}`);
  console.log(`matrix=${JSON.stringify(createCiPlan(profile, files, sources, durations))}`);
}
