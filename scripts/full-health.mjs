import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "billtenor/memsphere";
export const WORKFLOW_ID = 335696122;
export const CONTEXT = "Merge gate / full regression";
export const LEGACY_CONTEXT = "Full health / master";
const bootstrapTitles = ["Initialize PR merge gate", "Full health bootstrap"];
export const FULL_JOB = "Full cross-platform regression";
export const ACTIONS_APP_ID = 15368;
const target = `https://github.com/${REPOSITORY}/actions/workflows/ci.yml`;
const result = (state, description, run) => ({ state, description, target_url: run?.html_url || target });

// A PR's own latest full is an explicit repair escape hatch, including while master is waiting.
export function decideHealth(master, own, hasMasterHistory = true) {
  if (own) return result(own.state, `PR full: ${own.reason}`, own.run);
  if (master) return result(master.state, `master full: ${master.reason}`, master.run);
  return hasMasterHistory
    ? result("pending", "Waiting for full on the latest master commit")
    : result("failure", "No master full history; run full manually on master or this PR head");
}

export function requiredCheckRules(rules, remove = false) {
  const copy = structuredClone(rules);
  const rule = copy.find(item => item.type === "required_status_checks");
  if (remove) {
    if (!rule) return copy;
    rule.parameters.required_status_checks = rule.parameters.required_status_checks.filter(
      check => !(check.context === CONTEXT && check.integration_id === ACTIONS_APP_ID));
    return rule.parameters.required_status_checks.length ? copy : copy.filter(item => item !== rule);
  }
  if (rule) {
    const existing = rule.parameters.required_status_checks.find(check => check.context === CONTEXT);
    if (existing && existing.integration_id !== ACTIONS_APP_ID) throw new Error("Merge gate context has an unexpected source");
    if (!existing) rule.parameters.required_status_checks.push({ context: CONTEXT, integration_id: ACTIONS_APP_ID });
  } else copy.push({ type: "required_status_checks", parameters: {
    required_status_checks: [{ context: CONTEXT, integration_id: ACTIONS_APP_ID }],
    strict_required_status_checks_policy: false, do_not_enforce_on_create: false
  } });
  return copy;
}

