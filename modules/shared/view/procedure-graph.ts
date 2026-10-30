import { graphRuleGroup, type RuleProjection } from './graph-rules.js';
import { createGraphCanvas, graphStatistics } from './graph-canvas.js';
import type { ViewUi } from '@memsphere/view-sdk';
import { loadGraphLayout } from './graph-layout-loader.js';
/** View-only structural contract; no dependency on host AST or persistence. */
export type ProcedureAction = {
    id: string;
    description: string;
    actor?: string;
    dependencies: Array<{
        from: string | string[];
        when?: string;
    }>;
    collect?: string[];
    artifact?: {
        name: string;
        model?: unknown;
        payload?: {
            contentType: string;
        };
        review?: string[];
        asserts?: unknown[];
        suggests?: unknown[];
        effectiveRules?: RuleProjection;
    };
    asserts?: unknown[];
    suggests?: unknown[];
    effectiveRules?: RuleProjection;
};
export type ProcedureDefinition = {
    actions: ProcedureAction[];
};
export type ProcedureEdge = {
    dependencyIndex?: number;
    id: string;
    from: string;
    to: string;
    when?: string;
    group: string[];
    collect: boolean;
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const e = document.createElement(tag);
    if (text !== undefined)
        e.textContent = text;
    return e;
};
export function procedureEdges(p: ProcedureDefinition): ProcedureEdge[] {
    return p.actions.flatMap(a => [...a.dependencies.flatMap((d, i) => {
            const group = Array.isArray(d.from) ? d.from : [d.from];
            return group.map(from => ({ dependencyIndex: i, id: `${a.id}:${i}:${from}`, from, to: a.id, when: d.when, group, collect: false }));
        }), ...(a.collect ?? []).map(from => ({ id: `${a.id}:collect:${from}`, from, to: a.id, group: [from], collect: true }))]);
}
export function createProcedureGraph(initial: ProcedureDefinition, options: {
    ui?: Pick<ViewUi, 'modelDefinition'>;
    locale?: string;
    onAction?: (a: ProcedureAction) => void;
    summary?: (id: string) => string;
    badges?: (id: string) => Array<{
        label: string;
        tone: string;
    }>;
    edgeDetails?: (edge: ProcedureEdge) => HTMLElement | undefined;
    rulesBody?: (action: ProcedureAction) => HTMLElement;
    onClose?: () => void;
    definitionBody?: (action: ProcedureAction) => HTMLElement;
} = {}) {
    const en = options.locale?.startsWith('en'), t = (zh: string, english: string) => en ? english : zh;
    const root = el('section');
    root.className = 'pg';
    const style = el('style');
    style.textContent = procedureGraphStyles;
    root.append(style);
    const canvas = createGraphCanvas({ locale: options.locale });
    root.append(canvas.element);
    const { viewport, world } = canvas;
    const failure = el('div');
    failure.className = 'pg-error';
    failure.setAttribute('role', 'alert');
    root.append(failure);
    const dialog = el('dialog');
    dialog.className = 'pg-dialog';
    root.append(dialog);
    const events = new AbortController();
    let restoringFocus = false;
    let definition = initial, edges = procedureEdges(initial), disposed = false, generation = 0, origin: HTMLElement | undefined;
    const nodes = new Map<string, HTMLElement>();
    let layoutSizes = '';
    const measuredSizes = () => JSON.stringify([...nodes].map(([id, node]) => [id, node.offsetWidth, node.offsetHeight]));
    const button = (label: string, run: () => void) => {
        const b = el('button', label);
        b.className = 'pg-button';
        b.type = 'button';
        b.addEventListener('click', run);
        return b;
    };
    const field = (host: HTMLElement, label: string, value: unknown) => {
        if (label)
            host.append(el('h4', label));
        if (Array.isArray(value)) {
            const list = el('ul');
            list.className = 'pg-values';
            for (const item of value)
                list.append(el('li', typeof item === 'string' ? item : JSON.stringify(item)));
            host.append(list);
        }
        else
            host.append(el('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
    };
    function clear() {
        world.querySelectorAll('[data-lit]').forEach(e => e.removeAttribute('data-lit'));
    }
    function highlight(edge: ProcedureEdge) {
        clear();
        world.querySelectorAll<HTMLElement>('[data-edge]:not(.pg-hit)').forEach(e => {
            if (e.dataset.edge === edge.id)
                e.dataset.lit = 'true';
        });
        for (const id of [edge.from, edge.to])
            nodes.get(id)?.setAttribute('data-lit', 'true');
    }
    function close() {
        restoringFocus = true;
        dialog.close();
        origin?.focus();
        restoringFocus = false;
        clear();
        options.onClose?.();
    }
    function show(title: string, body: HTMLElement) {
        origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const head = el('header');
        head.append(el('h3', title), button(t('关闭', 'Close'), close));
        dialog.replaceChildren(head, body);
        if (!dialog.open)
            dialog.showModal();
    }
    dialog.addEventListener('cancel', e => {
        e.preventDefault();
        close();
    }, { signal: events.signal });
    function infoRow(host: HTMLElement, label: string, value: unknown) {
        host.append(el('dt', label), el('dd', typeof value === 'string' ? value : Array.isArray(value) ? value.join('、') : JSON.stringify(value)));
    }
    function actionBody(a: ProcedureAction) {
        const body = el('section');
        body.className = 'pg-action-details';
        const group = (title: string) => {
            const section = el('section');
            section.className = 'pg-detail-group';
            const heading = el('h4', title);
            heading.className = 'pg-group-title';
            section.append(heading);
            body.append(section);
            return section;
        };
        const overview = group(t('基本信息', 'Basic information')), info = el('dl');
        info.className = 'pg-info';
        if (a.actor)
            infoRow(info, t('执行者', 'Actor'), a.actor);
        if (a.artifact) {
            infoRow(info, t('产物名称', 'Artifact name'), a.artifact.name);
            if (a.artifact.payload?.contentType)
                infoRow(info, t('内容类型', 'Content type'), a.artifact.payload.contentType);
        }
        overview.append(info);
        if (a.dependencies.length || a.collect?.length) {
            const dependencies = group(t('执行依赖', 'Execution dependencies'));
            for (const dependency of a.dependencies) {
                const row = el('dl');
                row.className = 'pg-info pg-dependency';
                infoRow(row, t('来自', 'From'), Array.isArray(dependency.from) ? dependency.from.map(nodeName) : nodeName(dependency.from));
                if (dependency.when)
                    infoRow(row, t('条件', 'Condition'), dependency.when);
                dependencies.append(row);
            }
            if (a.collect?.length)
                field(dependencies, t('收集来源', 'Collect'), a.collect.map(nodeName));
        }
        if (a.artifact?.review?.length) {
            const review = group(t('评审', 'Review'));
            const roles = el('ul');
            roles.className = 'pg-values';
            for (const role of a.artifact.review)
                roles.append(el('li', role));
            review.append(roles);
        }
        const requirements = a.asserts?.length || a.suggests?.length || a.artifact?.asserts?.length || a.artifact?.suggests?.length || a.artifact?.model ? group(t('产物要求', 'Artifact requirements')) : undefined;
        if (requirements && options.rulesBody)
            requirements.append(options.rulesBody(a));
        else
            for (const source of [a, a.artifact])
                for (const channel of ['asserts', 'suggests'] as const) {
                    const view = graphRuleGroup(channel === 'asserts' ? t('必须遵守', 'Required rules') : t('建议', 'Suggestions'), source?.[channel], source?.effectiveRules, channel, Boolean(en));
                    if (view)
                        requirements!.append(view);
                }
        if (a.artifact?.model) {
            const model = a.artifact.model as Record<string, unknown>;
            const modelGroup = el('div');
            modelGroup.className = 'pg-artifact-structure';
            modelGroup.append(el('h4', t('产物结构', 'Artifact structure')));
            requirements!.append(modelGroup);
            const details = el('div');
            details.className = 'pg-model-definition';
            let source = model.definition;
            try {
                if (typeof source === 'string')
                    source = JSON.parse(source);
            }
            catch {
            }
            if (options.ui) {
                const modelSnapshot = { id: a.artifact.name, metaModel: String(model.definedBy ?? ''), builtin: false, definition: source, source: typeof model.definition === 'string' ? model.definition : JSON.stringify(source, null, 2) };
                details.append(options.ui.modelDefinition({ model: modelSnapshot, view: 'structure' }));
            }
            else
                field(details, '', source);
            modelGroup.append(details);
        }
        const original = el('details');
        original.className = 'pg-original-definition';
        original.append(el('summary', t('查看完整定义', 'Full definition')));
        field(original, '', a);
        body.append(original);
        return body;
    }
    function openAction(a: ProcedureAction) {
        if (options.onAction)
            options.onAction(a);
        else
            show(a.description, options.definitionBody?.(a) ?? actionBody(a));
    }
    const nodeName = (id: string) => id === 'START' ? t('开始', 'Start') : definition.actions.find(a => a.id === id)?.artifact?.name ?? definition.actions.find(a => a.id === id)?.description ?? id;
    function openEdge(edge: ProcedureEdge) {
        const body = el('section'), info = el('dl');
        info.className = 'pg-info';
        infoRow(info, t('来自', 'From'), nodeName(edge.from));
        infoRow(info, t('指向', 'To'), nodeName(edge.to));
        body.append(info);
        if (edge.when)
            field(body, t('条件', 'Condition'), edge.when);
        if (edge.group.length > 1)
            field(body, t('共同等待', 'Join sources'), edge.group.map(nodeName));
        const extra = options.edgeDetails?.(edge);
        if (extra)
            body.append(extra);
        show(edge.collect ? t('收集关系', 'Collection') : t('执行依赖', 'Dependency'), body);
    }
    function render() {
        canvas.setStatistics(graphStatistics(definition.actions));
        nodes.clear();
        world.replaceChildren();
        edges = procedureEdges(definition);
        const start = el('div', t('开始', 'Start'));
        start.className = 'pg-start';
        nodes.set('START', start);
        world.append(start);
        for (const a of definition.actions) {
            const b = button('', () => openAction(a));
            b.dataset.actionId = a.id;
            b.className = 'pg-button pg-node';
            const head = el('div');
            head.className = 'pg-node-head';
            for (const badge of options.badges?.(a.id) ?? [{ label: a.collect ? t('代码', 'Code') : a.actor === 'human' ? t('人工', 'Human') : t('智能体', 'Agent'), tone: 'neutral' }]) {
                const item = el('span', badge.label);
                item.className = 'pg-badge';
                item.dataset.tone = badge.tone;
                head.append(item);
            }
            const name = a.artifact?.name ?? (a.collect ? t('收集产物', 'Collected artifacts') : a.description);
            const caption = el('span', a.description === name ? '' : a.description);
            caption.className = 'pg-node-caption';
            b.append(head, el('strong', name), caption);
            const summary = options.summary?.(a.id);
            if (summary) {
                const count = el('span', summary);
                count.className = 'pg-node-caption pg-node-executions';
                b.append(count);
            }
            nodes.set(a.id, b);
            world.append(b);
        }
    }
    const visible = () => root.isConnected && viewport.clientWidth > 0;
    async function layout() {
        if (!visible()) return;
        const epoch = ++generation;
        failure.replaceChildren();
        root.dataset.layoutState = 'loading';
        viewport.hidden = false;
        try {
            const api = await loadGraphLayout();
            if (disposed || !root.isConnected || epoch !== generation)
                return;
            if (!visible()) { root.dataset.layoutState = 'deferred'; return; }
            const input = [...nodes].map(([id, node]) => ({ id, width: node.offsetWidth || 178, height: node.offsetHeight || 100, dependencies: edges.filter(e => e.to === id).map(e => e.from), dependencyIds: edges.filter(e => e.to === id).map(e => e.id) }));
            layoutSizes = measuredSizes();
            const result = await api.layoutGraph(input);
            if (disposed || !root.isConnected || epoch !== generation)
                return;
            world.querySelectorAll('svg,.pg-condition').forEach(e => e.remove());
            for (const [id, pos] of result.positions) {
                const node = nodes.get(id)!;
                node.style.left = pos.x + 'px';
                node.style.top = pos.y + 'px';
            }
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', String(result.width));
            svg.setAttribute('height', String(result.height));
            svg.classList.add('pg-edges');
            world.prepend(svg);
            result.edges.forEach(route => {
                const edge = edges.find(edge => edge.id === route.id);
                if (!edge)
                    return;
                const line = document.createElementNS(svg.namespaceURI, 'path');
                line.setAttribute('d', route.path);
                line.setAttribute('class', 'pg-edge graph-edge');
                line.setAttribute('data-edge', edge.id);
                if (edge.collect)
                    line.setAttribute('stroke-dasharray', '5 5');
                svg.append(line);
                const hit = line.cloneNode() as SVGPathElement;
                hit.setAttribute('class', 'pg-hit');
                hit.setAttribute('role', 'button');
                hit.setAttribute('tabindex', '0');
                hit.setAttribute('aria-label', `${nodeName(edge.from)} → ${nodeName(edge.to)}${edge.when ? ' ' + edge.when : ''}`);
                const title = document.createElementNS(svg.namespaceURI, 'title');
                title.textContent = edge.when ?? `${nodeName(edge.from)} → ${nodeName(edge.to)}`;
                hit.append(title);
                svg.append(hit);
                const wire = (target: Element) => {
                    target.addEventListener('pointerenter', () => highlight(edge));
                    target.addEventListener('pointerleave', clear);
                    target.addEventListener('focus', () => {
                        if (!restoringFocus)
                            highlight(edge);
                    });
                    target.addEventListener('blur', clear);
                    if (!(target instanceof HTMLButtonElement))
                        target.addEventListener('click', () => openEdge(edge));
                    target.addEventListener('keydown', (event) => {
                        const e = event as KeyboardEvent;
                        if (!(target instanceof HTMLButtonElement) && ['Enter', ' '].includes(e.key)) {
                            e.preventDefault();
                            openEdge(edge);
                        }
                    });
                };
                wire(hit);
                if (edge.when) {
                    const label = button(t('条件', 'Condition'), () => openEdge(edge));
                    label.className = 'pg-button pg-condition';
                    label.dataset.edge = edge.id;
                    label.title = edge.when;
                    const lengths = route.points.slice(1).map((p, i) => Math.hypot(p.x - route.points[i].x, p.y - route.points[i].y));
                    let remaining = lengths.reduce((a, b) => a + b, 0) / 2, point = route.points[0];
                    for (let i = 0; i < lengths.length; i++) {
                        if (remaining <= lengths[i]) {
                            const a = route.points[i], b = route.points[i + 1], ratio = lengths[i] ? remaining / lengths[i] : 0;
                            point = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
                            break;
                        }
                        remaining -= lengths[i];
                    }
                    label.style.left = (point.x - 20) + 'px';
                    label.style.top = (point.y - 24) + 'px';
                    wire(label);
                    world.append(label);
                }
            });
            canvas.setSize(result.width, result.height);
            root.dataset.layoutState = 'ready';
        }
        catch (error) {
            if (!disposed && epoch === generation) {
                root.dataset.layoutState = 'failed';
                viewport.hidden = false;
                world.querySelectorAll('svg,.pg-condition').forEach(node => node.remove());
                failure.replaceChildren(el('p', error instanceof Error ? error.message : String(error)), button(t('重试', 'Retry'), () => {
                    void layout();
                }));
                const relations = el('section');
                relations.className = 'pg-fallback-relations';
                relations.append(el('h4', t('依赖关系', 'Dependencies')));
                const name = nodeName;
                for (const edge of edges) {
                    const link = button(`${name(edge.from)} → ${name(edge.to)}${edge.collect ? ' · ' + t('收集来源', 'Collection source') : ''}${edge.when ? ' · ' + t('条件', 'Condition') : ''}`, () => openEdge(edge));
                    link.dataset.edge = edge.id;
                    relations.append(link);
                }
                failure.append(relations);
            }
        }
    }
    render();
    requestAnimationFrame(() => {
        if (!disposed)
            void layout();
    });
    return { element: root, show, close, actionBody, refreshLayout() {
            if (visible() && (root.dataset.layoutState !== 'ready' || measuredSizes() !== layoutSizes)) {
                const scroll = {left: viewport.scrollLeft, top: viewport.scrollTop};
                void layout().then(() => { viewport.scrollLeft = scroll.left; viewport.scrollTop = scroll.top; });
            }
        }, update(next: ProcedureDefinition) {
            const changed = JSON.stringify(definition) !== JSON.stringify(next);
            definition = next;
            if (changed) {
                const scroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
                render();
                void layout().then(() => {
                    viewport.scrollLeft = scroll.left;
                    viewport.scrollTop = scroll.top;
                });
            }
            else
                for (const action of definition.actions) {
                    const node = nodes.get(action.id);
                    if (!node)
                        continue;
                    const head = node.querySelector('.pg-node-head')!;
                    if (options.badges) {
                        head.replaceChildren();
                        for (const badge of options.badges(action.id)) {
                            const item = el('span', badge.label);
                            item.className = 'pg-badge';
                            item.dataset.tone = badge.tone;
                            head.append(item);
                        }
                    }
                    if (options.summary) {
                        let count = node.querySelector<HTMLElement>('.pg-node-executions');
                        if (!count) {
                            count = el('span');
                            count.className = 'pg-node-caption pg-node-executions';
                            node.append(count);
                        }
                        count.textContent = options.summary(action.id);
                    }
                }
            if (!changed && visible() && root.dataset.layoutState !== 'failed' && measuredSizes() !== layoutSizes) {
                const scroll = {left: viewport.scrollLeft, top: viewport.scrollTop};
                void layout().then(() => { viewport.scrollLeft = scroll.left; viewport.scrollTop = scroll.top; });
            }
        }, dispose() {
            disposed = true;
            generation++;
            dialog.close();
            events.abort();
            canvas.dispose();
            root.remove();
        } };
}
const procedureGraphStyles = `
.pg{color:var(--mem-view-color-text);min-width:0}.pg .pg-button{font:inherit;color:inherit;border:1px solid var(--mem-view-color-border);background:var(--mem-view-color-surface);border-radius:6px;padding:6px 10px;cursor:pointer}.pg .pg-button:focus-visible{outline:2px solid var(--mem-view-color-accent)}.pg-node{position:absolute;width:220px;min-height:100px;text-align:left;display:grid;gap:8px;z-index:1}.pg-node small{color:var(--mem-view-color-text-muted)}.pg-node:hover{box-shadow:0 0 0 2px var(--mem-view-color-accent-soft)}.pg .pg-start{position:absolute;z-index:1}.pg-edges{position:absolute;inset:0;pointer-events:none}.pg-hit{fill:none;stroke:transparent;stroke-width:18;pointer-events:stroke;cursor:pointer}.pg [data-lit=true]{border-color:var(--mem-view-color-accent);background:var(--mem-view-color-accent-soft)}.pg-condition{position:absolute;z-index:2}.pg-dialog{padding:0;width:min(90vw,calc(100vw - 96px));max-width:none;height:min(90dvh,calc(100dvh - 48px));max-height:none;box-sizing:border-box;border:1px solid var(--mem-view-color-border);border-radius:12px;background:var(--mem-view-color-surface);color:var(--mem-view-color-text)}.pg-dialog::backdrop{background:var(--mem-view-color-overlay)}.pg-dialog header{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid var(--mem-view-color-border)}.pg-dialog[open]{display:flex;flex-direction:column;overflow:hidden}.pg-dialog header{flex-shrink:0}.pg-dialog>section{padding:20px 24px;overflow:auto;flex:1;min-height:0}.pg pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 var(--mem-view-font-mono)}.pg h4{color:var(--mem-view-color-text-muted)}.pg [hidden]{display:none}

.pg[data-layout-state=failed] .pg-world{display:flex;flex-wrap:wrap;align-content:flex-start;gap:16px;padding:20px;width:auto!important;height:auto!important;transform:none!important;margin:0!important}.pg[data-layout-state=failed] .pg-node,.pg[data-layout-state=failed] .pg-start{position:relative;left:auto!important;top:auto!important}.pg-fallback-relations{display:flex;flex-wrap:wrap;gap:8px;padding:16px}.pg-fallback-relations h4{flex-basis:100%}
.pg{font:14px/1.55 var(--mem-view-font-sans);background:var(--mem-view-color-surface)}




.pg .pg-node{width:178px;min-height:96px;padding:12px;border-radius:10px;gap:6px;box-shadow:0 3px 7px color-mix(in srgb,var(--mem-view-color-text) 3%,transparent)}
.pg .pg-node:hover{border-color:var(--mem-view-color-accent);background:var(--mem-view-color-accent-soft);box-shadow:0 0 0 1px var(--mem-view-color-accent)}
.pg-node-head{min-height:20px;display:flex;align-items:center;justify-content:space-between;gap:5px;flex-wrap:wrap}
.pg-node strong{font-size:13px;font-weight:600}
.pg-node-caption{font-size:11px;color:var(--mem-view-color-text-muted)}
.pg-badge{display:inline-flex;padding:1px 6px;border-radius:5px;font-size:10px;white-space:nowrap;background:var(--mem-view-color-accent-soft);color:var(--mem-view-color-accent)}
.pg-badge[data-tone=wait]{background:var(--mem-view-color-warning-soft);color:var(--mem-view-color-warning)}
.pg-badge[data-tone=neutral]{background:var(--mem-view-color-canvas);color:var(--mem-view-color-text-muted);border:1px solid var(--mem-view-color-border)}
.pg .pg-start{border:1px solid var(--mem-view-color-border);background:var(--mem-view-color-surface);color:var(--mem-view-color-text);box-sizing:border-box;cursor:default;width:44px;height:44px;border-radius:50%;padding:0;display:grid;place-items:center;font-size:12px;font-weight:400;box-shadow:0 3px 7px color-mix(in srgb,var(--mem-view-color-text) 3%,transparent)}.pg .pg-start[data-lit=true]{border-color:var(--mem-view-color-accent);background:var(--mem-view-color-accent-soft)}



.pg-condition{padding:1px 5px;font-size:10px;color:var(--mem-view-color-text-muted)}
.pg-dialog header h3{font-size:17px;font-weight:600;margin:7px 0}
.pg-dialog>section{font-size:12px}
.pg-dialog h4{font-size:11px;font-weight:500;margin:20px 0 8px}

.pg-info{display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px;margin:12px 0;font-size:12px}.pg-info dt{color:var(--mem-view-color-text-muted)}.pg-info dd{margin:0;overflow-wrap:anywhere}.pg-dependency{padding:8px 0 16px;border-bottom:1px solid var(--mem-view-color-border)}.pg-values{padding-left:20px;margin:8px 0;line-height:1.7}.pg-values li+li{margin-top:8px}.pg-dialog summary{cursor:pointer;font-size:12px}.pg-dialog details{margin-top:12px}

.pg .pg-condition{padding:1px 5px;font-size:10px;line-height:1.5}.pg

.pg-dialog .pg-action-details{padding:0 24px 20px;font-size:13px;line-height:1.65}
.pg-detail-group{padding:20px 0;border-bottom:1px solid var(--mem-view-color-border)}
.pg-dialog .pg-group-title{font-size:13px;font-weight:600;color:var(--mem-view-color-text);margin:0 0 14px}
.pg-detail-group>.pg-info{margin:0;grid-template-columns:84px minmax(0,1fr);font-size:13px;gap:10px 16px}
.pg-detail-group .pg-dependency{border:0;padding:0;margin:0}
.pg-detail-group .pg-dependency+.pg-dependency{margin-top:14px;padding-top:14px;border-top:1px dashed var(--mem-view-color-border)}
.pg-detail-group h4:not(.pg-group-title){margin:16px 0 6px;font-size:12px;color:var(--mem-view-color-text-muted)}
.pg-detail-group .pg-group-title+h4{margin-top:0}
.pg-detail-group .pg-values{margin:0;padding-left:20px;font-size:13px}
.pg-model-definition{margin-top:16px;min-width:0}
.pg-dialog .pg-original-definition{margin-top:18px;color:var(--mem-view-color-text-muted)}
.pg-original-definition>summary{width:fit-content;margin-left:auto;font-size:11px}
.pg-original-definition>pre{text-align:left}
@media(max-width:640px){.pg-dialog{width:calc(100vw - 24px);height:calc(100dvh - 24px)}.pg-dialog header{padding:12px 16px}.pg-dialog .pg-action-details{padding:0 16px 16px}}
`;
