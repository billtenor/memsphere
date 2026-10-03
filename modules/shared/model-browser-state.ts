import type { ModelPresentationSummary } from '../../src/view/view-sdk.js';
export type ModelGroup = {
    id: string;
    packageId: string;
    name: string;
    origin: 'project' | 'system' | 'market';
    count: number;
};
export function modelOrigin(model: ModelPresentationSummary): ModelGroup['origin'] { return model.origin ?? (model.builtin ? 'system' : 'project'); }
export function modelName(model: Pick<ModelPresentationSummary, "registration" | "title" | "id">): string { return model.registration?.name ?? model.title ?? model.id; }
export function modelDescription(model: Pick<ModelPresentationSummary, "registration" | "description">): string { return model.registration?.description ?? model.description ?? ''; }
export function modelGroups(models: readonly ModelPresentationSummary[]): ModelGroup[] {
    const groups = new Map<string, ModelGroup>();
    for (const model of models) {
        const r = model.registration;
        if (!r?.package)
            continue;
        const origin = modelOrigin(model);
        const id = `${origin}:${r.package}`;
        const group = groups.get(id);
        if (group)
            group.count++;
        else
            groups.set(id, { id, packageId: r.package, name: r.package_name ?? r.package, origin, count: 1 });
    }
    return [...groups.values()];
}
export function normalizeModelScope(models: readonly ModelPresentationSummary[], scope?: string): string {
    if (!scope || scope === 'custom')
        return 'custom';
    if (scope === 'market')
        return scope;
    const groups = modelGroups(models);
    return groups.find(g => g.id === scope)?.id ?? groups.find(g => g.packageId === scope)?.id ?? 'custom';
}
export function scopeModels(models: readonly ModelPresentationSummary[], scope: string): ModelPresentationSummary[] {
    return models.filter(m => scope === 'custom' ? modelOrigin(m) === 'project' && !m.registration?.package : `${modelOrigin(m)}:${m.registration?.package}` === scope);
}
export function filterModels(models: readonly ModelPresentationSummary[], scope: string, tag = '', query = ''): ModelPresentationSummary[] {
    const needle = query.trim().toLowerCase();
    return scopeModels(models, scope).filter(m => {
        const tags = m.registration?.tags ?? [];
        return (!tag || tags.includes(tag)) && `${modelName(m)} ${m.id} ${modelDescription(m)} ${tags.join(' ')}`.toLowerCase().includes(needle);
    });
}
