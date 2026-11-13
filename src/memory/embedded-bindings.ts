import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { withNativeFileLock } from "../file-lock.js";

export const pullRequestIdentitySchema = z.object({
  host: z.string().min(1), repository: z.string().regex(/^[^/]+\/[^/]+$/), number: z.number().int().positive()
}).strict();
export type PullRequestIdentity = z.infer<typeof pullRequestIdentitySchema>;
export const embeddedBindingsSchema = z.object({
  pull_requests: z.array(pullRequestIdentitySchema),
  branches: z.array(z.object({ ref: z.string().startsWith("refs/heads/") }).strict()),
  worktrees: z.array(z.object({ instance_key: z.string().min(1), root: z.string().min(1).optional(), generation: z.string().min(1).optional() }).strict())
}).strict();
export type EmbeddedBindings = z.infer<typeof embeddedBindingsSchema>;
export type BindingContext = { repositoryKey: string; instanceKey: string; branch: string | null; pullRequests: PullRequestIdentity[]; root?: string; instanceGeneration?: string };
type BoundChange = { id: string; workspace_key: string; bindings?: EmbeddedBindings; source_worktree?: { instance_key: string; root?: string }; targets: Array<{ reference: string }>; status: string };
export function pullRequestKey(pr: PullRequestIdentity): string {
  return `${pr.host.toLowerCase()}/${pr.repository.toLowerCase()}#${pr.number}`;
}
export function mergeEmbeddedBindings(old: EmbeddedBindings | undefined, context: BindingContext): EmbeddedBindings {
  const prs = new Map((old?.pull_requests ?? []).map(pr => [pullRequestKey(pr), pr]));
  for (const pr of context.pullRequests) prs.set(pullRequestKey(pr), { ...pr, host: pr.host.toLowerCase(), repository: pr.repository.toLowerCase() });
  const worktrees = [...(old?.worktrees ?? []), { instance_key: context.instanceKey,
    ...(context.root ? { root: context.root } : {}), ...(context.instanceGeneration ? { generation: context.instanceGeneration } : {}) }];
  const worktreeKey = (w: EmbeddedBindings["worktrees"][number]) => JSON.stringify([w.instance_key, w.root, w.generation]);
  return {
    pull_requests: [...prs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, pr]) => pr),
    branches: [...new Set([...(old?.branches ?? []).map(b => b.ref), ...(context.branch ? [context.branch] : [])])].sort().map(ref => ({ ref })),
    worktrees: [...new Map(worktrees.map(w => [worktreeKey(w), w])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, w]) => w)
  };
}
export class EmbeddedChangeAmbiguityError extends Error {
  readonly code = "EMBEDDED_CHANGE_AMBIGUOUS";
  readonly candidates: Array<{ id: string; status: string; bindings?: EmbeddedBindings; source_worktree?: BoundChange["source_worktree"]; references: string[] }>;
  constructor(changes: BoundChange[], reason: string) {
    super(`${reason}: ${changes.map(c => c.id).sort().join(", ")}. Select with memsphere memory change validate --change <id>`);
    this.candidates = changes.map(c => ({ id: c.id, status: c.status, bindings: c.bindings, source_worktree: c.source_worktree, references: c.targets.map(t => t.reference) }));
  }
}
/** Bindings are facts on records; this index lives only for the current query. */
export function selectEmbeddedChange<T extends BoundChange>(changes: T[], context: BindingContext, explicit?: string): T | undefined {
  if (explicit !== undefined) return changes.find(c => c.id === explicit);
  const prs = new Set(context.pullRequests.map(pullRequestKey));
  const unproven = new Set<string>();
  const matched = changes.filter(c => {
    if (c.workspace_key !== context.repositoryKey || c.status !== "active") return false;
    // Git can recycle a removed worktree's administrative directory name. Legacy
    // source evidence from a different root does not identify this worktree.
    if (!c.bindings) return c.source_worktree?.instance_key === context.instanceKey
      && (context.root === undefined || c.source_worktree.root === context.root);
    const prMatch = c.bindings.pull_requests.some(p => prs.has(pullRequestKey(p)));
    const branchMatch = context.branch !== null && c.bindings.branches.some(b => b.ref === context.branch);
    // A worktree is a fallback before branching, not ownership of arbitrary new branches.
    const eligible = context.branch === null || c.bindings.branches.length === 0 || branchMatch;
    const worktrees = eligible ? c.bindings.worktrees.filter(w => w.instance_key === context.instanceKey
      && (!w.root || !context.root || w.root === context.root)
      && (!w.generation || !context.instanceGeneration || w.generation === context.instanceGeneration)) : [];
    const worktreeMatch = worktrees.some(w => w.root !== undefined && w.root === context.root
      && w.generation !== undefined && w.generation === context.instanceGeneration);
    const unknownWorktree = worktrees.some(w => !w.root || !context.root || !w.generation || !context.instanceGeneration);
    if (!prMatch && !branchMatch && !worktreeMatch && unknownWorktree) unproven.add(c.id);
    return prMatch || branchMatch || worktreeMatch || unknownWorktree;
  });
  if (context.pullRequests.length > 1 || matched.length > 1 || matched.some(c => !c.bindings || unproven.has(c.id))) {
    throw new EmbeddedChangeAmbiguityError(matched, context.pullRequests.length > 1 ? "Multiple matching PRs require an explicit ChangeSet" : "Ambiguous Embedded ChangeSet bindings");
  }
  return matched[0];
}
export function embeddedContextKeys(context: BindingContext): string[] {
  return [
    `${context.repositoryKey}:worktree:${context.instanceKey}`,
    ...(context.branch ? [`${context.repositoryKey}:branch:${context.branch}`] : []),
    ...context.pullRequests.map(pr => `${context.repositoryKey}:pr:${pullRequestKey(pr)}`)
  ].sort();
}
/** Permanent coordination inodes contain no binding facts. Competing writers fail immediately. */
export async function withEmbeddedContextLocks<T>(runtimeRoot: string, context: BindingContext, action: () => Promise<T>): Promise<T> {
  const directory = join(runtimeRoot, "embedded-context-locks");
  await mkdir(directory, { recursive: true });
  const keys = [...new Set(embeddedContextKeys(context))];
  const enter = async (index: number): Promise<T> => index === keys.length ? action() : withNativeFileLock(
    join(directory, `${createHash("sha256").update(keys[index]).digest("hex")}.lock`), () => enter(index + 1), { timeoutMs: 0 }
  );
  try { return await enter(0); }
  catch (error) {
    if ((error as { code?: string }).code === "LOCK_TIMEOUT") throw Object.assign(new Error("Embedded development context is being updated; retry validate"), { code: "EMBEDDED_CONTEXT_BUSY" });
    throw error;
  }
}
