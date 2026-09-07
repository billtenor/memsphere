import type { RunArtifactPresentationContext, ViewRenderContext, ViewUi } from "@memsphere/view-sdk";
import {
  createContentCanvas,
  presentContent,
  createContentList,
  createContentListDisclosure,
  renderContentFlow,
  renderContentListDisclosure,
  type ContentFlowHooks,
  type ContentFlowNode
} from "../../../shared/view/content-flow.js";

type Json = Record<string, any>;

export interface RunDetailState {
  readonly collapsedRules: Set<string>;
  readonly expandedBindings: Set<string>;
}

export interface RunDetailOptions {
  readonly locale?: string;
  readonly state: RunDetailState;
  readonly ui: ViewUi;
  readonly renderContext: ViewRenderContext;
  readonly request: (path: string, init?: RequestInit) => Promise<any>;
  readonly refresh: () => Promise<void>;
  readonly openReview: (runId: string, reviewId: string) => Promise<void>;
  readonly renderArtifact: (input: unknown) => HTMLElement;
}

export function createRunDetailState(): RunDetailState {
  return { collapsedRules: new Set<string>(), expandedBindings: new Set<string>() };
}

export function renderRunDetail(run: Json, options: RunDetailOptions): HTMLElement {
  const canvas = createContentCanvas();
  const wrap = document.createElement("div");
  wrap.className = "run-detail-content mem-content-document";
  const labels = createLabels(options.locale);
  wrap.append(renderRunMeta(run, options, labels));

  const assertTrees = activeProcedureAssertTrees(run);
  if (assertTrees.length) {
    const contracts = document.createElement("section");
    contracts.className = "run-panel run-procedure-asserts";
    assertTrees.forEach((tree, index) => contracts.append(
      renderEffectiveRuleTree(tree, labels.asserts, `run:${run.id}:procedure-asserts:${index}`, options, labels)
    ));
    wrap.append(contracts);
  }

  const bindings = renderBindings(run, options, labels);
  if (bindings) wrap.append(bindings);

  if (Array.isArray(run.plan) && run.plan.length) {
    const label = document.createElement("div");
    label.className = "run-section-title block-title mem-content-flow-title";
    label.textContent = labels.flow;
    const events = new Map<string, Json>((run.events || []).map((event: Json) => [event.stepId, event]));
    const active = currentRunStep(run);
    const flow = renderContentFlow(run.plan.map((step: Json) => normalizeRunFlowNode(step)), runFlowHooks(events, active, run, options, labels));
    flow.classList.add("run-flow", "flow");
    wrap.append(label, flow);
    const finals = (run.events || []).filter((event: Json) => event.artifact?.final);
    if (finals.length) wrap.append(renderArtifactCollection(finals, labels.finalArtifacts, options, run, labels));
  } else {
    wrap.append(renderArtifactCollection(run.events || [], labels.artifacts, options, run, labels));
  }
  appendDisclosureToggle(wrap, labels);
  canvas.append(wrap);
  return presentContent("document", canvas, options.ui);
}

function renderRunMeta(run: Json, options: RunDetailOptions, labels: Labels): HTMLElement {
  const host = document.createElement("div");
  host.className = "run-meta-container";
  const meta = document.createElement("div");
  meta.className = "run-meta meta";
  meta.append(
    options.ui.badge({ label: { text: `${labels.procedure}: ${run.procedureName || "—"}` } }),
    options.ui.badge({ label: { text: labels.status[String(run.status)] || String(run.status || "—") }, tone: run.status === "done" ? "success" : run.status === "abandoned" ? "warning" : "info" }),
    options.ui.badge({ label: { text: `${run.status === "running" ? labels.activeFrames : labels.retainedFrames}: ${(run.stack || []).length}` } }),
    options.ui.badge({ label: { text: `${labels.artifacts}: ${(run.events || []).length}` } }),
    options.ui.badge({ label: { text: `${labels.updated}: ${formatTime(run.updatedAt)}` } })
  );
  if (run.contractVersion === 1 || run.readOnly) meta.append(options.ui.badge({ label: { text: labels.legacyReadOnly }, tone: "warning" }));
  if (run.abandonment) {
    meta.append(options.ui.badge({ label: { text: `${labels.abandonedAt}: ${formatTime(run.abandonment.abandonedAt)}` }, tone: "warning" }));
    if (run.abandonment.reason) meta.append(options.ui.badge({ label: { text: String(run.abandonment.reason) }, tone: "warning" }));
  }
  void options.ui.card({ content: meta }).mount({ element: host, portal: host }, options.renderContext);
  return host;
}

