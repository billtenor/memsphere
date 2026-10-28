/** Read-only rule projection shared by frozen graph definitions. Memory supplies its native renderer. */
export type RuleProjection = {
    reference?: string;
    defines?: string[];
    asserts?: Array<string | RuleProjection>;
    suggests?: Array<string | RuleProjection>;
    sections?: Array<RuleProjection & {
        name?: string;
    }>;
};
export function graphRuleGroup(title: string, declarations: unknown[] | undefined, projection: RuleProjection | undefined, channel: 'asserts' | 'suggests', english: boolean): HTMLElement | undefined {
    if (!declarations?.length)
        return;
    const group = document.createElement('section');
    const heading = document.createElement('h4');
    heading.textContent = title;
    group.append(heading);
    const list = document.createElement('ul');
    list.className = 'pg-values';
    group.append(list);
    const appendProjection = (host: HTMLElement, source: RuleProjection) => {
        for (const text of source.defines ?? []) {
            const p = document.createElement('p');
            p.textContent = text;
            host.append(p);
        }
        const items = document.createElement('ul');
        for (const value of source[channel] ?? []) {
            const item = document.createElement('li');
            if (typeof value === 'string')
                item.textContent = value;
            else
                appendReference(item, value.reference ?? '', value);
            items.append(item);
        }
        if (items.childElementCount)
            host.append(items);
        for (const section of source.sections ?? []) {
            const details = document.createElement('details'), summary = document.createElement('summary');
            summary.textContent = section.name ?? (english ? 'Section' : '章节');
            details.append(summary);
            appendProjection(details, section);
            host.append(details);
        }
    };
    const appendReference = (host: HTMLElement, target: string, source?: RuleProjection) => {
        const details = document.createElement('details');
        details.className = 'pg-rule-reference';
        const summary = document.createElement('summary');
        summary.textContent = target;
        details.append(summary);
        if (source)
            appendProjection(details, source);
        else {
            const p = document.createElement('p');
            p.textContent = english ? 'Rule source unavailable in this snapshot.' : '此快照中无可用的规则来源正文。';
            details.append(p);
        }
        host.append(details);
    };
    for (const value of declarations) {
        const item = document.createElement('li');
        if (typeof value === 'string')
            item.textContent = value;
        else if (value && typeof value === 'object' && 'target' in value) {
            const target = String(value.target);
            const source = projection?.[channel]?.find(entry => typeof entry !== 'string' && entry.reference === target);
            appendReference(item, target, typeof source === 'object' ? source : undefined);
        }
        list.append(item);
    }
    return group;
}
