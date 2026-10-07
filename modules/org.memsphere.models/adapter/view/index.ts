import { modelRegistrationSetupEnabled } from "../../../shared/model-browser-features.js";
import { defineViewPlugin, slots, portableSlots, type BadgeDescriptor, type ContentListDescriptor, type ViewMount, type ViewRenderContext, type ModelPresentationSummary, type ModelPresentationDefinition, type SecondaryNavigationDescriptor } from "@memsphere/view-sdk";
import { filterModels, modelGroups, modelName, modelDescription, normalizeModelScope, scopeModels } from '../../../shared/model-browser-state.js';
import { modelStyles, registrationStyles } from './styles.js';
type ModelSummary = ModelPresentationSummary;
type ModelDefinition = ModelPresentationDefinition;
type MutationFeedback = {
    pendingModelRefs?: string[];
    conflicts?: unknown[];
    pendingCleanup?: boolean;
};
type MarketPackage = {
    id: string;
    name?: string;
    description?: string;
    models: Array<{
        modelRef?: string;
        id?: string;
        name?: string;
        description?: string;
        source?: string;
        definition?: unknown;
        registration?: ModelSummary['registration'];
    }>;
};
export default defineViewPlugin<{
    locale?: string;
    projectApiBase?: string;
}>({
    name: 'memsphere-models', apiVersion: 1, inject: ['slots', 'router', 'theme', 'ui'], themeVersion: 1, uiVersion: 1,
    apply(ctx, config) {
        if (!ctx.router || !ctx.ui || !ctx.theme)
            throw Error('Models require router, theme and ui');
        const ui = ctx.ui, router = ctx.router;
        const text = (zh: string, en: string) => config.locale === 'en' ? en : zh;
        const t = (zh: string, en: string) => ({ text: text(zh, en) });
        const index = router.register({ id: 'index', path: '/models', query: ['model', 'scope', 'tag', 'q'] });
        const marketRoute = router.register({ id: 'market', path: '/models/market' });
        ctx.slots.register(portableSlots.modelDefinitionRenderer, { id: 'models.definition.official', key: 'definition', priority: 1000, value: { render(input) { return input.defaultRender(); } } });
        let diagnostics: Array<{
            id: string;
            message: string;
        }> = [];
        let models: ModelSummary[] | undefined, loading = true, loadError: string | undefined, initialized = true, configRevision = '';
        let element: HTMLElement | undefined, listElement: HTMLElement | undefined, listContext: ViewRenderContext | undefined, pageContext: ViewRenderContext | undefined;
        let listController = new AbortController(), detailController = new AbortController();
        let listGeneration = 0, detailGeneration = 0;
        let activeModel = '', activeTab = 'information', notice = '';
        let mutationFeedback: MutationFeedback = {};
        let pageLease = 0;
        let canonicalTimer: ReturnType<typeof setTimeout> | undefined;
        let marketPackages: MarketPackage[] | undefined;
        ctx.lifecycle.own(() => { listController.abort(); detailController.abort(); clearTimeout(canonicalTimer); });
        const request = async <T,>(path: string, signal: AbortSignal, body?: unknown): Promise<T> => {
            const headers: Record<string, string> = {};
            if (body !== undefined) {
                headers['Content-Type'] = 'application/json';
                const token = sessionStorage.getItem('memsphere.settingsToken.v1');
                if (token)
                    headers.Authorization = `Bearer ${token}`;
            }
            const response = await fetch(`${config.projectApiBase ?? '/api'}${path}`, { signal, ...(body === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(body) }) });
            const payload = await response.json();
            if (!response.ok)
                throw Object.assign(Error(payload.error ?? `HTTP ${response.status}`), { feedback: payload });
            return payload as T;
        };
        function state(context: ViewRenderContext) {
            const q = context.route.query;
            const selected = (models ?? []).find(m => m.id === q.model);
            const inferred = selected?.registration?.package ? `${selected.origin ?? (selected.builtin ? 'system' : 'project')}:${selected.registration.package}` : 'custom';
            const scope = normalizeModelScope(models ?? [], q.scope ?? inferred);
            const available = [...new Set(scopeModels(models ?? [], scope).flatMap(m => m.registration?.tags ?? []))];
            const tag = available.includes(q.tag) ? q.tag : '';
            return { scope, tag, q: q.q ?? '', available };
        }
        const scopeName = (scope: string) => scope === 'custom' ? text('未定义包', 'Unpackaged') : modelGroups(models ?? []).find(g => g.id === scope)?.name ?? scope;
        function target(context: ViewRenderContext, change: Record<string, string | undefined>) { return index.to({}, { query: { ...context.route.query, ...change } }); }
        const nav = (context?: ViewRenderContext, isMarket = false): SecondaryNavigationDescriptor => {
            const scope = context ? state(context).scope : 'custom';
            const groups = modelGroups(models ?? []);
            const groupText = (origin: string) => origin === 'project' ? t('本项目', 'This project') : t('已导入的包', 'Imported packages');
            return { title: t('模型', 'Models'), icon: { kind: 'system', name: 'stack' }, items: [
                    { id: 'custom', label: t('未定义包', 'Unpackaged'), group: groupText('project'), icon: { kind: 'system', name: 'stack' }, badge: { text: String(scopeModels(models ?? [], 'custom').length) }, selected: !isMarket && scope === 'custom', route: index.to({}, { query: { scope: 'custom' } }) },
                    ...[...groups.filter(g => g.origin === 'project'), ...groups.filter(g => g.origin !== 'project')].map(g => ({ id: g.id, label: { text: g.name }, group: groupText(g.origin), icon: { kind: 'system' as const, name: 'stack' }, badge: { text: String(g.count) }, selected: !isMarket && g.id === scope, route: index.to({}, { query: { scope: g.id } }) })),
                    { id: 'market', group: t('发现', 'Discover'), separatorBefore: true, label: t('模型市场', 'Model market'), icon: { kind: 'system', name: 'storefront' }, selected: isMarket, route: marketRoute.to() }
                ] };
        };
        let navKey = '';
        function updateNavigation(context: ViewRenderContext, isMarket = false) {
            const value = nav(context, isMarket);
            const key = JSON.stringify([isMarket, value.items.map(i => [i.id, i.label, i.badge, i.selected])]);
            if (navKey === key)
                return;
            navKey = key;
            ctx.slots.upsert(slots.navigationSecondary, { id: isMarket ? 'models.market.secondary' : 'models.secondary', when: isMarket ? marketRoute.activation : index.activation, value });
        }
        const listContent = ui.contentList((context): ContentListDescriptor => {
            listContext = context;
            const s = state(context);
            const shared = { label: t('模型列表', 'Models'), header: { eyebrow: { text: ctx.module.projectId }, title: { text: scopeName(s.scope) } },
                filter: { label: t('搜索模型', 'Search models'), value: s.q, placeholder: t('查找模型…', 'Find a model…'), async onInput(value: string) { await router.navigate(target(context, { q: value || undefined })); } },
                empty: { title: t('没有匹配的模型', 'No matching models'), description: t('调整搜索词或标签，或选择其他包。', 'Change the search or tags, or select another package.') } };
            if (loading)
                return { ...shared, state: 'loading', sections: [] };
            if (loadError)
                return { ...shared, state: 'error', sections: [], error: { state: 'error', title: t('模型列表加载失败', 'Could not load models'), description: { text: loadError }, action: { label: t('重试', 'Retry'), run: refresh } } };
            const visible = filterModels(models ?? [], s.scope, s.tag, s.q), selected = visible.find(m => m.id === context.route.query.model)?.id ?? visible[0]?.id;
            return { ...shared, sections: [{ id: 'models', items: visible.map(m => {
                            const tags = m.registration?.tags ?? [];
                            const badges: BadgeDescriptor[] = tags.slice(0, 2).map(tag => ({ label: { text: tag } }));
                            if (tags.length > 2)
                                badges.push({ label: { text: `+${tags.length - 2}` }, title: { text: tags.slice(2).join(', ') } });
                            return { id: m.id, title: { text: modelName(m) }, meta: { text: m.id }, ...(modelDescription(m) ? { description: { text: modelDescription(m) } } : {}), selected: m.id === selected,
                                icon: { kind: 'system' as const, name: 'file-text' }, route: target(context, { model: m.id }), badges };
                        }) }] };
        });
        function tagsControl(context: ViewRenderContext) {
            if (!listElement)
                return;
            const s = state(context);
            let container = listElement.querySelector<HTMLDivElement>('.model-tags-filter');
            if (!container) {
                container = document.createElement('div');
                container.className = 'model-tags-filter';
                listElement.append(container);
            }
            const field = ui.select({
                label: t('标签筛选', 'Filter by tag'),
                value: s.tag,
                options: ['', ...s.available].map(tag => ({ value: tag, label: { text: tag || text('全部标签', 'All tags') } })),
                onChange(value) { return router.navigate(target(context, { tag: value || undefined })); }
            });
            container.replaceChildren(field.root);
            listElement.querySelector('.mem-view-list-filter')?.after(container);
        }

        const list: ViewMount = { async mount(target, context) { listElement = target.element; target.element.dataset.modelsList = ''; const dispose = await listContent.mount(target, context); tagsControl(context); if (models === undefined)
                await refresh(); return () => { listGeneration++; listController.abort(); delete target.element.dataset.modelsList; listElement = undefined; listContext = undefined; dispose?.(); }; }, async update(context) { await listContent.update?.(context); tagsControl(context); } };
        async function refresh() {
            const generation = ++listGeneration;
            listController.abort();
            listController = new AbortController();
            loading = true;
            loadError = undefined;
            if (listContext)
                await list.update?.(listContext);
            try {
                const data = await request<{
                    models: ModelSummary[];
                    initialized?: boolean;
                    registrationInitialized?: boolean;
                    diagnostics?: Array<{
                        id: string;
                        message: string;
                    }>;
                    configRevision?: string;
                }>('/models', listController.signal);
                if (generation !== listGeneration)
                    return;
                models = data.models;
                diagnostics = data.diagnostics ?? [];
                initialized = data.registrationInitialized ?? data.initialized ?? true;
                configRevision = data.configRevision ?? configRevision;
            }
            catch (error) {
                if (generation !== listGeneration || listController.signal.aborted)
                    return;
                loadError = error instanceof Error ? error.message : String(error);
            }
            if (generation !== listGeneration)
                return;
            loading = false;
            if (listContext)
                await list.update?.(listContext);
            if (pageContext) {
                await render(pageContext);
                scheduleCanonical(pageContext);
            }
        }
        function information(model: ModelDefinition) {
            const r = model.registration;
            const table = document.createElement('table');
            table.className = 'model-information-table';
            const body = document.createElement('tbody');
            const rows = [[text('名称', 'Name'), modelName(model)], [text('说明', 'Description'), modelDescription(model) || '—'], [text('所属包', 'Package'), r?.package ? `${r.package_name ? `${r.package_name} · ` : ''}${r.package}` : text('未定义包', 'Unpackaged')],
                [text('模型 ID', 'Model ID'), model.id], [text('定义标准', 'Definition standard'), model.metaModel], [text('标签', 'Tags'), (r?.tags ?? []).join(' · ') || '—'], [text('存储方式', 'Storage'), (r?.storage ?? (model.builtin ? 'builtin' : 'store')) === 'builtin' ? text('代码内置', 'Built into code') : text('持久化存储', 'Persistent storage')], [text('存储 ID', 'Store ID'), r?.store_id ?? '—']];
            for (const [label, value] of rows) {
                const row = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td');
                th.scope = 'row';
                th.textContent = label;
                td.textContent = value;
                row.append(th, td);
                body.append(row);
            }
            table.append(body);
            return table;
        }
        async function render(context: ViewRenderContext) {
            if (!element)
                return;
            pageContext = context;
            const isMarket = context.route.routeKey === marketRoute.key;
            updateNavigation(context, isMarket);
            const generation = ++detailGeneration;
            detailController.abort();
            detailController = new AbortController();
            const style = document.createElement('style');
            style.textContent = modelStyles + registrationStyles;
            const body = document.createElement('div');
            body.className = 'model-browser-body';
            element.dataset.models = '';
            element.replaceChildren(style, body);
            if (loading) {
                body.append(ui.feedback({ state: 'loading', title: t('正在加载模型', 'Loading models') }));
                return;
            }
            if (loadError) {
                body.append(ui.feedback({ state: 'error', title: t('模型列表加载失败', 'Could not load models'), description: { text: loadError }, action: { label: t('重试', 'Retry'), run: refresh } }));
                return;
            }
            if (diagnostics.length) {
                const details = document.createElement('details'), summary = document.createElement('summary');
                summary.textContent = text(`有 ${diagnostics.length} 条模型登记需要检查`, `${diagnostics.length} model registration(s) need attention`);
                const items = document.createElement('ul');
                for (const entry of diagnostics) {
                    const item = document.createElement('li');
                    item.textContent = `${entry.id}: ${entry.message}`;
                    items.append(item);
                }
                details.append(summary, items);
                body.append(details);
            }
            if (isMarket) {
                await renderMarket(body, generation);
                return;
            }
            if (context.route.query.scope === 'market')
                return;
            const s = state(context), visible = filterModels(models ?? [], s.scope, s.tag, s.q);
            let id = visible.find(m => m.id === context.route.query.model)?.id ?? visible[0]?.id;
            if (!initialized)
                body.append(ui.feedback({ state: 'read-only', title: t('模型登记尚未初始化', 'Model registrations are not initialized'), description: t('当前显示已有模型。初始化后将保存模型管理信息。', 'Existing models are shown. Initialize to persist their management information.'), ...(modelRegistrationSetupEnabled ? { action: { label: t('初始化模型登记', 'Initialize registrations'), async run() { await mutate('/models/initialize', {}); } } } : {}) }));
            if (!id) {
                body.append(ui.feedback({ state: 'empty', title: t('没有匹配的模型', 'No matching models') }));
                return;
            }
            if (activeModel !== id) {
                activeModel = id;
                activeTab = 'information';
            }
            if (notice) {
                const n = document.createElement('p');
                n.setAttribute('role', 'status');
                n.textContent = notice;
                body.append(n);
            }
            const pending = ui.feedback({ state: 'loading', title: t('正在读取模型', 'Loading model') });
            body.append(pending);
            try {
                const model = await request<ModelDefinition>(`/models/definition?model=${encodeURIComponent(id)}`, detailController.signal);
                if (generation !== detailGeneration || !element)
                    return;
                pending.remove();
                const heading = document.createElement('h2');
                heading.className = 'model-browser-heading';
                heading.textContent = modelName(model);
                const description = document.createElement('p');
                description.className = 'model-browser-description';
                description.textContent = modelDescription(model);
                body.append(heading, description);
                const snapshot = freezeDefinition(model);
                const switcher = document.createElement('div'), panel = document.createElement('div');
                panel.className = 'model-browser-definition-panel';
                const rendered = new Map<string, HTMLElement>();
                function select(selectedId: string) { activeTab = selectedId; switcher.replaceChildren(ui.segmentedControl({ label: t('模型详情', 'Model details'), selectedId, items: [{ id: 'information', label: t('模型信息', 'Model information') }, { id: 'structure', label: t('模型结构', 'Model structure') }, { id: 'source', label: t('原始定义', 'Source definition') }], onSelect: select })); let content = rendered.get(selectedId); if (!content) {
                    if (selectedId === 'information')
                        content = information(model);
                    else {
                        const view = selectedId === 'source' ? 'source' : 'structure';
                        content = ui.modelDefinition({ model: snapshot, view });
                    }
                    rendered.set(selectedId, content);
                } panel.replaceChildren(content); }
                select(activeTab);
                body.append(switcher, panel);
            }
            catch (error) {
                if (generation !== detailGeneration || detailController.signal.aborted || !element)
                    return;
                pending.replaceWith(ui.feedback({ state: 'error', title: t('读取模型失败', 'Could not read model'), description: { text: error instanceof Error ? error.message : String(error) }, action: { label: t('重试', 'Retry'), run: () => render(context) } }));
            }
        }
        async function mutate(path: string, payload: Record<string, unknown>) {
            try {
                const result = await request<{
                    status?: string;
                    message?: string;
                } & MutationFeedback>(path, detailController.signal, { ...payload, expectedRevision: configRevision });
                mutationFeedback = result;
                notice = result.message ?? (result.status === 'unchanged' ? text('已导入 · 无变更', 'Imported · unchanged') : text('操作成功', 'Operation completed'));
                marketPackages = undefined;
                await refresh();
            }
            catch (error) {
                mutationFeedback = (error as {
                    feedback?: MutationFeedback;
                }).feedback ?? {};
                notice = error instanceof Error ? error.message : String(error);
                if (pageContext)
                    await render(pageContext);
            }
        }
        async function renderMarket(body: HTMLElement, generation: number) {
            try {
                if (!marketPackages) {
                    const data = await request<{
                        packages: MarketPackage[];
                    }>('/models/market', detailController.signal);
                    if (generation !== detailGeneration)
                        return;
                    marketPackages = data.packages;
                }
                const heading = document.createElement('h2');
                heading.className = 'model-browser-heading';
                heading.textContent = text('模型市场', 'Model market');
                body.append(heading);
                if (notice) {
                    const p = document.createElement('p');
                    p.setAttribute('role', 'status');
                    p.textContent = notice;
                    body.append(p);
                }
                if (mutationFeedback.conflicts?.length) {
                    const conflicts = document.createElement('pre');
                    conflicts.textContent = JSON.stringify(mutationFeedback.conflicts, null, 2);
                    body.append(conflicts);
                }
                if (mutationFeedback.pendingCleanup || mutationFeedback.pendingModelRefs?.length) {
                    const pending = document.createElement('p');
                    pending.textContent = text('待清理的导入候选：', 'Import candidates awaiting cleanup: ') + (mutationFeedback.pendingModelRefs ?? []).join(', ');
                    body.append(pending, ui.button({ label: t('清理导入候选', 'Clean up import candidates'), async run() { await mutate('/models/market/cleanup', {}); } }));
                }
                if (!marketPackages.length) {
                    body.append(ui.feedback({ state: 'empty', title: t('暂无模型包', 'No model packages') }));
                    return;
                }
                const grid = document.createElement('div');
                grid.className = 'model-market-grid';
                for (const pkg of marketPackages) {
                    const card = document.createElement('article');
                    card.className = 'model-market-card';
                    const title = document.createElement('h3');
                    title.textContent = pkg.name ?? pkg.id;
                    const id = document.createElement('p');
                    id.textContent = pkg.id;
                    const desc = document.createElement('p');
                    desc.textContent = pkg.description ?? '';
                    const preview = document.createElement('div');
                    preview.hidden = true;
                    for (const model of pkg.models) {
                        const name = document.createElement('h4');
                        name.textContent = model.name ?? model.registration?.name ?? model.modelRef ?? model.id ?? '';
                        preview.append(name);
                        if (model.definition !== undefined || model.source !== undefined)
                            preview.append(ui.modelDefinition({ model: {
                                id: model.modelRef ?? model.id ?? '', metaModel: 'json-schema/draft-07.json', builtin: false,
                                definition: model.definition, source: model.source ?? JSON.stringify(model.definition, null, 2)
                            }, view: model.definition !== undefined ? 'structure' : 'source' }));
                    }
                    const actions = document.createElement('div');
                    actions.className = 'model-browser-actions';
                    actions.append(ui.button({ label: t('预览', 'Preview'), run() { preview.hidden = !preview.hidden; } }), ui.button({ label: t('导入', 'Import'), async run() { await mutate('/models/market/import', { packageId: pkg.id }); } }));
                    card.append(title, id, desc, actions, preview);
                    grid.append(card);
                }
                body.append(grid);
            }
            catch (error) {
                if (generation !== detailGeneration || detailController.signal.aborted)
                    return;
                body.append(ui.feedback({ state: 'error', title: t('模型市场加载失败', 'Could not load model market'), description: { text: error instanceof Error ? error.message : String(error) }, action: { label: t('重试', 'Retry'), run: () => { marketPackages = undefined; return pageContext ? render(pageContext) : Promise.resolve(); } } }));
            }
        }
        function scheduleCanonical(context: ViewRenderContext) {
            clearTimeout(canonicalTimer);
            if (loading || loadError || context.route.routeKey === marketRoute.key)
                return;
            const s = state(context);
            const visible = filterModels(models ?? [], s.scope, s.tag, s.q);
            const id = visible.find(m => m.id === context.route.query.model)?.id ?? visible[0]?.id;
            if (context.route.query.scope === s.scope && (context.route.query.tag ?? '') === s.tag && context.route.query.model === id)
                return;
            // Route updates follow mount completion; navigating during mount can dispose the incoming page.
            canonicalTimer = setTimeout(() => { if (pageContext === context)
                void router.navigate(context.route.query.scope === 'market' ? marketRoute.to() : target(context, { scope: s.scope, tag: s.tag || undefined, model: id })); }, 0);
        }
        const page: ViewMount = { async mount(target, context) { const lease = ++pageLease; element = target.element; pageContext = context; await render(context); if (models === undefined || loading)
                await refresh(); scheduleCanonical(pageContext ?? context); return () => { if (lease !== pageLease)
                return; detailGeneration++; detailController.abort(); delete target.element.dataset.models; element = undefined; pageContext = undefined; clearTimeout(canonicalTimer); }; }, async update(context) { await render(context); scheduleCanonical(context); } };
        ctx.slots.register(slots.navigationPrimary, { id: 'models.navigation', order: 150, value: { label: t('模型', 'Models'), icon: { kind: 'system', name: 'stack' }, route: index.to() } });
        ctx.slots.register(slots.navigationSecondary, { id: 'models.secondary', when: index.activation, value: nav() });
        ctx.slots.register(slots.navigationSecondary, { id: 'models.market.secondary', when: marketRoute.activation, value: nav(undefined, true) });
        for (const [route, prefix] of [[index, 'models'], [marketRoute, 'models.market']] as const) {
            ctx.slots.register(slots.headerTitle, { id: `${prefix}.header`, when: route.activation, value: { title: route === marketRoute ? t('模型市场', 'Model market') : t('模型', 'Models'), subtitle: { text: ctx.module.projectId } } });
            ctx.slots.register(slots.headerActions, { id: `${prefix}.refresh`, when: route.activation, value: { label: t('刷新模型', 'Refresh models'), icon: { kind: 'system', name: 'arrows-clockwise' }, run: refresh } });
            ctx.slots.register(slots.mainView, { id: `${prefix}.page`, key: route.key, when: route.activation, value: page });
        }
        ctx.slots.register(slots.contentList, { id: 'models.list', when: index.activation, value: list });
        ctx.slots.register(portableSlots.modelsPagePresentation, { id: 'models.presentation', key: 'page', priority: 1000, when: index.activation, value: page });
    }
});
function freezeDefinition<T>(value: T): T { if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value; for (const child of Object.values(value))
    freezeDefinition(child); return Object.freeze(value); }