function renderBindings(run: Json, options: RunDetailOptions, labels: Labels): HTMLElement | null {
  const slots = Object.entries(run.reviewConfiguration?.slots || {}) as [string, Json][];
  const actors = Object.entries(run.controlPlane?.actors || {}) as [string, Json][];
  if (!slots.length || !actors.length) return null;
  const panel = document.createElement("section");
  panel.className = "run-panel run-bindings mem-content-disclosure-host";
  const expanded = options.state.expandedBindings.has(run.id);
  const body = document.createElement("div");
  body.className = "run-binding-body";
  const snapshots = new Map<string, Json>((run.bindingSnapshot?.slots || []).map((item: Json) => [item.key, item]));
  for (const [slot, binding] of slots) {
    const row = document.createElement("div");
    row.className = "run-binding-row";
    const snapshot = snapshots.get(slot);
    const heading = document.createElement("b");
    heading.textContent = displaySlot(slot);
    row.append(heading, pill(`${labels.reviewScopes}: ${snapshot?.reviewScopes?.length || 0}`));
    const actorChoices = document.createElement("div");
    actorChoices.className = "run-binding-actors";
    const selected = new Set<string>(binding.actorIds || []);
    for (const [actorId, actor] of actors) {
      const choice = options.ui.checkboxField({
        label: { text: `${actor.name || actorId} · ${actor.kind || ""}` },
        checked: selected.has(actorId),
        disabled: run.status !== "running" || run.readOnly || binding.skip === true,
        onChange: () => undefined
      });
      choice.control.value = actorId;
      actorChoices.append(choice.root);
    }
    const actions = document.createElement("div");
    actions.className = "run-binding-actions";
    const skipField = options.ui.checkboxField({label:{text:labels.skip},checked:binding.skip === true,disabled:run.status !== "running" || run.readOnly,onChange:checked=>{
      actorChoices.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => { input.disabled = checked; });
    }});
    const skip = skipField.control;
    const save = options.ui.button({label:{text:labels.save},disabled:run.status !== "running" || run.readOnly,async run(){
        const actorIds = [...actorChoices.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(input => input.value);
        await options.request(`/api/runs/${encodeURIComponent(run.id)}/bindings`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(skip.checked ? { slot, skip: true } : { slot, actorIds })
        });
        await options.refresh();
    }},{tone:"primary"});
    actions.append(skipField.root, save);
    row.append(actorChoices, actions);
    body.append(row);
  }
  if (run.bindingChanges?.length) {
    const history = document.createElement("ul");
    history.className = "run-binding-history";
    for (const change of [...run.bindingChanges].reverse()) {
      const item = document.createElement("li");
      item.textContent = `${formatTime(change.changedAt)} · ${displaySlot(change.slot)} · ${bindingLabel(change.before, run)} → ${bindingLabel(change.after, run)}`;
      history.append(item);
    }
    body.append(history);
  }
  const disclosure = options.ui.disclosure({
    title: { text: labels.bindings },
    description: { text: labels.reviewScopes },
    expanded,
    content: body,
    onToggle: next => {
      if (next) options.state.expandedBindings.add(run.id);
      else options.state.expandedBindings.delete(run.id);
    }
  });
  void disclosure.mount({ element: panel, portal: panel }, options.renderContext);
  return panel;
}

