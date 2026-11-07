import { appendEffectiveRules, countEffectiveRules } from './effective-rules.js';

/** Read-only rule projection; all reference bodies come from the Run snapshot. */
export type RuleProjection = {
    reference?: string;
    defines?: string[];
    asserts?: Array<string | RuleProjection>;
    suggests?: Array<string | RuleProjection>;
    sections?: Array<RuleProjection & { name?: string }>;
};
export function graphRuleGroup(title: string, declarations: unknown[] | undefined, projection: RuleProjection | undefined, channel: 'asserts' | 'suggests', english: boolean): HTMLElement | undefined {
    if (!declarations?.length) return;
    const group = document.createElement('section');
    const heading = document.createElement('h4'); heading.textContent = title; group.append(heading);
    const list = document.createElement('ul'); list.className = 'pg-values'; group.append(list);
    for (const value of declarations) {
        const item = document.createElement('li');
        if (typeof value === 'string') item.textContent = value;
        else if (value && typeof value === 'object' && 'target' in value) {
            const target = String(value.target);
            const source = projection?.[channel]?.find(entry => typeof entry !== 'string' && entry.reference === target);
            const details = document.createElement('details'); details.className = 'pg-rule-reference rule-reference';
            const summary = document.createElement('summary'); summary.className = 'rule-reference-summary';
            const label = document.createElement('span'); label.className = 'rule-reference-label'; label.textContent = target; summary.append(label);
            if (source && typeof source === 'object') {
                const count = document.createElement('span'); count.className = 'rule-reference-toggle';
                count.textContent = `${countEffectiveRules(source)} ${english ? 'effective rules' : '条生效规则'}`; summary.append(count);
            }
            details.append(summary);
            const body = document.createElement('div'); body.className = 'effective-rule-inline';
            if (source && typeof source === 'object') {
                for (const text of source.defines ?? []) { const p = document.createElement('p'); p.textContent = text; body.append(p); }
                appendEffectiveRules(body, source, channel);
            } else {
                const p = document.createElement('p'); p.textContent = english ? 'Rule source unavailable in this snapshot.' : '此快照中无可用的规则来源正文。'; body.append(p);
            }
            details.append(body); item.append(details);
        } else continue;
        list.append(item);
    }
    return group;
}
