/** Paths on each side remain independent: indices are positions, not identity. */
export type MemoryDiffEntry = { beforePath?: string; afterPath?: string; afterNextPath?: string; whole?: boolean };
export type MemoryDiffPlan = { changes: MemoryDiffEntry[]; matches: Map<string, string> };
const ignored = new Set(["syntax", "effectiveRules"]);
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const key = (v: unknown): string => JSON.stringify(v, (_k, child) => {
  if (!record(child)) return child;
  return Object.fromEntries(Object.keys(child).filter(k => !ignored.has(k)).sort().map(k => [k, child[k]]));
});
function identity(v: unknown): string | undefined {
  if (!record(v)) return undefined;
  if (Array.isArray(v.names) && v.names[0]) return `name:${v.names[0]}`;
  if (v.target) return `target:${v.target}`;
  const content = record(v.condition) ? v.condition : v;
  if (content.action) return `action:${v.tag ?? "!action"}:${content.action}`;
  return undefined;
}
function compatible(a: unknown, b: unknown): boolean {
  if (record(a) && record(b)) return a.tag === b.tag && (!identity(a) || !identity(b) || identity(a) === identity(b));
  return typeof a === typeof b && !Array.isArray(a) && !Array.isArray(b);
}
/** Exact ordered matches protect unchanged neighbors. Edited items only pair inside gaps. */
export function orderedPairs(before: unknown[], after: unknown[]): Array<[number | undefined, number | undefined]> {
  const leftKeys = before.map(key), rightKeys = after.map(key);
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) for (let j = after.length - 1; j >= 0; j--) {
    table[i]![j] = leftKeys[i] === rightKeys[j] ? 1 + table[i + 1]![j + 1]! : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  }
  const matches: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < before.length && j < after.length) {
    if (leftKeys[i] === rightKeys[j]) { matches.push([i++, j++]); }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  const result: Array<[number | undefined, number | undefined]> = [];
  let startLeft = 0, startRight = 0;
  for (const [endLeft, endRight] of [...matches, [before.length, after.length] as [number, number]]) {
    // A single edited structural item may change its action/name/type entirely.
    if (endLeft - startLeft === 1 && endRight - startRight === 1) result.push([startLeft, startRight]);
    else {
      let a = startLeft, b = startRight;
      while (a < endLeft || b < endRight) {
        if (a < endLeft && b < endRight && compatible(before[a], after[b])) result.push([a++, b++]);
        else if (a < endLeft && (b >= endRight || !after.slice(b + 1, endRight).some(v => identity(v) && identity(v) === identity(before[a])))) result.push([a++, undefined]);
        else result.push([undefined, b++]);
      }
    }
    if (endLeft < before.length) result.push([endLeft, endRight]);
    startLeft = endLeft + 1; startRight = endRight + 1;
  }
  return result;
}
export function memoryDiffPlan(before: unknown, after: unknown, root: string): MemoryDiffPlan {
  const plan: MemoryDiffPlan = { changes: [], matches: new Map() };
  const walk = (a: unknown, b: unknown, left: string, right: string): void => {
    plan.matches.set(left, right);
    if (Array.isArray(a) && Array.isArray(b)) {
      const pairs = orderedPairs(a, b);
      for (const [position, [i, j]] of pairs.entries()) {
        if (i === undefined) plan.changes.push({ afterPath: `${right}[${j! + 1}]`, whole: typeof b[j!] === "object" });
        else if (j === undefined) {
          const next = pairs.slice(position + 1).find(([, rightIndex]) => rightIndex !== undefined)?.[1];
          plan.changes.push({ beforePath: `${left}[${i + 1}]`, ...(next === undefined ? {} : { afterNextPath: `${right}[${next + 1}]` }), whole: typeof a[i] === "object" });
        }
        else walk(a[i], b[j], `${left}[${i + 1}]`, `${right}[${j + 1}]`);
      }
      return;
    }
    if (record(a) && record(b)) {
      if (a.tag !== b.tag) { plan.changes.push({ beforePath: left, afterPath: right, whole: true }); return; }
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (ignored.has(k) || k === "tag") continue;
        if (!(k in a)) plan.changes.push({ afterPath: `${right}.${k}`, whole: typeof b[k] === "object" });
        else if (!(k in b)) plan.changes.push({ beforePath: `${left}.${k}`, whole: typeof a[k] === "object" });
        else walk(a[k], b[k], `${left}.${k}`, `${right}.${k}`);
      }
      return;
    }
    if (key(a) !== key(b)) plan.changes.push({ beforePath: left, afterPath: right, whole: typeof a === "object" || typeof b === "object" });
  };
  walk(before, after, root, root);
  return plan;
}
