import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { gitOutput, runGit } from "../git.js";
import type { WorkspaceIdentity } from "../project/workspace.js";
import { pullRequestKey, type BindingContext, type PullRequestIdentity } from "./embedded-bindings.js";

const execute = promisify(execFile);
export type PrDiscovery = { status: "found" | "verified_none" | "ambiguous" | "unknown" | "not_applicable"; reason?: string };
export type EmbeddedDevelopmentContext = BindingContext & { root: string; head: string; master: string; base: string; discovery: PrDiscovery };
export type GhTransport = (args: string[], cwd: string, timeoutMs: number) => Promise<string>;
export const createGhTransport = (command: string, prefix: string[] = []): GhTransport => async (args, cwd, timeoutMs) => (await execute(command, [...prefix, ...args], {
  cwd, encoding: "utf8", windowsHide: true, timeout: timeoutMs, killSignal: "SIGTERM", maxBuffer: 10 * 1024 * 1024
})).stdout;
export const runGh = createGhTransport("gh");
const configValue = (config: Map<string, string[]>, key: string) => config.get(key.replace(/[^.]+$/, field => field.toLowerCase()))?.at(-1);
export async function readGitConfiguration(root: string): Promise<Map<string, string[]>> {
  const raw = await gitOutput(["config", "--null", "--list"], root);
  const config = new Map<string, string[]>();
  for (const entry of raw.split("\0").filter(Boolean)) {
    const newline = entry.indexOf("\n");
    const key = newline < 0 ? entry : entry.slice(0, newline);
    const value = newline < 0 ? "" : entry.slice(newline + 1);
    config.set(key, [...(config.get(key) ?? []), value]);
  }
  return config;
}
export function githubRepository(url: string): { host: string; repository: string } | undefined {
  const match = /^(?:https?:\/\/(?:[^/@]+@)?|ssh:\/\/(?:[^/@]+@)?|git@)(github\.com)(?::|\/)([^?#]+?)(?:\.git)?\/?$/.exec(url);
  if (!match) return undefined;
  const repository = match[2].replace(/\.git$/, "").replace(/\/$/, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) return undefined;
  return { host: match[1].toLowerCase(), repository: repository.toLowerCase() };
}
/** Resolve only push mappings whose destination follows from local Git facts. */
export function remoteHeadRef(config: Map<string, string[]>, branch: string, remote: string): string | undefined {
  const local = `refs/heads/${branch}`;
  const specs = config.get(`remote.${remote}.push`) ?? [];
  if (specs.length) {
    const destinations = new Set<string>();
    for (const raw of specs) {
      const spec = raw.replace(/^\+/, "");
      const parts = spec.split(":");
      if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
      const [source, destination] = parts;
      if (source.includes("*")) {
        if (source.split("*").length !== 2 || destination.split("*").length !== 2) return undefined;
        const [prefix, suffix] = source.split("*");
        if (local.startsWith(prefix) && local.endsWith(suffix)) destinations.add(destination.replace("*", local.slice(prefix.length, local.length - suffix.length || undefined)));
      } else if (source === local || source === branch) destinations.add(destination.startsWith("refs/") ? destination : `refs/heads/${destination}`);
    }
    return destinations.size === 1 && [...destinations][0].startsWith("refs/heads/") ? [...destinations][0] : undefined;
  }
  const mode = configValue(config, "push.default") ?? "simple";
  const upstreamRemote = configValue(config, `branch.${branch}.remote`);
  const merges = config.get(`branch.${branch}.merge`) ?? [];
  if (mode === "current") return local;
  if (mode === "upstream") return upstreamRemote === remote && merges.length === 1 && merges[0].startsWith("refs/heads/") ? merges[0] : undefined;
  if (mode === "simple") {
    if (upstreamRemote && upstreamRemote !== remote) return local;
    if (upstreamRemote === remote && merges.length === 1 && merges[0] === local) return local;
  }
  return undefined;
}
const repositoryInfoSchema = z.object({ full_name: z.string(), fork: z.boolean(), parent: z.object({ full_name: z.string() }).optional(), source: z.object({ full_name: z.string() }).optional() });
const prSchema = z.object({ number: z.number().int().positive(), head: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }).nullable() }), base: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }) }) });
export async function discoverPullRequests(root: string, branch: string | null, known: PullRequestIdentity[] = [], transport: GhTransport = runGh): Promise<{ pullRequests: PullRequestIdentity[]; discovery: PrDiscovery }> {
  if (!branch) return { pullRequests: [], discovery: { status: "not_applicable" } };
  try {
    const config = await readGitConfiguration(root);
    const remotes = (await gitOutput(["remote"], root)).split(/\r?\n/).filter(Boolean);
    if (!remotes.length) return { pullRequests: [], discovery: { status: "not_applicable" } };
    const name = branch.slice("refs/heads/".length);
    const remote = configValue(config, `branch.${name}.pushRemote`) ?? configValue(config, "remote.pushDefault")
      ?? configValue(config, `branch.${name}.remote`) ?? (remotes.length === 1 ? remotes[0] : undefined);
    if (!remote || remote === ".") return { pullRequests: [], discovery: { status: "unknown", reason: "Cannot determine a unique PR push remote" } };
    const urls = (await gitOutput(["remote", "get-url", "--push", "--all", remote], root)).split(/\r?\n/).filter(Boolean);
    const heads = urls.map(githubRepository);
    if (heads.every(h => !h)) return { pullRequests: [], discovery: { status: "not_applicable", reason: "PR discovery supports GitHub only" } };
    const repositories = new Set(heads.flatMap(h => h ? [h.repository] : []));
    const ref = remoteHeadRef(config, name, remote);
    if (heads.some(h => !h) || repositories.size !== 1 || !ref) return { pullRequests: [], discovery: { status: "unknown", reason: "Cannot determine a unique PR push repository and remote head ref" } };
    const head = [...repositories][0];
    // Capture only a deadline, never credentials or raw Git configuration in diagnostics.
    const deadline = Date.now() + 30_000;
    const query = async (endpoint: string, paginate = false): Promise<unknown> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("PR discovery timed out");
      return JSON.parse(await transport(["api", "--hostname", "github.com", ...(paginate ? ["--paginate", "--slurp"] : []), endpoint], root, Math.min(10_000, remaining)));
    };
    const info = repositoryInfoSchema.parse(await query(`repos/${head}`));
    if (info.full_name.toLowerCase() !== head || info.fork && !info.parent) throw new Error("Incomplete PR repository metadata");
    const bases = new Set([head, info.parent?.full_name.toLowerCase(), info.source?.full_name.toLowerCase(), ...known.filter(p => p.host === "github.com").map(p => p.repository)].filter((v): v is string => Boolean(v)));
    for (const r of remotes) {
      const repo = githubRepository(await gitOutput(["remote", "get-url", r], root));
      if (repo) bases.add(repo.repository);
    }
    const prs = new Map<string, PullRequestIdentity>();
    for (const base of bases) {
      if (!/^[^/\s]+\/[^/\s]+$/.test(base)) throw new Error("Invalid PR repository identity");
      const owner = head.split("/")[0];
      const endpoint = `repos/${base}/pulls?state=open&base=master&head=${encodeURIComponent(`${owner}:${ref.slice("refs/heads/".length)}`)}&per_page=100`;
      const pages = z.array(z.array(prSchema)).parse(await query(endpoint, true));
      for (const page of pages) for (const pr of page) {
        if (pr.head.repo?.full_name.toLowerCase() !== head || pr.head.ref !== ref.slice("refs/heads/".length) || pr.base.ref !== "master" || pr.base.repo.full_name.toLowerCase() !== base) continue;
        const identity = { host: "github.com", repository: base, number: pr.number };
        prs.set(pullRequestKey(identity), identity);
      }
    }
    const pullRequests = [...prs.values()].sort((a, b) => pullRequestKey(a).localeCompare(pullRequestKey(b)));
    return { pullRequests, discovery: { status: pullRequests.length > 1 ? "ambiguous" : pullRequests.length ? "found" : "verified_none" } };
  } catch {
    return { pullRequests: [], discovery: { status: "unknown", reason: "PR discovery unavailable or incomplete; local validation remains available. Check gh installation, authentication and remote configuration." } };
  }
}
export async function readEmbeddedGitFacts(root: string): Promise<{ head: string; master: string; base: string; branch: string | null }> {
  const head = await gitOutput(["rev-parse", "--verify", "HEAD"], root);
  const master = await gitOutput(["rev-parse", "--verify", "refs/heads/master"], root).catch(() => { throw new Error("Embedded validation requires local master; synchronize/create the integration ref before validating"); });
  const branchText = await gitOutput(["rev-parse", "--symbolic-full-name", "HEAD"], root);
  const branch = branchText === "HEAD" ? null : branchText;
  const bases = (await runGit(["merge-base", "--all", master, head], { cwd: root, allowFailure: true })).stdout.split(/\r?\n/).filter(Boolean);
  if (bases.length !== 1) throw new Error(`Embedded validation requires exactly one merge-base of master and HEAD (${bases.length ? "multiple common ancestors" : "no common ancestor"})`);
  if ((await gitOutput(["ls-files", "--unmerged"], root)).length) throw new Error("Resolve Git merge conflicts before validating Embedded Memory");
  return { head, master, base: bases[0], branch };
}
export async function readEmbeddedWorktreeGeneration(root: string): Promise<string | undefined> {
  const directory = await gitOutput(["rev-parse", "--absolute-git-dir"], root);
  // Directory creation evidence survives commits but changes when Git recreates
  // an administrative path. Without it, fallback must require explicit choice.
  return stat(directory, { bigint: true }).then(info =>
    info.birthtimeNs > 0n ? `${info.dev}:${info.ino}:${info.birthtimeNs}` : undefined).catch(() => undefined);
}
export async function readEmbeddedDevelopmentContext(workspace: WorkspaceIdentity, known: PullRequestIdentity[] = [], transport?: GhTransport): Promise<EmbeddedDevelopmentContext> {
  const facts = await readEmbeddedGitFacts(workspace.path);
  const instanceGeneration = await readEmbeddedWorktreeGeneration(workspace.path);
  return { ...facts, root: workspace.path, repositoryKey: workspace.key, instanceKey: workspace.instanceKey,
    instanceGeneration,
    ...await discoverPullRequests(workspace.path, facts.branch, known, transport) };
}
