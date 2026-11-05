import { z } from "zod";
import type { EffectiveRuleEntry, EffectiveRuleSection, EffectiveRuleTree } from "./memory/rules.js";

export type NodeId = string;
export type CommentId = string;
export type ReviewSource = { kind: "procedure" | "step" | "schema" | "statement"; path: string; memoryRef?: string };
export type ReviewRule = { rulePath: string; text: string };
export type ReviewNode = { nodeId: NodeId; name: string; kind?: "open_review"; source?: ReviewSource; defines: string[]; asserts: ReviewRule[]; suggests: ReviewRule[]; children: ReviewNode[] };
export type ReviewNodeTree = { root: ReviewNode };
export type ReviewRuleResult = { rulePath: string; result: "not_satisfied" | "undetermined"; commentIds: CommentId[] };
export type ReviewNodeState = { nodeId: NodeId; reported: boolean; applicable?: boolean; ruleResults: ReviewRuleResult[]; reasonCommentId?: CommentId; commentIds?: CommentId[] };
export type ReviewNodes = { nodeTree?: ReviewNodeTree; nodeStates?: ReviewNodeState[] };
export type ReviewNodeSource = { name: string; source: ReviewSource; defines?: string[]; asserts?: EffectiveRuleTree; suggests?: EffectiveRuleTree; children?: ReviewNodeSource[] };
export type NodeComment = { commentId?: string; id?: string; body: string; severity?: "blocking" | "risk" | "suggestion" };
export function reviewCommentId(comment: Pick<NodeComment, "commentId" | "id">): string {
  if (Boolean(comment.commentId) === Boolean(comment.id)) throw new Error("review_comment_identity_invalid");
  return (comment.commentId ?? comment.id)!;
}
const nonempty = z.string().trim().min(1);
export const reviewSourceSchema = z.object({ kind: z.enum(["procedure", "step", "schema", "statement"]), path: nonempty, memoryRef: nonempty.optional() }).strict();
export const reviewRuleSchema = z.object({ rulePath: nonempty, text: nonempty }).strict();
export const reviewNodeSchema: z.ZodType<ReviewNode> = z.lazy(() => z.object({ nodeId: nonempty, name: nonempty, kind: z.literal("open_review").optional(), source: reviewSourceSchema.optional(), defines: z.array(z.string()), asserts: z.array(reviewRuleSchema), suggests: z.array(reviewRuleSchema), children: z.array(reviewNodeSchema) }).strict());
export const reviewNodeTreeSchema = z.object({ root: reviewNodeSchema }).strict();
export const reviewNodeStateSchema = z.object({ nodeId: nonempty, reported: z.boolean(), applicable: z.boolean().optional(), ruleResults: z.array(z.object({ rulePath: nonempty, result: z.enum(["not_satisfied", "undetermined"]), commentIds: z.array(nonempty) }).strict()), reasonCommentId: nonempty.optional(), commentIds: z.array(nonempty).optional() }).strict();
const anchor = z.record(z.unknown()); // Native flow/graph adapters validate their existing anchor contract.
export const nodeCommentInputSchema = z.object({ rulePath: nonempty.optional(), result: z.enum(["not_satisfied", "undetermined"]).optional(), body: nonempty, severity: z.enum(["blocking", "risk", "suggestion"]), anchor: anchor.optional() }).strict();
export const nodeReportSchema = z.object({ applicable: z.boolean(), comments: z.array(nodeCommentInputSchema).optional() }).strict();
export const nodeUpdateSchema = nodeReportSchema.extend({ comments: z.array(nodeCommentInputSchema) });
export const nodeCommentUpdateSchema = z.object({ body: nonempty.optional(), severity: z.enum(["blocking", "risk", "suggestion"]).optional() }).strict().refine(x => x.body !== undefined || x.severity !== undefined, "review_comment_update_empty");
export const nodeSubmitSchema = z.object({ vote: z.enum(["approve", "request_changes", "abstain"]), summary: nonempty.optional() }).strict();
export type NodeCommentInput = z.infer<typeof nodeCommentInputSchema>;
export type NodeReport = z.infer<typeof nodeReportSchema>;
export type NodeMutation = { operation: "report"; artifact: NodeReport; expectedNodeId: string } | { operation: "update"; artifact: NodeReport & { comments: NodeCommentInput[] }; nodeId: string } | { operation: "comment-add"; artifact: NodeCommentInput; nodeId?: string } | { operation: "comment-update"; artifact: z.infer<typeof nodeCommentUpdateSchema>; commentId: string } | { operation: "comment-delete"; commentId: string };

