import type { RulePart, StatementMemory, StatementNode } from "./ast.js";
import { parseLogicalMemoryReference } from "./logical-reference.js";

export type RuleChannel = "asserts" | "suggests";

export type EffectiveRule = {
  kind: "rule";
  text: string;
  /** Stable within one resolved Memory snapshot. Not intended as display copy. */
  ruleId: string;
};

export type EffectiveRuleReference = {
  kind: "reference";
  target: string;
  entries: EffectiveRuleEntry[];
  sections: EffectiveRuleSection[];
};

export type EffectiveRuleEntry = EffectiveRule | EffectiveRuleReference;

export type EffectiveRuleSection = {
  name: string;
  defines: string[];
  entries: EffectiveRuleEntry[];
  sections: EffectiveRuleSection[];
};

export type EffectiveRuleTree = {
  channel: RuleChannel;
  entries: EffectiveRuleEntry[];
  sections: EffectiveRuleSection[];
};

export type RuleLookup = (target: string) => Promise<StatementNode | StatementMemory>;

export class RuleResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleResolutionError";
  }
}

/**
 * Resolve one rule-bearing field without mutating its declared RuleParts.
 * References stay as groups in the returned tree while their matching channel
 * is recursively projected through every Statement section.
 */
export async function resolveRuleParts(
  channel: RuleChannel,
  parts: readonly RulePart[] | undefined,
  lookup: RuleLookup
): Promise<EffectiveRuleTree> {
  const cache = new Map<string, Promise<EffectiveRuleReference>>();

  const projectReference = async (target: string, stack: readonly string[]): Promise<EffectiveRuleReference> => {
    const parsed = parseLogicalMemoryReference(target);
    if (!parsed || parsed.kind !== "statements") {
      throw new RuleResolutionError(`${channel} reference target "${target}" must identify a Statement`);
    }
    if (stack.includes(target)) {
      const cycle = [...stack.slice(stack.indexOf(target)), target]
        .map((reference) => `${reference}.${channel}`)
        .join(" -> ");
      throw new RuleResolutionError(`Statement ${channel} reference cycle detected: ${cycle}`);
    }

    const cached = cache.get(target);
    if (cached) return cloneReference(await cached);

    const pending = (async (): Promise<EffectiveRuleReference> => {
      let statement: StatementNode | StatementMemory;
      try {
        statement = await lookup(target);
      } catch (error) {
        throw new RuleResolutionError(
          `${channel} reference target "${target}" could not be read: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (statement.tag !== "!statement") {
        throw new RuleResolutionError(`${channel} reference target "${target}" must identify a Statement`);
      }
      const projection = await projectStatement(target, statement, channel, projectReference, [...stack, target]);
      if (!containsRule(projection.entries, projection.sections)) {
        throw new RuleResolutionError(`${channel} reference target "${target}" has no effective ${channel}`);
      }
      return projection;
    })();
    cache.set(target, pending);
    try {
      return cloneReference(await pending);
    } catch (error) {
      cache.delete(target);
      throw error;
    }
  };

  const declaredEntries: EffectiveRuleEntry[] = [];
  for (const [index, part] of (parts ?? []).entries()) {
    if (typeof part === "string") {
      declaredEntries.push({ kind: "rule", text: part, ruleId: `local:${channel}[${index}]` });
    } else {
      declaredEntries.push(await projectReference(part.target, []));
    }
  }

  const seen = new Set<string>();
  return {
    channel,
    entries: deduplicateEntries(declaredEntries, seen),
    sections: []
  };
}

export function flattenEffectiveRules(tree: EffectiveRuleTree): EffectiveRule[] {
  const rules: EffectiveRule[] = [];
  collectRules(tree.entries, tree.sections, rules);
  return rules;
}

async function projectStatement(
  target: string,
  statement: StatementNode | StatementMemory,
  channel: RuleChannel,
  projectReference: (target: string, stack: readonly string[]) => Promise<EffectiveRuleReference>,
  stack: readonly string[]
): Promise<EffectiveRuleReference> {
  const entries = await projectEntries(target, channel, statement[channel] ?? [], "", projectReference, stack);
  const sections: EffectiveRuleSection[] = [];
  for (const [index, section] of (statement.sections ?? []).entries()) {
    const projected = await projectSection(target, section, channel, `sections[${index}]`, projectReference, stack);
    if (containsRule(projected.entries, projected.sections)) sections.push(projected);
  }
  return { kind: "reference", target, entries, sections };
}

async function projectSection(
  target: string,
  section: StatementNode,
  channel: RuleChannel,
  path: string,
  projectReference: (target: string, stack: readonly string[]) => Promise<EffectiveRuleReference>,
  stack: readonly string[]
): Promise<EffectiveRuleSection> {
  const entries = await projectEntries(target, channel, section[channel] ?? [], `${path}.`, projectReference, stack);
  const sections: EffectiveRuleSection[] = [];
  for (const [index, child] of (section.sections ?? []).entries()) {
    const projected = await projectSection(target, child, channel, `${path}.sections[${index}]`, projectReference, stack);
    if (containsRule(projected.entries, projected.sections)) sections.push(projected);
  }
  return {
    name: section.names[0],
    defines: [...section.defines],
    entries,
    sections
  };
}

async function projectEntries(
  target: string,
  channel: RuleChannel,
  parts: readonly RulePart[],
  pathPrefix: string,
  projectReference: (target: string, stack: readonly string[]) => Promise<EffectiveRuleReference>,
  stack: readonly string[]
): Promise<EffectiveRuleEntry[]> {
  const entries: EffectiveRuleEntry[] = [];
  for (const [index, part] of parts.entries()) {
    if (typeof part === "string") {
      entries.push({
        kind: "rule",
        text: part,
        ruleId: `${target}#${pathPrefix}${channel}[${index}]`
      });
    } else {
      entries.push(await projectReference(part.target, stack));
    }
  }
  return entries;
}

function containsRule(entries: readonly EffectiveRuleEntry[], sections: readonly EffectiveRuleSection[]): boolean {
  return entries.some((entry) => entry.kind === "rule" || containsRule(entry.entries, entry.sections)) ||
    sections.some((section) => containsRule(section.entries, section.sections));
}

function deduplicateEntries(entries: readonly EffectiveRuleEntry[], seen: Set<string>): EffectiveRuleEntry[] {
  const result: EffectiveRuleEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "rule") {
      if (seen.has(entry.ruleId)) continue;
      seen.add(entry.ruleId);
      result.push({ ...entry });
      continue;
    }
    const reference: EffectiveRuleReference = {
      kind: "reference",
      target: entry.target,
      entries: deduplicateEntries(entry.entries, seen),
      sections: deduplicateSections(entry.sections, seen)
    };
    if (containsRule(reference.entries, reference.sections)) result.push(reference);
  }
  return result;
}