function normalizeRunFlowNode(step: Json): ContentFlowNode<Json> {
  const kind = step.kind === "branch" || step.kind === "loop" || step.kind === "call" ? step.kind : "action";
  const branches = kind === "branch"
    ? [
        ...(step.branches?.truthy?.length ? [{ kind: "then" as const, nodes: step.branches.truthy.map((child: Json) => normalizeRunFlowNode(child)) }] : []),
        ...(step.branches?.falsy?.length ? [{ kind: "else" as const, nodes: step.branches.falsy.map((child: Json) => normalizeRunFlowNode(child)) }] : [])
      ]
    : kind === "loop" && step.loop?.body?.length
      ? [{ kind: "do" as const, nodes: step.loop.body.map((child: Json) => normalizeRunFlowNode(child)) }]
      : [];
  return {
    id: String(step.id ?? ""),
    path: String(step.id ?? ""),
    kind,
    action: String(step.instruction || artifactSpec(step).name || step.id || ""),
    target: String(step.target ?? ""),
    source: step,
    content: step,
    branches
  };
}

function runFlowHooks(events: Map<string, Json>, active: Json | null, run: Json, options: RunDetailOptions, labels: Labels): ContentFlowHooks<Json> {
  return {
    ui: options.ui,
    labels: { step: labels.step, if: labels.if, while: labels.while, call: labels.call, else: labels.else },
    renderCallTarget: node => {
      const link = document.createElement("a");
      link.className = "call-link";
      link.href = `/memories/procedures/${encodeURIComponent(node.target || "")}`;
      link.textContent = node.target || node.action;
      return link;
    },
    renderMeta: node => {
      const meta = document.createElement("div");
      meta.className = "memory-artifact-row mem-content-artifact-contract";
      appendArtifactContract(meta, node.content, labels);
      return meta;
    },
    decorateNode: (item, node) => {
      const current = active?.id === node.id;
      item.classList.add("run-step", "flow-item");
      item.dataset.stepId = node.id;
      if (current) {
        item.classList.add("current", "task-step");
        item.dataset.currentTaskStep = "true";
        item.setAttribute("aria-current", "step");
        item.id = `task-step-${safeId(run.id)}-${safeId(node.id)}`;
      }
    },
    decorateHead: (head, node) => {
      if (active?.id !== node.id) return;
      const marker = head.querySelector<HTMLElement>(".mem-content-flow-label")!;
      marker.classList.add("run-current-step-marker");
      marker.textContent = labels.current;
    },
    renderBody: node => {
      const holder = document.createElement("div");
      appendRuleContracts(holder, node.content, `run:${run.id}:step:${node.id}`, options, labels);
      const schemaWriting = renderSchemaWriting(run, node.content, options, labels);
      if (schemaWriting) holder.append(schemaWriting);
      const event = events.get(node.id);
      if (event?.artifact) holder.append(renderArtifactResult(event, run, options, labels));
      return [...holder.childNodes];
    }
  };
}

function renderArtifactCollection(events: Json[], heading: string, options: RunDetailOptions, run: Json, labels: Labels): HTMLElement {
  const wrap = document.createElement("section");
  wrap.className = "run-artifacts";
  const title = document.createElement("div");
  title.className = "run-section-title block-title";
  title.textContent = heading;
  wrap.append(title);
  if (!events.length) { const empty = document.createElement("div"); empty.className = "run-panel muted"; empty.textContent = labels.noArtifacts; wrap.append(empty); }
  else for (const event of events) wrap.append(renderArtifactResult(event, run, options, labels, true));
  return wrap;
}

