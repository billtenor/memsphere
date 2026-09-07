import type { ViewUi, ContentComponentKind } from "@memsphere/view-sdk";

export function presentContent(kind: ContentComponentKind, content: HTMLElement, ui?: ViewUi): HTMLElement {
  return ui ? ui.contentComponent({ kind, content, defaultRender: () => content }) : content;
}

export type ContentFlowKind = "action" | "branch" | "loop" | "call";
export type ContentFlowBranchKind = "then" | "do" | "else";

export interface ContentFlowNode<T = unknown> {
  readonly id: string;
  readonly path: string;
  readonly kind: ContentFlowKind;
  readonly action: string;
  readonly target?: string;
  readonly source: T;
  readonly content: T;
  readonly branches?: readonly ContentFlowBranch<T>[];
}

export interface ContentFlowBranch<T = unknown> {
  readonly kind: ContentFlowBranchKind;
  readonly nodes: readonly ContentFlowNode<T>[];
}

export interface ContentFlowLabels {
  readonly step: string;
  readonly if: string;
  readonly while: string;
  readonly call: string;
  readonly else: string;
}

export interface ContentFlowHooks<T = unknown> {
  readonly ui?: ViewUi;
  readonly labels: ContentFlowLabels;
  renderAction?(node: ContentFlowNode<T>): Node;
  renderCallTarget?(node: ContentFlowNode<T>): Node;
  renderMeta?(node: ContentFlowNode<T>): Node | null | undefined;
  renderBody?(node: ContentFlowNode<T>): readonly Node[];
  decorateNode?(element: HTMLElement, node: ContentFlowNode<T>): void;
  decorateHead?(element: HTMLElement, node: ContentFlowNode<T>): void;
}

export const contentFlowStyles = `
  [data-mem-content-canvas]{position:relative;min-width:0;margin:16px 0;padding:20px;border:1px solid var(--line);border-radius:12px;background:var(--surface);font-size:13px;line-height:1.65}
  [data-mem-content-list]{display:grid;gap:8px;margin:0;padding-left:20px;font-size:13px;line-height:1.65}
  [data-mem-content-list]>li{padding:2px 4px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:inherit;line-height:inherit}
  [data-mem-content-flow]{display:grid;gap:12px;min-width:0}
  [data-mem-content-flow] .mem-content-flow-node{position:relative;min-width:0;max-width:100%;margin:0;padding:0;overflow:hidden;border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:none}
  [data-mem-content-flow] .mem-content-flow-node.call{border-left-color:var(--muted)}
  [data-mem-content-flow] .mem-content-flow-node.is-branch{border-left-color:var(--accent)}
  [data-mem-content-flow] .mem-content-flow-node.current{border-left-color:var(--accent)}
  [data-mem-content-flow] .mem-content-flow-head{display:flex;align-items:flex-start;gap:10px;min-width:0;padding:11px 13px;flex-wrap:wrap}
  [data-mem-content-flow] .mem-content-flow-label{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;border-radius:999px;background:var(--soft);color:var(--accent);padding:2px 8px;font-size:11px;font-weight:650;line-height:1.4}
  [data-mem-content-flow] .mem-content-flow-action{min-width:0;flex:1 1 240px;margin:0;font-size:13px;font-weight:650;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
  [data-mem-content-flow] .mem-content-flow-branch{min-width:0;border-top:1px solid var(--line);background:var(--surface);padding:9px 12px 12px 24px}
  [data-mem-content-flow] .mem-content-flow-condition{margin-bottom:7px;color:var(--muted);font-size:11px;font-weight:650;line-height:1.4}
  [data-mem-content-flow] .mem-content-flow-children{display:grid;gap:8px;min-width:0;margin:0;padding:0;border:0}
  [data-mem-content-flow] .mem-content-artifact-contract{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto}
  [data-mem-content-flow] :is(.mem-content-artifact-summary,.mem-content-artifact-details,.mem-content-review-summary,.mem-content-review-details){display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}
  [data-mem-content-flow] :is(.mem-content-artifact-label,.mem-content-review-count){color:var(--muted);font-size:11px;font-weight:650;line-height:1.4}
  @media(max-width:820px){[data-mem-content-flow] .mem-content-flow-head{display:grid}[data-mem-content-flow] .mem-content-artifact-contract{margin-left:0}}
`;

export function createContentCanvas(className = ""): HTMLElement {
  const canvas = element("section", `mem-content-canvas ${className}`.trim());
  canvas.dataset.memContentCanvas = "";
  return canvas;
}