function deduplicateSections(sections: readonly EffectiveRuleSection[], seen: Set<string>): EffectiveRuleSection[] {
  return sections.map((section) => ({
    name: section.name,
    defines: [...section.defines],
    entries: deduplicateEntries(section.entries, seen),
    sections: deduplicateSections(section.sections, seen)
  })).filter((section) => containsRule(section.entries, section.sections));
}

function collectRules(
  entries: readonly EffectiveRuleEntry[],
  sections: readonly EffectiveRuleSection[],
  output: EffectiveRule[]
): void {
  for (const entry of entries) {
    if (entry.kind === "rule") output.push({ ...entry });
    else collectRules(entry.entries, entry.sections, output);
  }
  for (const section of sections) collectRules(section.entries, section.sections, output);
}

function cloneReference(reference: EffectiveRuleReference): EffectiveRuleReference {
  return {
    kind: "reference",
    target: reference.target,
    entries: reference.entries.map(cloneEntry),
    sections: reference.sections.map(cloneSection)
  };
}

function cloneEntry(entry: EffectiveRuleEntry): EffectiveRuleEntry {
  return entry.kind === "rule" ? { ...entry } : cloneReference(entry);
}

function cloneSection(section: EffectiveRuleSection): EffectiveRuleSection {
  return {
    name: section.name,
    defines: [...section.defines],
    entries: section.entries.map(cloneEntry),
    sections: section.sections.map(cloneSection)
  };
}