export function allReviewNodes(tree: ReviewNodeTree): ReviewNode[] {
  const nodes: ReviewNode[] = [];
  const visit = (node: ReviewNode) => { nodes.push(node); node.children.forEach(visit); };
  visit(tree.root); return nodes;
}
export const needsNodeReport = (node: ReviewNode) => node.kind === "open_review" || node.asserts.length + node.suggests.length > 0;
export function currentReviewNode(value: ReviewNodes): ReviewNode | undefined {
  return value.nodeTree && allReviewNodes(value.nodeTree).find(n => needsNodeReport(n) && !value.nodeStates?.find(s => s.nodeId === n.nodeId)?.reported);
}
function nodeIds(state: ReviewNodeState): string[] { return [...state.ruleResults.flatMap(r => r.commentIds), ...(state.reasonCommentId ? [state.reasonCommentId] : []), ...(state.commentIds ?? [])]; }
function contentComplete(node: ReviewNode, state: ReviewNodeState, comments: readonly NodeComment[]) {
  if (node.kind === "open_review") return state.applicable === true && !state.reasonCommentId && !state.ruleResults.length;
  if (state.applicable === true) return !state.reasonCommentId;
  return state.applicable === false && !state.ruleResults.length && comments.some(c => reviewCommentId(c) === state.reasonCommentId && c.body.trim());
}
export function assertReviewNodes(value: ReviewNodes, comments: readonly NodeComment[], final = false) {
  comments.forEach(reviewCommentId);
  if (Boolean(value.nodeTree) !== Boolean(value.nodeStates)) throw new Error("review_nodes_pair_required");
  if (!value.nodeTree) return;
  reviewNodeTreeSchema.parse(value.nodeTree); z.array(reviewNodeStateSchema).parse(value.nodeStates);
  const nodes = allReviewNodes(value.nodeTree), states = value.nodeStates!;
  if (new Set(nodes.map(n => n.nodeId)).size !== nodes.length || new Set(states.map(s => s.nodeId)).size !== states.length || states.length !== nodes.length) throw new Error("review_node_identity_invalid");
  const opens = nodes.filter(n => n.kind === "open_review");
  if (opens.length !== 1 || nodes.at(-1) !== opens[0] || opens[0].children.length || opens[0].source || opens[0].asserts.length || opens[0].suggests.length) throw new Error("review_open_node_invalid");
  const ids = new Map(comments.map(c => [reviewCommentId(c), c]));
  if (ids.size !== comments.length || comments.some(c => !c.commentId)) throw new Error("review_comment_identity_invalid");
  const linked = new Set<string>();
  for (const node of nodes) {
    const s = states.find(s => s.nodeId === node.nodeId); if (!s) throw new Error("review_node_state_missing");
    const rules = [...node.asserts, ...node.suggests].map(r => r.rulePath);
    if (new Set(rules).size !== rules.length || rules.length && !node.source) throw new Error("review_node_source_invalid");
    if (node.kind !== "open_review" && s.commentIds !== undefined || node.kind === "open_review" && (s.reasonCommentId || s.ruleResults.length || s.applicable === false)) throw new Error("review_node_comment_kind_invalid");
    if (new Set(s.ruleResults.map(r => r.rulePath)).size !== s.ruleResults.length || s.ruleResults.some(r => !rules.includes(r.rulePath))) throw new Error("review_rule_result_invalid");
    for (const id of nodeIds(s)) { if (linked.has(id) || !ids.has(id)) throw new Error("review_comment_reference_invalid"); linked.add(id); }
    if (s.reported && !needsNodeReport(node)) throw new Error("review_organization_report_invalid");
    if (final && (needsNodeReport(node) && !s.reported || (needsNodeReport(node) || nodeIds(s).length || s.applicable !== undefined) && !contentComplete(node, s, comments))) throw new Error(`review_node_incomplete: ${node.nodeId}`);
  }
  if (linked.size !== comments.length) throw new Error("review_comment_unlinked");
}
export function reviewNodeProgress(value: ReviewNodes, status?: string) {
  if (!value.nodeTree) return undefined;
  const nodes = allReviewNodes(value.nodeTree).filter(needsNodeReport), processed = nodes.filter(n => value.nodeStates?.find(s => s.nodeId === n.nodeId)?.reported).length;
  return { phase: status === "submitted" ? "submitted" : status === "cancelled" ? "cancelled" : processed === nodes.length ? "final_review" : "reviewing", processed, total: nodes.length };
}
export function reviewNodeView(value: ReviewNodes, comments: readonly NodeComment[], options: { nodeId?: string; all?: boolean; list?: boolean; status?: string } = {}) {
  if (!value.nodeTree) throw new Error("review_nodes_not_enabled");
  assertReviewNodes(value, comments);
  const nodes = allReviewNodes(value.nodeTree), progress = reviewNodeProgress(value, options.status), current = currentReviewNode(value);
  const detail = (node: ReviewNode, full: boolean): Record<string, unknown> => {
    const state = value.nodeStates!.find(s => s.nodeId === node.nodeId)!;
    return { nodeId: node.nodeId, name: node.name, kind: node.kind, reported: state.reported, applicable: state.applicable, requiresReport: needsNodeReport(node), complete: contentComplete(node, state, comments), hasContent: state.applicable !== undefined || nodeIds(state).length > 0, isCurrent: node === current,
      ...(full ? { source: node.source, defines: node.defines, asserts: node.asserts, suggests: node.suggests } : {}),
      ruleResults: state.ruleResults, reasonCommentId: state.reasonCommentId, commentIds: nodeIds(state), comments: comments.filter(c => nodeIds(state).includes(reviewCommentId(c))) };
  };
  const path = (target: ReviewNode) => { const find = (node: ReviewNode, p: string[]): string[] | undefined => node === target ? [...p, node.name] : node.children.map(c => find(c, [...p, node.name])).find(Boolean); return find(value.nodeTree!.root, [])!; };
  if (options.list) {
    const visit = (n: ReviewNode): unknown => { const d = detail(n, false); delete d.ruleResults; delete d.comments; return { ...d, assertCount: n.asserts.length, suggestCount: n.suggests.length, children: n.children.map(visit) }; };
    return { progress, tree: visit(value.nodeTree.root) };
  }
  if (options.all) return { progress, nodes: nodes.map(n => detail(n, false)) };
  const node = options.nodeId ? nodes.find(n => n.nodeId === options.nodeId) : current;
  if (options.nodeId && !node) throw new Error(`review_node_not_found: ${options.nodeId}`);
  return node ? { progress, node: { ...detail(node, true), path: path(node) } } : { progress, nodes: nodes.filter(needsNodeReport).map(n => { const d = detail(n, false); delete d.comments; return d; }), comments };
}

