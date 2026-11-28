import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createCiPlan } from "./ci-plan.mjs";
import { isWindowsPackageSmokeTest, selectTests } from "./test-plan.mjs";

const exec = promisify(execFile);
const git = async (cwd, ...args) =>
  (await exec("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).stdout;
const fullSha = /^[a-f0-9]{40}$/i;
const platforms = { linux: "ubuntu-24.04", darwin: "macos-latest", win32: "windows-latest" };
export const ciPlatform = platform => platforms[platform];

const changeShowConsumers = [
  "changeset-external.system.test.ts",
  "platform/memory-publication/memory-change-show-cli.system.test.ts",
  "platform/memory-publication/memory-checkpoint-corruption.system.test.ts",
  "platform/memory-publication/memory-checkpoint-evidence.system.test.ts",
  "platform/memory-publication/memory-publication-race-cli.system.test.ts"
];
const helperConsumers = new Map([
  ["test/helpers/change-show.ts", changeShowConsumers],
  ["test/helpers/reviewer-session.ts", [
    "list-pagination-cli.system.test.ts",
    "reviewer-export-race.system.test.ts",
    "reviewer-session-integration.system.test.ts",
    ...changeShowConsumers
  ]],
  ["test/helpers/app-settings.ts", [
    "app-settings-browser.system.test.ts",
    "app-settings-http.system.test.ts",
    "app-settings.integration.test.ts",
    "platform/cli/app-settings.integration.test.ts"
  ]]
]);
const repositoryGuides = new Set(["README.md", "README.en.md", "CONTRIBUTING.md"]);
const packageWorkflow = ".github/workflows/ci.yml / Windows packaged CLI shells";
const packagesWindows = path =>
  path.startsWith("test/packaged-cli/") || path === "scripts/ci/windows-package-smoke.mjs";

export function readChanges(data) {
  if (!data) return [];
  const fields = data.split("\0");
  if (fields.pop() !== "") throw new Error("Git change list did not end with NUL");
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const source = fields[index++];
    const paired = /^[RC]\d+$/.test(status);
    const path = paired ? fields[index++] : source;
    if (!status || !source || !path) throw new Error("Incomplete Git change record");
    changes.push({ status, path, ...(paired ? { source } : {}) });
  }
  return changes;
}

export async function readCandidate(cwd, base, expected = undefined) {
  if (!fullSha.test(base ?? "")) throw new Error("Provide the full base commit SHA");
  const root = (await git(cwd, "rev-parse", "--show-toplevel")).trimEnd();
  const candidate = (await git(root, "rev-parse", "HEAD")).trim();
  if (await git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")) {
    throw new Error("Use a clean checkout of the merge candidate");
  }
  const resolved = (await git(root, "rev-parse", "--verify", base + "^{commit}")).trim();
  if (resolved !== base.toLowerCase()) throw new Error("Base SHA must identify a commit");
  await git(root, "merge-base", "--is-ancestor", resolved, candidate).catch(error => {
    if (error.code === 1) throw new Error("Base is not an ancestor of the checkout");
    throw error;
  });
  if (expected) {
    const parents = (await git(root, "show", "-s", "--format=%P", candidate)).trim().split(" ");
    if (candidate !== expected.candidate || parents.length !== 2
      || parents[0] !== resolved || parents[1] !== expected.head) {
      throw new Error("Checkout does not match the fixed PR merge candidate and parents");
    }
  }
  const entries = await git(root, "ls-tree", "-r", "-z", candidate, "--", "test/");
  const files = entries.split("\0").flatMap(entry => {
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    return /^100[67]\d\d blob /.test(entry.slice(0, tab)) && path.endsWith(".test.ts")
      ? [path.slice("test/".length)] : [];
  });
  const sources = Object.fromEntries(await Promise.all(files.map(async file =>
    [file, await readFile(join(root, "test", file), "utf8")])));
  const changes = readChanges(await git(root, "diff", "--name-status", "-z", "--find-renames", resolved, candidate, "--"));
  return { root, base: resolved, candidate, files, sources, changes };
}

export function createChangedTestPlan({ base, candidate, files, sources, changes }) {
  const full = createCiPlan("full", files, sources).include;
  const defaults = createCiPlan("default", files, sources).include;
  const defaultJobs = new Set(defaults.map(({ os, suite }) => jobKey({ os, suite })));
  const candidateFiles = new Set(files);
  const selected = new Map();
  const pending = [];
  const excluded = [];
  const choose = (file, change, reason) => {
    const entries = selected.get(file) ?? [];
    entries.push({ ...change, reason });
    selected.set(file, entries);
  };
  const requireEvidence = (change, reason, next) => pending.push({ ...change, reason, next });
  const reviewImpact = (change, reason) =>
    requireEvidence(change, reason, "Review the impact and run the affected verification separately.");

  for (const change of changes) {
    const { path, source, status } = change;
    const file = path.slice("test/".length);
    const sourceFile = source?.slice("test/".length);
    if (packagesWindows(path) || (source && packagesWindows(source))) {
      requireEvidence(change, "Windows packaged CLI requires a packaged install and shell coverage.",
        `Run ${packageWorkflow} for the candidate with Windows PowerShell 5.1, PowerShell 7, CMD and Git Bash.`);
      if (packagesWindows(path)) continue;
    }
    if (status === "D") {
      reviewImpact(change, "Deleted path requires coverage review.");
      continue;
    }
    if (source && !packagesWindows(source) && !repositoryGuides.has(source)) {
      const equivalentLayer = source.startsWith("test/") && path.startsWith("test/") && candidateFiles.has(file)
        && sourceFile.match(/\.(unit|module|integration|system|e2e)\.test\.ts$/)?.[1]
          === file.match(/\.(unit|module|integration|system|e2e)\.test\.ts$/)?.[1]
        && !file.endsWith(".integration.test.ts");
      if (!equivalentLayer) reviewImpact(change, "Source path and its previous coverage require review.");
    }
    if (!/^(A|M|R\d+|C\d+)$/.test(status)) {
      reviewImpact(change, "Unsupported Git change kind.");
    } else if (path.startsWith("test/") && candidateFiles.has(file) && !isWindowsPackageSmokeTest(file)) {
      choose(file, change, "Changed test file.");
    } else if (helperConsumers.has(path) && !source) {
      for (const consumer of helperConsumers.get(path)) {
        if (candidateFiles.has(consumer)) choose(consumer, change, "Explicit helper consumer.");
        else reviewImpact(change, `Mapped consumer is missing: test/${consumer}`);
      }
    } else if (repositoryGuides.has(path)) {
      excluded.push({ ...change, reason: "Repository guide does not select tests." });
    } else {
      reviewImpact(change, path.startsWith("scripts/ci/") || path.startsWith(".github/workflows/") ||
        ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.modules.json"].includes(path)
        ? "Runner or repository-wide configuration may affect multiple suites."
        : "No known Full-only target mapping.");
    }
  }

  const mapped = new Set();
  const jobs = full.filter(row => !defaultJobs.has(jobKey(row))).flatMap(row => {
    const targets = selectTests(files, sources, row.suite).filter(file => selected.has(file)).map(file => {
      mapped.add(file);
      return { path: file, triggers: selected.get(file) };
    });
    return targets.length ? [{ ...row, files: targets }] : [];
  });
  for (const [file, triggers] of selected) {
    if (!mapped.has(file)) excluded.push({ path: "test/" + file, triggers, reason: "Already covered by default CI." });
  }
  return { base, candidate, status: pending.length ? "needs_evidence" : jobs.length ? "planned" : "empty",
    jobs, pending, excluded };
}

export const jobKey = ({ os, suite }) => `${os}/${suite}`;