export function createContentList(): HTMLUListElement {
  const list = element("ul", "text-list");
  list.dataset.memContentList = "";
  return list;
}

/**
 * The canonical Procedure flow DOM. Memory and Run adapt their domain data to
 * ContentFlowNode, then use this renderer so structure and semantic classes
 * cannot drift between the two surfaces.
 */
export function renderContentFlow<T>(nodes: readonly ContentFlowNode<T>[], hooks: ContentFlowHooks<T>): HTMLElement {
  const flow = element("div", "memory-flow mem-content-flow");
  flow.dataset.memContentFlow = "";
  for (const node of nodes) flow.append(renderContentFlowNode(node, hooks));
  return presentContent("flow", flow, hooks.ui);
}

export function renderContentFlowNode<T>(node: ContentFlowNode<T>, hooks: ContentFlowHooks<T>): HTMLElement {
  const branch = node.kind === "branch" || node.kind === "loop";
  const call = node.kind === "call";
  const item = element(
    "div",
    `memory-flow-item mem-content-flow-node${branch ? " branch is-branch" : ""}${call ? " call" : ""}`
  );
  item.dataset.flowNodeId = node.id;
  item.dataset.flowNodePath = node.path;
  hooks.decorateNode?.(item, node);

  const head = element("div", "memory-flow-head mem-content-flow-head");
  head.append(element("span", `memory-flow-label mem-content-flow-label${branch ? " is-branch" : ""}`, flowLabel(node.kind, hooks.labels)));
  if (call) {
    head.append(hooks.renderCallTarget?.(node) ?? document.createTextNode(node.target || node.action));
  } else {
    head.append(hooks.renderAction?.(node) ?? element("span", "memory-flow-action mem-content-flow-action", node.action));
    const meta = hooks.renderMeta?.(node);
    if (meta) head.append(meta);
  }
  hooks.decorateHead?.(head, node);
  item.append(head);

  for (const bodyNode of hooks.renderBody?.(node) ?? []) item.append(bodyNode);
  for (const branchModel of node.branches ?? []) {
    if (!branchModel.nodes.length) continue;
    const branchWrap = element("div", "memory-flow-branch mem-content-flow-branch");
    branchWrap.dataset.flowBranch = branchModel.kind;
    branchWrap.append(element(
      "div",
      `memory-flow-condition mem-content-flow-condition${branchModel.kind === "else" ? " is-else" : ""}`,
      branchModel.kind === "else" ? hooks.labels.else : ""
    ));
    const children = element("div", "memory-flow-children mem-content-flow-children");
    for (const child of branchModel.nodes) children.append(renderContentFlowNode(child, hooks));
    branchWrap.append(children);
    item.append(branchWrap);
  }
  return item;
}

export function renderContentListDisclosure(title: string, values: readonly Node[], className = "", ui?: ViewUi): HTMLDetailsElement {
  const { block, body } = createContentListDisclosure(title, values.length, className, ui);
  const list = createContentList();
  for (const value of values) {
    const item = document.createElement("li");
    item.append(value);
    list.append(item);
  }
  body.append(list);
  return block;
}

export function createContentListDisclosure(title: string, count: number, className = "", ui?: ViewUi): { block: HTMLDetailsElement; body: HTMLDivElement } {
  const block = document.createElement("details");
  block.className = `memory-collapsible-list mem-content-disclosure memory-list-block ${className}`.trim();
  const summary = element("summary", "memory-collapsible-summary mem-content-disclosure-summary");
  summary.append(
    element("span", "memory-list-chevron mem-content-disclosure-chevron", "›"),
    element("div", "memory-block-title mem-content-disclosure-title", title),
    element("span", "memory-list-count mem-content-disclosure-count", String(count))
  );
  const body = element("div", "memory-collapsible-body mem-content-disclosure-body");
  block.append(summary, body);
  const rendered = ui?.contentComponent({ kind: "disclosure", title, count, content: body, defaultRender: () => { block.append(body); return block; } }) ?? block;
  // Native disclosure semantics keep keyboard access and expand-all interoperable.
  rendered.classList.add("memory-collapsible-list", "mem-content-disclosure");
  if (className.includes("run-collapsible")) rendered.classList.add("run-collapsible");
  return { block: rendered as HTMLDetailsElement, body };
}

function flowLabel(kind: ContentFlowKind, labels: ContentFlowLabels): string {
  if (kind === "branch") return labels.if;
  if (kind === "loop") return labels.while;
  if (kind === "call") return labels.call;
  return labels.step;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