export function createReviewNodes(sources: ReviewNodeSource[], openName: string): Required<ReviewNodes> {
  const empty = (name: string, source?: ReviewSource, defines: string[] = []): ReviewNode => ({ nodeId: "", name, ...(source ? { source } : {}), defines, asserts: [], suggests: [], children: [] });
  const projectSource = (s: ReviewNodeSource): ReviewNode => {
    const node = empty(s.name, s.source, s.defines);
    const sectionPositions = new Map<ReviewNode, number>();
    // Matching source positions merge the two projected channels. Different references remain distinct.
    const project = (parent: ReviewNode, entries: EffectiveRuleEntry[], sections: EffectiveRuleSection[], channel: "asserts" | "suggests") => {
      const counts = new Map<string, number>();
      const group = (key: string, name: string, source: ReviewSource, defines: string[]) => {
        const ordinal = counts.get(key) ?? 0; counts.set(key, ordinal + 1);
        const matches = parent.children.filter(n => n.source?.memoryRef === source.memoryRef && n.source?.path === source.path);
        const child = matches[ordinal] ?? empty(name, source, defines); if (!matches[ordinal]) parent.children.push(child); return child;
      };
      for (const entry of entries) {
        if (entry.kind === "rule") {
          const rulePath = entry.source ? entry.rulePath : `${parent.source!.path === "." ? "" : parent.source!.path + "."}${entry.rulePath}`;
          parent[channel].push({ rulePath, text: entry.text });
        } else {
          const source: ReviewSource = { kind: "statement", memoryRef: entry.target, path: "." };
          project(group(entry.target, entry.names?.[0] ?? entry.target, source, entry.defines ?? []), entry.entries, entry.sections, channel);
        }
      }
      for (const section of sections) {
        const raw = section.source, split = raw?.indexOf("#") ?? -1;
        if (!raw || split < 0) throw new Error("review_frozen_section_source_missing");
        const source: ReviewSource = { kind: "statement", memoryRef: raw.slice(0, split), path: raw.slice(split + 1) };
        const child = group(raw, section.name, source, section.defines);
        const index = /sections\[(\d+)\]$/.exec(source.path);
        if (!index) throw new Error("review_frozen_section_source_invalid");
        sectionPositions.set(child, Number(index[1]));
        project(child, section.entries, section.sections, channel);
      }
    };
    for (const tree of [s.asserts, s.suggests]) if (tree) project(node, tree.entries, tree.sections, tree.channel);
    // A channel omits sections without matching rules. Restore the original
    // sibling indexes after merging both channels, before assigning DFS ids.
    const orderSections = (parent: ReviewNode) => {
      parent.children.sort((a, b) => (sectionPositions.get(a) ?? -1) - (sectionPositions.get(b) ?? -1));
      parent.children.forEach(orderSections);
    };
    orderSections(node);
    node.children.push(...(s.children ?? []).map(projectSource)); return node;
  };
  const root = empty("Review"); root.children = sources.map(projectSource);
  root.children.push({ ...empty(openName), kind: "open_review" });
  const nodeTree = { root }, nodes = allReviewNodes(nodeTree); nodes.forEach((n, i) => n.nodeId = String(i + 1));
  return { nodeTree, nodeStates: nodes.map(n => ({ nodeId: n.nodeId, reported: false, ruleResults: [], ...(n.kind ? { commentIds: [] } : {}) })) };
}