function renderArtifactResult(event: Json, run: Json, options: RunDetailOptions, labels: Labels, standalone = false): HTMLElement {
  const card = document.createElement("details");
  card.className = `${standalone ? "run-artifact " : ""}run-collapsible task-result mem-content-disclosure`;
  const artifact = event.artifact || {};
  const title = document.createElement("h3");
  title.className = "mem-content-disclosure-title";
  title.textContent = standalone ? (artifact.name || event.stepId || labels.artifact) : labels.output;
  const meta = document.createElement("div");
  meta.className = "run-meta artifact-meta-line";
  if (artifact.path) meta.append(pill(`file: ${artifact.path}`));
  if (artifact.validation?.status) meta.append(pill(`${labels.validation}: ${artifact.validation.status}`, artifact.validation.status === "passed" ? "done" : "warn"));
  if (event.at) meta.append(pill(`${labels.time}: ${formatTime(event.at)}`));
  const review = (run.artifactReviewSummaries || []).find((candidate: Json) => candidate.stepId === event.stepId)
    || (run.artifactReview?.stepId === event.stepId ? run.artifactReview : null);
  const metadata = artifact.metadata && typeof artifact.metadata === "object" && !Array.isArray(artifact.metadata)
    ? artifact.metadata
    : {};
  const presentation: RunArtifactPresentationContext = {
    runId: run.id,
    artifactId: event.stepId,
    type: String(artifact.type ?? ""),
    format: freezePresentationValue(structuredClone(artifact.format ?? null)),
    title: String(artifact.name || event.stepId || labels.artifact),
    content: freezePresentationValue(structuredClone(
      artifact.storage === "file" ? (artifact.content ?? artifact.contentError ?? artifact.path) : (artifact.value ?? artifact.content ?? null)
    )),
    metadata: freezePresentationValue(structuredClone(metadata)),
    ...(review?.id ? { openReview: () => options.openReview(run.id, review.id) } : {}),
    download: () => downloadArtifact(artifact, artifact.name || event.stepId || "artifact"),
    defaultRender: () => renderArtifactValue(artifact)
  };
  const summary = document.createElement("summary");
  summary.className = "run-disclosure-summary run-artifact-summary mem-content-disclosure-summary";
  summary.append(disclosureChevron(), title);
  const body = document.createElement("div");
  body.className = "run-disclosure-body mem-content-disclosure-body";
  body.append(meta, options.renderArtifact(Object.freeze(presentation)));
  card.append(summary, body);
  if (review?.id) {
    const open = options.ui.button({ label: { text: labels.review }, run: () => options.openReview(run.id, review.id) });
    open.dataset.artifactReviewId = review.id;
    body.append(open);
  }
  return card;
}

function freezePresentationValue<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezePresentationValue(child);
  return Object.freeze(value);
}

function downloadArtifact(artifact: Json, name: string): void {
  const value = artifact?.content ?? artifact?.value ?? artifact;
  const blob = new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = String(name);
  link.click();
  URL.revokeObjectURL(href);
}

export function renderArtifactValue(artifact: Json): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "artifact-review-artifact-content";
  if (typeof artifact?.renderedContent === "string") wrap.innerHTML = artifact.renderedContent;
  else {
    const pre = document.createElement("pre");
    pre.className = "run-pre pre";
    const value = artifact?.storage === "file" ? (artifact.content ?? artifact.contentError ?? artifact.path) : (artifact?.value ?? artifact?.content ?? artifact);
    pre.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    wrap.append(pre);
  }
  return wrap;
}

function appendArtifactContract(target: HTMLElement, step: Json, labels: Labels): void {
  const artifact = artifactSpec(step);
  const summary = document.createElement("span");
  summary.className = "mem-content-artifact-summary";
  const label = document.createElement("span");
  label.className = "mem-content-artifact-label";
  label.textContent = labels.artifact;
  summary.append(label, pill(artifact.name || "—", "strong mem-content-artifact-name"));
  const details = document.createElement("span");
  details.className = "mem-content-artifact-details";
  if (artifact.type) details.append(pill(artifact.type));
  appendFormatMeta(details, artifact.format, artifact.schema, labels);
  if (artifact.final) details.append(pill(labels.final, "done"));
  if (details.childElementCount) {
    summary.tabIndex = 0;
    summary.append(details);
  }
  target.append(summary);
  const reviewSlots = Array.isArray(artifact.review)
    ? artifact.review
    : typeof artifact.review === "string" && artifact.review
      ? [artifact.review]
      : [];
  if (reviewSlots.length) {
    const review = document.createElement("span");
    review.className = "mem-content-review-summary";
    review.tabIndex = 0;
    const count = document.createElement("span");
    count.className = "mem-content-review-count";
    count.textContent = `${labels.reviewer}: ${reviewSlots.length}`;
    const reviewDetails = document.createElement("span");
    reviewDetails.className = "mem-content-review-details";
    for (const slot of reviewSlots) reviewDetails.append(pill(displaySlot(slot)));
    review.append(count, reviewDetails);
    target.append(review);
  }
}