export function createApi({ token, fetchImpl = fetch, apiUrl = "https://api.github.com" }) {
  const base = `${apiUrl}/repos/${REPOSITORY}`;
  async function request(path, { method = "GET", body, allowMissing = false } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000)
    });
    if (allowMissing && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  }
  async function list(path, key) {
    const items = [];
    for (let page = 1; ; page++) {
      const data = await request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const batch = key ? data[key] : data;
      if (!Array.isArray(batch)) throw new Error(`Invalid GitHub list: ${path}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }
  return { request, list };
}

export async function verifySource(api) {
  const workflow = await api.request("/actions/workflows/ci.yml");
  if (workflow.id !== WORKFLOW_ID || workflow.path !== ".github/workflows/ci.yml") throw new Error("Unexpected CI workflow identity");
  const repo = await api.request("");
  if (repo.full_name !== REPOSITORY || repo.default_branch !== "master") throw new Error("Unexpected repository/default branch");
}

export async function fullEvidence(api, run) {
  if (run.workflow_id !== WORKFLOW_ID || run.repository?.full_name !== REPOSITORY) return undefined;
  if (!(run.event === "workflow_dispatch" || ((run.event === "push" || run.event === "schedule") && run.head_branch === "master"))) return undefined;
  if (bootstrapTitles.includes(run.display_title) || run.display_title === "CI (default)") return undefined;
  const marked = run.display_title === "CI (full)" || run.event === "schedule";
  // Pushes only became full when the fixed profile marker was introduced.
  // Earlier master pushes were default and must not require a jobs query each.
  if (run.event === "push" && !marked) return undefined;
  let jobs;
  if (!marked || run.status === "completed") {
    jobs = await api.list(`/actions/runs/${run.id}/attempts/${run.run_attempt || 1}/jobs`, "jobs");
  }
  const summaries = jobs?.filter(job => job.name === FULL_JOB) || [];
  if (!marked && !summaries.some(job => job.status !== "completed" || job.conclusion !== "skipped")) return undefined;
  if (run.status !== "completed") {
    // Preserve the previous attempt in the audit evidence; it must never supply an old green light.
    const previous = run.run_attempt > 1 ? await api.request(`/actions/runs/${run.id}/attempts/${run.run_attempt - 1}`) : undefined;
    return { state: "pending", reason: `waiting (${run.status}, attempt ${run.run_attempt || 1})`, run,
      ...(previous ? { previousConclusion: previous.conclusion } : {}) };
  }
  if (run.conclusion !== "success") return { state: "failure", reason: run.conclusion || "missing conclusion", run };
  const success = summaries.length === 1 && summaries[0].status === "completed" && summaries[0].conclusion === "success";
  return { state: success ? "success" : "failure", reason: success ? "passed" : "full summary missing or not successful", run };
}

async function latestFull(api, runs) {
  const sorted = [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  for (const run of sorted) {
    if (!Number.isFinite(Date.parse(run.created_at))) throw new Error("Invalid CI creation timestamp");
    const evidence = await fullEvidence(api, run);
    if (evidence) return evidence;
  }
}

async function masterSha(api) {
  const ref = await api.request("/git/ref/heads/master");
  if (!/^[0-9a-f]{40}$/.test(ref.object?.sha)) throw new Error("Invalid master SHA");
  return ref.object.sha;
}

export async function computeHealth(api, sha, master) {
  const path = `/actions/workflows/${WORKFLOW_ID}/runs`;
  const ownRuns = await api.list(`${path}?head_sha=${sha}`, "workflow_runs");
  const own = await latestFull(api, ownRuns.filter(run => run.head_sha === sha));
  if (own) return { ...decideHealth(undefined, own), masterSha: master, own };
  // Restrict the common path to the current SHA; complete history is only needed
  // to distinguish first installation from a new master commit awaiting its run.
  const masterRuns = await api.list(`${path}?branch=master&head_sha=${master}`, "workflow_runs");
  const current = await latestFull(api, masterRuns.filter(run => run.head_sha === master && run.head_branch === "master"));
  const history = current || await latestFull(api,
    (await api.list(`${path}?branch=master`, "workflow_runs")).filter(run => run.head_branch === "master"));
  return { ...decideHealth(current, undefined, Boolean(history)), masterSha: master, master: current };
}

export async function verifyBootstrap(api, env) {
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_ACTOR !== REPOSITORY.split("/")[0]
    || !/^[0-9a-f]{40}$/.test(env.REVIEWED_SHA || "") || env.REVIEWED_SHA !== env.GITHUB_SHA) {
    throw new Error("Bootstrap requires owner workflow_dispatch at the exact reviewed SHA");
  }
  const installed = await api.request("/contents/.github/workflows/full-health.yml?ref=master", { allowMissing: true });
  if (installed) throw new Error("Merge gate publisher is installed on master; use the trusted master refresh workflow");
}

// All callers refresh all open master PRs, so coalesced/late events still converge on current facts.
export async function refreshHealth(api, { publish = false, bootstrap = false, env = process.env } = {}) {
  if (bootstrap) await verifyBootstrap(api, env);
  const pulls = await api.list("/pulls?state=open&base=master");
  const reports = [];
  const errors = [];
  // During rollout the old context is still required: revoke it before touching
  // the new name. Each request is attempted once; API errors fail the refresh.
  const contexts = env.FULL_HEALTH_PUBLISH_LEGACY === "true" ? [LEGACY_CONTEXT, CONTEXT] : [CONTEXT];
  const writeStatus = (sha, status, context) => api.request(`/statuses/${sha}`, { method: "POST", body: {
    context, state: status.state, description: status.description.slice(0, 140), target_url: status.target_url
  } });
  const post = async (sha, status) => {
    for (const context of contexts) await writeStatus(sha, status, context);
  };
  // Revoke all old green lights before potentially slow history/job queries.
  if (publish) {
    const failures = [];
    // Finish the old-context phase for every PR before any new-context write.
    // A failure must not leave other writable PR gates with stale green lights.
    for (const context of contexts) for (const pull of pulls) {
      try { await writeStatus(pull.head.sha, result("pending", "Refreshing merge gate"), context); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join("\n"));
  }
  try {
    await verifySource(api);
  } catch (error) {
    if (publish) for (const pull of pulls) await post(pull.head.sha, result("error", "Merge gate identity query failed; refresh on master"));
    throw error;
  }
  for (const item of pulls) {
    let sha = item.head.sha;
    try {
      let settled = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const pull = await api.request(`/pulls/${item.number}`);
        if (pull.state !== "open" || pull.base.ref !== "master") { settled = true; break; }
        sha = pull.head.sha;
        if (publish) await post(sha, result("pending", "Refreshing merge gate"));
        const master = await masterSha(api);
        const health = await computeHealth(api, sha, master);
        const freshPull = await api.request(`/pulls/${item.number}`);
        const freshMaster = await masterSha(api);
        if (freshPull.state !== "open" || freshPull.base.ref !== "master") { settled = true; break; }
        if (freshPull.head.sha !== sha || freshMaster !== master) continue;
        if (publish) await post(sha, health);
        reports.push({ number: item.number, sha, ...health });
        settled = true;
        break;
      }
      if (!settled) throw new Error("Head/master changed repeatedly; retry trusted refresh");
    } catch (error) {
      errors.push(`PR #${item.number}: ${error.message}`);
      if (publish) await post(sha, result("error", "Merge gate query failed; refresh on master"));
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return reports;
}

async function main() {
  const env = process.env;
  if (env.GITHUB_REPOSITORY !== REPOSITORY || !env.GITHUB_TOKEN) throw new Error("Expected repository and GITHUB_TOKEN are required");
  const api = createApi({ token: env.GITHUB_TOKEN, apiUrl: env.GITHUB_API_URL });
  const bootstrap = process.argv.includes("--bootstrap");
  const publish = process.argv.includes("--publish");
  if (publish && !bootstrap) {
    // The trusted workflow fixes checkout to refs/heads/master and records git HEAD.
    // An event's GITHUB_SHA can be older after queueing: it is not a code-source pin.
    // API checks belong inside refresh, after stale statuses have been revoked.
    if (env.GITHUB_REF !== "refs/heads/master" || !/^[0-9a-f]{40}$/.test(env.CHECKED_OUT_SHA || "")) {
      throw new Error("Publisher requires a trusted master checkout; retry on master");
    }
  }
  // Ignore ordinary default CI events without touching statuses.
  if (!bootstrap && env.GITHUB_EVENT_NAME === "workflow_run") {
    const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
    // This filter only saves work for explicitly inapplicable profiles. Actual health is
    // always recomputed from the API, including unknown/legacy or out-of-order events.
    if (["CI (default)", ...bootstrapTitles].includes(event.workflow_run?.display_title)) return;
  }
  const reports = await refreshHealth(api, { publish, bootstrap, env });
  console.log(JSON.stringify(reports.map(({ number, sha, state, description, target_url, masterSha }) =>
    ({ number, sha, state, description, target_url, masterSha })), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
