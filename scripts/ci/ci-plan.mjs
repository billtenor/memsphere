import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverTestFiles, selectTests, testSuites, isUnitTest, isModuleTest, isIntegrationTest, isSystemTest, isPlatformTest } from "./test-plan.mjs";

export function ciProfile(event, input = "default") {
  if (event === "push") return "full";
  if (event !== "workflow_dispatch") return "default";
  if (!["default", "full"].includes(input)) throw new Error(`Unknown CI profile: ${input}`);
  return input;
}

const systems = ["ubuntu-24.04", "macos-latest", "windows-latest"];
const portableSuites = ["integration-model-ui", "integration-review-ui", "integration-cli", "integration-memory-and-projects", "integration-runtime-core"];
const nativeSuites = ["platform-process", "platform-locks", "platform-cli", "platform-rewind", "platform-filesystem", "platform-git", "platform-memory-publication", "platform-upgrade", "platform-context", "platform-artifacts", "platform-models"];

export function createCiPlan(profile, files, sources) {
  if (!["default", "full"].includes(profile)) throw new Error(`Unknown CI profile: ${profile}`);
  if (!selectTests(files, sources, "unit").length) throw new Error("No unit tests discovered");
  const unknown = files.filter(file => !isUnitTest(file) && !isModuleTest(file) && !isIntegrationTest(file) && !isSystemTest(file));
  if (unknown.length) throw new Error(`Tests need an explicit layer suffix: ${unknown.join(", ")}`);
  const include = systems.flatMap(os => ["unit", "module", "system", ...nativeSuites, ...(profile === "full" || os === "ubuntu-24.04" ? portableSuites : [])].flatMap(suite => {
    const selected = selectTests(files, sources, suite);
    if (!selected.length) return [];
    return [{ os, suite, layer: ["unit", "module", "system"].includes(suite) ? suite : "integration", title: testSuites[suite].title,
      browser: !["unit", "module"].includes(suite) && selected.some(file => sources[file].includes("helpers/browser") || /from ["']playwright["']/.test(sources[file])) }];
  }));
  for (const os of systems) {
    const expected = files.filter(file => profile === "full" || os === "ubuntu-24.04" || isUnitTest(file) || isModuleTest(file) || isSystemTest(file) || isPlatformTest(file, sources[file])).sort();
    const assigned = include.filter(row => row.os === os).flatMap(row => selectTests(files, sources, row.suite)).sort();
    if (JSON.stringify(assigned) !== JSON.stringify(expected)) throw new Error(`Unassigned or duplicate tests on ${os}`);
  }
  return { include };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = fileURLToPath(new URL("../../test/", import.meta.url));
  const files = await discoverTestFiles(directory);
  const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(join(directory, file), "utf8")])));
  const profile = ciProfile(process.env.GITHUB_EVENT_NAME, process.env.CI_PROFILE);
  console.log(`profile=${profile}`);
  const plan = createCiPlan(profile, files, sources);
  console.log(`matrix=${JSON.stringify(plan)}`);
  console.log(`unit_matrix=${JSON.stringify({include: plan.include.filter(row => row.layer === "unit")})}`);
  console.log(`module_matrix=${JSON.stringify({include: plan.include.filter(row => row.layer === "module")})}`);
  console.log(`system_matrix=${JSON.stringify({include: plan.include.filter(row => row.layer === "system")})}`);
  console.log(`integration_matrix=${JSON.stringify({include: plan.include.filter(row => row.layer === "integration")})}`);
}