function appendFormatMeta(target: HTMLElement, format: unknown, schema: unknown, labels: Labels): void {
  const name = typeof format === "string" ? format : (format as Json)?.name;
  if (name) target.append(pill(String(name)));
  const options = typeof format === "object" && format ? (format as Json).options || {} : {};
  for (const [key, value] of Object.entries(options)) target.append(pill(`${key}: ${String(value)}`));
  if (typeof schema === "string") target.append(pill(`${labels.schema}: ${schema}`));
  else if ((schema as Json)?.kind === "external") target.append(pill(`${labels.schema}: ${(schema as Json).name}`));
  else if (schema) target.append(pill(labels.inlineSchema));
}

function appendRuleContracts(target: HTMLElement, step: Json, scope: string, options: RunDetailOptions, labels: Labels): void {
  if (step.assertTree) target.append(renderEffectiveRuleTree(step.assertTree, labels.asserts, `${scope}:asserts`, options, labels));
  else if (step.asserts?.length) target.append(renderSimpleRules(step.asserts, labels.asserts, options.ui));
  if (step.suggestTree) target.append(renderEffectiveRuleTree(step.suggestTree, labels.suggests, `${scope}:suggests`, options, labels));
  else if (step.suggests?.length) target.append(renderSimpleRules(step.suggests, labels.suggests, options.ui));
}

function renderSimpleRules(entries: unknown[], heading: string, ui?: ViewUi): HTMLElement {
  const values = entries.map(entry => document.createTextNode(typeof entry === "string" ? entry : (entry as Json)?.target || JSON.stringify(entry)));
  return renderContentListDisclosure(heading, values, "action-contracts effective-rule-tree run-collapsible", ui);
}

function appendSimpleRuleGroup(target: HTMLElement, entries: unknown[], heading: string): void {
  const title = document.createElement("div"); title.className = "block-title"; title.textContent = heading;
  const list = createContentList();
  for (const entry of entries) {
    const item = document.createElement("li");
    item.textContent = typeof entry === "string" ? entry : (entry as Json)?.text || JSON.stringify(entry);
    list.append(item);
  }
  target.append(title, list);
}

function renderEffectiveRuleTree(tree: Json, headingText: string, scope: string, options: RunDetailOptions, labels: Labels): HTMLElement {
  const { block: wrap, body } = createContentListDisclosure(headingText, effectiveEntries(tree).length, "effective-rule-tree run-collapsible", options.ui);
  appendEffectiveEntries(body, effectiveEntries(tree), scope, options, labels);
  for (const [index, section] of (tree.sections || []).entries()) body.append(renderEffectiveSection(section, `${scope}:section:${index}`, options, labels));
  wrap.append(body);
  return wrap;
}

function appendEffectiveEntries(target: HTMLElement, entries: unknown[], scope: string, options: RunDetailOptions, labels: Labels): void {
  const list = createContentList(); list.classList.add("effective-rule-list");
  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    if (typeof entry === "string" || (entry as Json)?.kind === "rule") item.textContent = typeof entry === "string" ? entry : (entry as Json).text;
    else if (entry && typeof entry === "object" && ((entry as Json).kind === "reference" || (entry as Json).reference || (entry as Json).target)) {
      item.className = "effective-reference-item";
      item.append(renderEffectiveReference(entry as Json, `${scope}:reference:${index}`, options, labels));
    } else return;
    list.append(item);
  });
  if (list.childElementCount) target.append(list);
}

function renderEffectiveReference(entry: Json, scope: string, options: RunDetailOptions, labels: Labels): HTMLElement {
  const section = document.createElement("div"); section.className = "section effective-reference";
  const body = document.createElement("div"); body.className = "section-body"; body.hidden = options.state.collapsedRules.has(scope);
  const header = ruleToggle(`${labels.referencedFrom} ${entry.reference || entry.target}`, scope, body, options);
  appendEffectiveEntries(body, effectiveEntries(entry), `${scope}:entries`, options, labels);
  for (const [index, child] of (entry.sections || []).entries()) body.append(renderEffectiveSection(child, `${scope}:section:${index}`, options, labels));
  section.append(header, body); return section;
}