/** Mutates a cloned personal record; caller validates and atomically persists the result. */
export function mutateReviewNode<C extends NodeComment>(value: Required<ReviewNodes>, comments: C[], mutation: NodeMutation, makeComment: (input: NodeCommentInput) => C): C[] {
  let saved = comments;
  const nodes = allReviewNodes(value.nodeTree), current = currentReviewNode(value);
  const targetId = mutation.operation === "comment-add" ? mutation.nodeId ?? current?.nodeId : mutation.operation === "update" ? mutation.nodeId : mutation.operation === "report" ? mutation.expectedNodeId : undefined;
  const node = targetId ? nodes.find(n => n.nodeId === targetId) : undefined;
  const state = node && value.nodeStates.find(s => s.nodeId === node.nodeId);
  const add = (n: ReviewNode, s: ReviewNodeState, input: NodeCommentInput) => {
    const c = nodeCommentInputSchema.parse(input);
    if (n.kind === "open_review") {
      if (c.rulePath || c.result) throw new Error("review_open_comment_has_no_rule");
    } else if (c.rulePath || c.result) {
      if (!c.rulePath || !c.result || ![...n.asserts, ...n.suggests].some(r => r.rulePath === c.rulePath)) throw new Error("review_rule_result_invalid");
      if (s.ruleResults.some(r => r.rulePath === c.rulePath && r.result !== c.result)) throw new Error("review_rule_result_conflict");
    } else if (s.reasonCommentId) throw new Error("review_reason_already_exists");
    const created = makeComment(c), id = reviewCommentId(created); saved.push(created);
    if (n.kind === "open_review") (s.commentIds ??= []).push(id);
    else if (c.rulePath) { let r = s.ruleResults.find(r => r.rulePath === c.rulePath); if (!r) { r = { rulePath: c.rulePath, result: c.result!, commentIds: [] }; s.ruleResults.push(r); } r.commentIds.push(id); }
    else s.reasonCommentId = id;
  };
  if (mutation.operation === "report" || mutation.operation === "update" || mutation.operation === "comment-add") {
    if (!node || !state) throw new Error(`review_node_required_or_not_found: ${targetId ?? "current"}`);
    if (mutation.operation === "comment-add") add(node, state, mutation.artifact);
    else {
      if (mutation.operation === "report" && (current?.nodeId !== mutation.expectedNodeId || !needsNodeReport(node))) throw new Error("review_report_current_node_conflict");
      const input = mutation.operation === "report" ? nodeReportSchema.parse(mutation.artifact) : nodeUpdateSchema.parse(mutation.artifact);
      if (node.kind && !input.applicable) throw new Error("review_open_node_must_be_completed");
      if (input.comments !== undefined) { const old = new Set(nodeIds(state)); saved = saved.filter(c => !old.has(reviewCommentId(c))); state.ruleResults = []; delete state.reasonCommentId; if (node.kind) state.commentIds = []; input.comments.forEach(c => add(node, state, c)); }
      state.applicable = input.applicable;
      if (mutation.operation === "report") { if (!contentComplete(node, state, saved)) throw new Error(`review_node_incomplete: ${node.nodeId}`); state.reported = true; }
    }
  } else {
    const c = saved.find(c => reviewCommentId(c) === mutation.commentId); if (!c) throw new Error("review_comment_not_found");
    if (mutation.operation === "comment-update") Object.assign(c, nodeCommentUpdateSchema.parse(mutation.artifact));
    else { saved = comments.filter(c => reviewCommentId(c) !== mutation.commentId);
      for (const s of value.nodeStates) { if (s.reasonCommentId === mutation.commentId) delete s.reasonCommentId; s.ruleResults.forEach(r => r.commentIds = r.commentIds.filter(id => id !== mutation.commentId)); if (s.commentIds) s.commentIds = s.commentIds.filter(id => id !== mutation.commentId); }
    }
  }
  assertReviewNodes(value, saved); return saved;
}
