/** Shared read-only rendering of effective Statement rules for Memory and Run. */
type RuleNode = { [key: string]: unknown };
type Channel = 'asserts' | 'suggests';
const records = (value: unknown): RuleNode[] => Array.isArray(value) ? value.filter((entry): entry is RuleNode => !!entry && typeof entry === 'object') : [];
const entries = (node: RuleNode, channel: Channel): unknown[] => Array.isArray(node[channel]) ? node[channel] as unknown[] : Array.isArray(node.entries) ? node.entries : [];

export function countEffectiveRules(node: RuleNode): number {
  let count = 0;
  for (const value of [...entries(node, 'asserts'), ...entries(node, 'suggests')]) {
    if (typeof value === 'string' || (value && typeof value === 'object' && (value as RuleNode).kind === 'rule')) count++;
    else if (value && typeof value === 'object') count += countEffectiveRules(value as RuleNode);
  }
  for (const section of records(node.sections)) count += countEffectiveRules(section);
  return count;
}

export function appendEffectiveRules(parent: HTMLElement, node: RuleNode, channel: Channel): void {
  const values = entries(node, channel);
  if (values.length) {
    const list = document.createElement('ul'); list.className = 'effective-rule-list';
    for (const value of values) {
      if (typeof value === 'string' || (value && typeof value === 'object' && (value as RuleNode).kind === 'rule')) {
        const item = document.createElement('li'); item.textContent = typeof value === 'string' ? value : String((value as RuleNode).text ?? ''); list.append(item);
      } else if (value && typeof value === 'object') {
        const reference = value as RuleNode, item = document.createElement('li');
        const name = reference.reference ?? reference.target;
        if (name) { const label = document.createElement('span'); label.className = 'effective-rule-source'; label.textContent = String(name); item.append(label); }
        if (Array.isArray(reference.defines)) for (const definition of reference.defines) { const p = document.createElement('p'); p.textContent = String(definition); item.append(p); }
        appendEffectiveRules(item, reference, channel); list.append(item);
      }
    }
    if (list.childElementCount) parent.append(list);
  }
  for (const section of records(node.sections)) {
    const block = document.createElement('section'); block.className = 'memory-node effective-rule-section';
    const title = document.createElement('h4'); title.textContent = String(section.name ?? ''); block.append(title);
    if (Array.isArray(section.defines)) for (const definition of section.defines) { const p = document.createElement('p'); p.textContent = String(definition); block.append(p); }
    appendEffectiveRules(block, section, channel); parent.append(block);
  }
}

/** Reused by both modules; public theme tokens make the presentation portable. */
export const effectiveRuleStyles = `
.rule-reference-summary { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.rule-reference-toggle, .rule-reference-label { border:0; border-radius:999px; background:var(--mem-view-color-subtle); color:var(--mem-view-color-accent); padding:3px 9px; }
.rule-reference-toggle:disabled { opacity:.55; cursor:not-allowed; }
.effective-rule-inline { margin:8px 0 2px 14px; padding-left:12px; border-left:2px solid var(--mem-view-color-border); }
.effective-rule-inline[hidden] { display:none; }
.effective-rule-section { position:relative; margin:8px 0; padding:10px 12px; border-left:3px solid var(--mem-view-color-border-strong); background:var(--mem-view-color-subtle); }
.effective-rule-section h4 { margin:0 0 8px; }
.effective-rule-section ul { margin:6px 0; padding-left:22px; }
`;
