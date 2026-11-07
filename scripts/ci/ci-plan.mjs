import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverTestFiles, selectTests, testSuites } from "./test-plan.mjs";

export function ciProfile(event, input = "default") {
  if (event === "push") return "full";
  if (event !== "workflow_dispatch") return "default";
  if (!["default", "full"].includes(input)) throw new Error(`Unknown CI profile: ${input}`);
  return input;
}

// Temporary, explicitly authorized unit-only CI on every platform, in both profiles.
// Integration suites remain available locally and are not dispatched by this plan.
export function createCiPlan(profile, files, sources) {
  if (!["default", "full"].includes(profile)) throw new Error(`Unknown CI profile: ${profile}`);
  if (!selectTests(files, sources, "unit").length) throw new Error("No unit tests discovered");
  return { include: ["ubuntu-24.04", "macos-latest", "windows-latest"].map(os => ({
    os, suite: "unit", title: testSuites.unit.title
  })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = fileURLToPath(new URL("../../test/", import.meta.url));
  const files = await discoverTestFiles(directory);
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(join(directory, file), "utf8")])));
  const profile = ciProfile(process.env.GITHUB_EVENT_NAME, process.env.CI_PROFILE);
  console.log(`profile=${profile}`);
  console.log(`matrix=${JSON.stringify(createCiPlan(profile, files, sources))}`);
}