function renderEffectiveSection(node: Json, scope: string, options: RunDetailOptions, labels: Labels): HTMLElement {
  const section = document.createElement("div"); section.className = "section effective-section";
  const body = document.createElement("div"); body.className = "section-body"; body.hidden = options.state.collapsedRules.has(scope);
  const header = ruleToggle(node.name || labels.section, scope, body, options);
  if (node.defines?.length) appendSimpleRuleGroup(body, node.defines, labels.defines);
  const rules = effectiveEntries(node); if (rules.length) { const title = document.createElement("div"); title.className = "block-title"; title.textContent = labels.rules; body.append(title); appendEffectiveEntries(body, rules, `${scope}:entries`, options, labels); }
  for (const [index, child] of (node.sections || []).entries()) body.append(renderEffectiveSection(child, `${scope}:section:${index}`, options, labels));
  section.append(header, body); return section;
}

function ruleToggle(label: string, scope: string, body: HTMLElement, options: RunDetailOptions): HTMLButtonElement {
  let control!: HTMLButtonElement;
  control = options.ui.button({ label: { text: label }, run: () => {
    body.hidden = !body.hidden;
    control.setAttribute("aria-expanded", String(!body.hidden));
    if (body.hidden) options.state.collapsedRules.add(scope);
    else options.state.collapsedRules.delete(scope);
  }});
  control.classList.add("section-header");
  control.setAttribute("aria-expanded", String(!options.state.collapsedRules.has(scope)));
  const chevron = document.createElement("span"); chevron.className = "chevron"; chevron.textContent = "›"; control.prepend(chevron); return control;
}

function renderSchemaWriting(run: Json, step: Json, options: RunDetailOptions, labels: Labels): HTMLElement | null {
  const snapshot = run.schemaWriting;
  if (!snapshot || snapshot.parentStepId !== step.id) return null;
  const wrap = document.createElement("details"); wrap.className = "schema-writing run-collapsible mem-content-disclosure";
  const title = document.createElement("summary"); title.className = "block-title run-disclosure-summary mem-content-disclosure-summary"; title.append(disclosureChevron(), disclosureTitle(labels.schemaWriting)); wrap.append(title);
  const body = document.createElement("div"); body.className = "run-disclosure-body mem-content-disclosure-body";
  const progress = document.createElement("div"); progress.className = "schema-writing-progress run-meta";
  progress.append(pill(`${labels.progress} ${snapshot.progress?.completed || 0}/${snapshot.progress?.total || 0}`), pill(`${labels.remaining} ${snapshot.progress?.remaining || 0}`));
  if (snapshot.currentField?.path) progress.append(pill(String(snapshot.currentField.path), "strong"));
  if (snapshot.draft?.status === "awaiting_finalization") progress.append(pill(labels.globalAdjustment, "warn"));
  body.append(progress);
  for (const [index, source] of (snapshot.currentField?.sources || []).entries()) {
    const sourceElement = document.createElement("div"); sourceElement.className = "schema-writing-source";
    const sourceTitle = document.createElement("b"); sourceTitle.textContent = `${labels.constraintSource} · ${source.path}`; sourceElement.append(sourceTitle);
    if (source.defines?.length) sourceElement.append(renderSimpleRules(source.defines, labels.defines));
    if (source.assertTree) sourceElement.append(renderEffectiveRuleTree(source.assertTree, labels.asserts, `run:${run.id}:schema:${step.id}:${index}:asserts`, options, labels));
    if (source.suggestTree) sourceElement.append(renderEffectiveRuleTree(source.suggestTree, labels.suggests, `run:${run.id}:schema:${step.id}:${index}:suggests`, options, labels));
    body.append(sourceElement);
  }
  if (snapshot.draft) {
    const preview = document.createElement("details"); preview.className = "schema-draft-preview"; preview.open = snapshot.draft.status === "awaiting_finalization";
    const summary = document.createElement("summary"); summary.textContent = labels.managedDraft; preview.append(summary);
    const path = document.createElement("div"); path.className = "schema-draft-path run-pre"; path.textContent = snapshot.draft.filePath || ""; preview.append(path);
    if (snapshot.draft.validation) preview.append(pill(`${labels.validation}: ${snapshot.draft.validation.status}`, snapshot.draft.validation.status === "passed" ? "done" : "warn"));
    if (typeof snapshot.draft.renderedContent === "string") { const content = document.createElement("div"); content.className = "artifact-review-artifact-content"; content.innerHTML = snapshot.draft.renderedContent; preview.append(content); }
    else if (snapshot.draft.contentError) { const error = document.createElement("div"); error.className = "muted"; error.textContent = snapshot.draft.contentError; preview.append(error); }
    if (snapshot.readOnly) { const notice = document.createElement("div"); notice.className = "muted"; notice.textContent = labels.readOnlyDraft; preview.append(notice); }
    else if (snapshot.draft.status === "awaiting_finalization") { const command = document.createElement("pre"); command.className = "run-pre"; command.textContent = `memsphere run report --run ${shellQuote(run.id)} --artifact-file ${shellQuote(snapshot.draft.filePath)}`; preview.append(command); }
    body.append(preview);
  }
  wrap.append(body);
  return wrap;
}

