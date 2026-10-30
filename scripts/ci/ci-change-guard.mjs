import { pathToFileURL } from "node:url";
import { createApi, REPOSITORY } from "./full-health.mjs";

export const CONTEXT = "CI change guard";
// CI infrastructure is protected by directory. These explicit files implement
// repository security policy; product build/dependency configuration is not CI policy.
export const PROTECTED_FILES = [
  "scripts/security-check.sh", "scripts/security-setup.sh",
  ".gitleaks-privacy.toml", ".gitleaksignore"
];
const protectedFiles = new Set(PROTECTED_FILES);
export const AUTHORIZATION_MESSAGE = "等 CI 机制不允许在 human 未授权的情况下修改。请检查修改的必要性，或者请求 human 授权";
export const HUMAN_INSTRUCTIONS = "Human 请在 GitHub PR 合并区域手工绕过 CI change protection 规则并亲自合并；其他合并规则仍须满足。";
export const isProtected = path => path.startsWith(".github/workflows/") || path.startsWith("test/ci/") || path.startsWith("scripts/ci/") || protectedFiles.has(path);

function validPath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").some(part => part === ".." || part === ".")) {
    throw new Error("Invalid PR file path");
  }
  return path;
}

export function protectedChanges(files) {
  const matches = new Set();
  for (const file of files) {
    if (!file || !["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"].includes(file.status)) {
      throw new Error("Invalid PR file status");
    }
    const paths = [validPath(file.filename)];
    if (file.status === "renamed") paths.push(validPath(file.previous_filename));
    for (const path of paths) if (isProtected(path)) matches.add(path);
  }
  return [...matches].sort();
}

export function failureDescription(paths) {
  const full = `${paths.map(path => JSON.stringify(path)).join("、")} ${AUTHORIZATION_MESSAGE}`;
  return full.length <= 140 ? full : `${paths.length} 个 CI 文件被修改；完整文件列表与 human 授权说明见日志`;
}

export function failureLines(paths) {
  // JSON escaping and a fixed prefix keep PR-controlled filenames out of workflow commands.
  return [...paths.map(path => `CI change guard: ${JSON.stringify(path)} ${AUTHORIZATION_MESSAGE}`), HUMAN_INSTRUCTIONS];
}

function validatePull(pull) {
  if (!Number.isSafeInteger(pull.number) || pull.number < 1 || !/^[0-9a-f]{40}$/.test(pull.head?.sha)
    || !/^[0-9a-f]{40}$/.test(pull.base?.sha)) throw new Error("Invalid PR identity");
}

export async function readPullFiles(api, pull) {
  const count = pull.changed_files;
  if (!Number.isSafeInteger(count) || count < 0 || count > 3000) throw new Error("Incomplete PR diff: invalid count or GitHub's 3000-file limit exceeded");
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await api.request(`/pulls/${pull.number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length > 100) throw new Error("Invalid PR files response");
    files.push(...batch);
    if (batch.length < 100 || files.length >= count) break;
  }
  if (files.length !== count || new Set(files.map(file => file.filename)).size !== count) throw new Error("Incomplete or duplicate PR files response");
  // Validate every path, even on ordinary changes; malformed renames must never pass.
  protectedChanges(files);
  return files;
}

export async function refreshGuard(api, { publish = false, log = console.log, targetUrl } = {}) {
  const repo = await api.request("");
  if (repo.full_name !== REPOSITORY || repo.default_branch !== "master") throw new Error("Unexpected repository/default branch");
  const pulls = await api.list("/pulls?state=open&base=master");
  const url = targetUrl || `https://github.com/${REPOSITORY}/actions/workflows/ci-change-guard.yml`;
  const write = (sha, state, description) => publish ? api.request(`/statuses/${sha}`, { method: "POST", body: {
    context: CONTEXT, state, description, target_url: url
  } }) : Promise.resolve();
  // Invalidate all listed PRs first, so one failed query cannot leave another stale green light.
  if (publish) {
    const pendingErrors = [];
    for (const pull of pulls) {
      try { validatePull(pull); await write(pull.head.sha, "pending", "正在检查 CI 文件变更"); }
      catch (error) { pendingErrors.push(error); }
    }
    if (pendingErrors.length) throw new AggregateError(pendingErrors, "Unable to invalidate all CI guard statuses");
  }
  const reports = [];
  for (const item of pulls) {
    let sha = item.head?.sha;
    try {
      validatePull(item);
      let settled = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const pull = await api.request(`/pulls/${item.number}`);
        validatePull(pull);
        if (pull.state !== "open" || pull.base.ref !== "master") { settled = true; break; }
        sha = pull.head.sha;
        await write(sha, "pending", "正在检查 CI 文件变更");
        const files = await readPullFiles(api, pull);
        const current = await api.request(`/pulls/${item.number}`);
        validatePull(current);
        if (current.state !== "open" || current.base.ref !== "master") { settled = true; break; }
        if (current.head.sha !== sha || current.base.sha !== pull.base.sha || current.changed_files !== pull.changed_files) continue;
        const paths = protectedChanges(files);
        const state = paths.length ? "failure" : "success";
        const description = paths.length ? failureDescription(paths) : "未修改受保护的 CI 文件";
        log(`CI change guard: PR #${pull.number}, head ${sha}: ${state}`);
        if (paths.length) for (const line of failureLines(paths)) log(line);
        await write(sha, state, description);
        reports.push({ number: pull.number, sha, state, paths });
        settled = true;
        break;
      }
      if (!settled) throw new Error("PR head/base kept changing; refresh the guard");
    } catch (error) {
      log(`CI change guard: PR #${item.number}: ${JSON.stringify(error.message)}`);
      if (/^[0-9a-f]{40}$/.test(sha || "")) {
        try { await write(sha, "error", "CI 文件差异核验失败；请查看日志并重新运行 guard"); }
        catch (postError) { log(`CI change guard: status write failed: ${JSON.stringify(postError.message)}`); }
      }
      reports.push({ number: item.number, sha, state: "error", error: error.message });
    }
  }
  return reports;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== "--publish")) throw new Error("Usage: node scripts/ci/ci-change-guard.mjs [--publish]");
    if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required");
    const reports = await refreshGuard(createApi({ token: process.env.GITHUB_TOKEN, apiUrl: process.env.GITHUB_API_URL }), {
      publish: process.argv.includes("--publish"),
      targetUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined
    });
    // A published policy rejection is a successful refresh. Only operational
    // failures should also fail the publisher job; the guard status still blocks.
    if (reports.some(report => report.state === "error")) process.exitCode = 1;
  } catch (error) {
    console.error(`CI change guard: ${error.message}`);
    process.exitCode = 1;
  }
}
