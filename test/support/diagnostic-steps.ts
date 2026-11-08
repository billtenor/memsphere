import type { TestContext } from "node:test";

type State = { start: number; next: number; active: Map<number, { label: string; start: number }> };
const states = new WeakMap<TestContext, State>();
function state(t: TestContext) {
  let current = states.get(t);
  if (!current) {
    current = { start: performance.now(), next: 0, active: new Map() }; states.set(t, current);
    const s = current;
    t.signal.addEventListener("abort", () => {
      if (s.active.size) note(t, "abort-with-pending-steps", { active: [...s.active].map(([id, item]) => ({ id, label: item.label, milliseconds: Math.round(performance.now() - item.start) })) });
    }, { once: true });
  }
  return current;
}
export function note(t: TestContext, event: string, detail: Record<string, unknown> = {}) {
  if (!process.env.MEMSPHERE_TEST_TRACE) return;
  const s = state(t);
  process.stderr.write(`[test-trace] ${JSON.stringify({ test: t.name, event, elapsedMs: Math.round(performance.now() - s.start), ...detail })}\n`);
}
export async function measured<T>(t: TestContext, label: string, action: () => Promise<T>): Promise<T> {
  if (!process.env.MEMSPHERE_TEST_TRACE) return action();
  const s = state(t), id = ++s.next, start = performance.now(); s.active.set(id, { label, start }); note(t, "begin", { id, label });
  try {
    const result = await action(); note(t, "end", { id, label, milliseconds: Math.round(performance.now() - start), aborted: t.signal.aborted }); return result;
  } catch (error) {
    note(t, "error", { id, label, milliseconds: Math.round(performance.now() - start), error: (error as Error).message, aborted: t.signal.aborted }); throw error;
  } finally { s.active.delete(id); }
}
export const cpuProfileArguments = () => process.env.MEMSPHERE_TEST_PROFILE_DIR ? ["--cpu-prof", `--cpu-prof-dir=${process.env.MEMSPHERE_TEST_PROFILE_DIR}`] : [];