function appendDisclosureToggle(wrap: HTMLElement, labels: Labels): void {
  const disclosures = () => [...wrap.querySelectorAll<HTMLDetailsElement>("details.run-collapsible")];
  if (!disclosures().length) return;
  let control!: HTMLButtonElement;
  const update = () => { control.textContent = disclosures().some(item => !item.open) ? labels.expandAll : labels.collapseAll; };
  control = document.createElement("button");
  control.type = "button";
  control.className = "run-disclosure-toggle-all";
  control.addEventListener("click", () => {
    const expand = disclosures().some(item => !item.open);
    disclosures().forEach(item => { item.open = expand; });
    update();
  });
  wrap.addEventListener("toggle", update, true);
  update();
  wrap.prepend(control);
}

export function currentRunStep(run: Json): Json | null {
  if (run.status !== "running") return null;
  if (run.schemaWriting?.parentStepId) return findStep(run.plan || [], run.schemaWriting.parentStepId);
  const frame = run.stack?.at?.(-1) || run.stack?.[run.stack.length - 1];
  return frame?.steps?.[frame.index] || null;
}

function findStep(steps: Json[], id: string): Json | null {
  for (const step of steps || []) {
    if (step.id === id) return step;
    const child = findStep(step.branches?.truthy || [], id) || findStep(step.branches?.falsy || [], id) || findStep(step.loop?.body || [], id);
    if (child) return child;
  }
  return null;
}

function activeProcedureAssertTrees(run: Json): Json[] {
  const trees = [run.assertTree, ...(run.stack || []).filter((frame: Json) => frame.type === "procedure").map((frame: Json) => frame.assertTree)].filter(Boolean);
  const seen = new Set<string>();
  return trees.filter(tree => { const key = JSON.stringify(tree); if (seen.has(key)) return false; seen.add(key); return true; });
}

function effectiveEntries(node: Json): unknown[] { return Array.isArray(node) ? node : node?.asserts || node?.suggests || node?.entries || []; }
function artifactSpec(step: Json): Json { const value = step.artifact && typeof step.artifact === "object" ? step.artifact : step; return { name: typeof step.artifact === "string" ? step.artifact : value.name || "", type: value.type || "", format: value.format, schema: value.schema, final: Boolean(value.final), review: value.review || step.reviewPolicy || [] }; }
function stepStatus(step: Json, event: Json | undefined, active: Json | null, run: Json): string { const labels = createLabels(document.documentElement.lang); if (event) return labels.completed; if (active?.id === step.id) return labels.current; if (run.abandonment?.current?.stepId === step.id) return labels.stopped; return labels.notStarted; }
function bindingLabel(binding: Json, run: Json): string { if (binding?.skip) return "skip"; return (binding?.actorIds || []).map((id: string) => run.controlPlane?.actors?.[id]?.name || id).join(", "); }
function displaySlot(value: string): string { return value.includes("::") ? value.slice(value.lastIndexOf("::") + 2) : value; }
function displayName(run: Json): string { return String(run.name?.trim?.() || run.procedureName || run.id || ""); }
function formatTime(value: unknown): string { if (!value) return "—"; const date = new Date(String(value)); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(); }
function safeId(value: unknown): string { return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-"); }
function shellQuote(value: unknown): string { const text = String(value ?? ""); return /^[a-zA-Z0-9_./:-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`; }
function pill(text: string, kind = ""): HTMLElement { const result = document.createElement("span"); result.className = `run-pill pill ${kind}`; result.textContent = text; return result; }
function disclosureChevron(): HTMLElement { const result = document.createElement("span"); result.className = "mem-content-disclosure-chevron"; result.setAttribute("aria-hidden", "true"); result.textContent = "›"; return result; }
function disclosureTitle(text: string): HTMLElement { const result = document.createElement("span"); result.className = "mem-content-disclosure-title"; result.textContent = text; return result; }
interface Labels {
  procedure: string; activeFrames: string; retainedFrames: string; artifacts: string; artifact: string; output: string; updated: string;
  legacyReadOnly: string; abandonedAt: string; review: string; jumpCurrent: string; bindings: string; reviewScopes: string;
  skip: string; save: string; asserts: string; suggests: string; flow: string; finalArtifacts: string; noArtifacts: string;
  if: string; while: string; else: string; step: string; call: string; noSteps: string; completed: string; current: string;
  stopped: string; notStarted: string; time: string; validation: string; final: string; reviewer: string; schema: string; inlineSchema: string;
  referencedFrom: string; section: string; defines: string; rules: string; schemaWriting: string; progress: string;
  remaining: string; globalAdjustment: string; constraintSource: string; managedDraft: string; readOnlyDraft: string;
  expandAll: string; collapseAll: string;
  status: Record<string, string>;
}

function createLabels(locale = ""): Labels {
  const en = locale.startsWith("en");
  return en ? {
    procedure:"Procedure",activeFrames:"Active frames",retainedFrames:"Retained frames",artifacts:"Artifacts",artifact:"Artifact",output:"Output",updated:"Updated",legacyReadOnly:"Legacy · Read-only",abandonedAt:"Abandoned",review:"Artifact review",jumpCurrent:"Jump to current step",bindings:"Runtime review bindings",reviewScopes:"Review scopes",skip:"Skip future reviews",save:"Update binding",asserts:"Required rules",suggests:"Suggested rules",flow:"Flow",finalArtifacts:"Final artifacts",noArtifacts:"No artifacts",if:"If",while:"While",else:"Else",step:"Step",call:"Call",noSteps:"No steps",completed:"Completed",current:"Current step",stopped:"Stopped",notStarted:"Not started",time:"Time",validation:"Validation",final:"Final",reviewer:"Reviewer",schema:"Schema",inlineSchema:"Inline Schema",referencedFrom:"Referenced from",section:"Section",defines:"Definitions",rules:"Rules",schemaWriting:"Schema writing",progress:"Progress",remaining:"Remaining",globalAdjustment:"Global adjustment",constraintSource:"Constraint source",managedDraft:"Managed draft",readOnlyDraft:"This draft is read-only",expandAll:"Expand all",collapseAll:"Collapse all",status:{running:"Running",done:"Done",abandoned:"Abandoned"}
  } : {
    procedure:"流程",activeFrames:"活动帧",retainedFrames:"保留帧",artifacts:"产物",artifact:"产物",output:"产出物",updated:"更新时间",legacyReadOnly:"旧版 · 只读",abandonedAt:"废弃于",review:"产物评审",jumpCurrent:"跳到当前步骤",bindings:"运行时评审绑定",reviewScopes:"评审范围",skip:"跳过后续评审",save:"更新绑定",asserts:"必须遵守",suggests:"建议遵守",flow:"执行流程",finalArtifacts:"最终产物",noArtifacts:"暂无产物",if:"如果",while:"循环",else:"否则",step:"步骤",call:"调用流程",noSteps:"没有步骤",completed:"已完成",current:"当前步骤",stopped:"已停止",notStarted:"未开始",time:"时间",validation:"契约校验",final:"最终",reviewer:"评审人",schema:"图式",inlineSchema:"内联图式",referencedFrom:"引用自",section:"章节",defines:"定义",rules:"规则",schemaWriting:"Schema 填写",progress:"进度",remaining:"剩余",globalAdjustment:"全局调整",constraintSource:"约束来源",managedDraft:"受管草稿",readOnlyDraft:"该草稿只读",expandAll:"展开全部",collapseAll:"收起全部",status:{running:"运行中",done:"已完成",abandoned:"已废弃"}
  };
}
