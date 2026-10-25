import assert from "node:assert/strict";
import test from "node:test";
import { businessFixture } from "./helpers/business-data.js";
import { createCommandState, findCommandStates, requireCommandState, updateCommandState, accountRead } from "../src/home/command-state-store.js";

test("Home command state round trips without a Project registry and CAS isolates stale windows", async t => {
  const f = await businessFixture(t, {}); const previous = process.env.MEMSPHERE_HOME; process.env.MEMSPHERE_HOME = f.home;
  t.after(() => { if (previous === undefined) delete process.env.MEMSPHERE_HOME; else process.env.MEMSPHERE_HOME = previous; });
  const c = await createCommandState("project-a", "run-a"), other = await createCommandState("project-b", "run-a");
  const row = await requireCommandState(c.id);
  await accountRead("project-a", "run-a", "artifact:A"); assert.ok((await requireCommandState(c.id)).value.state.reads?.["artifact:A"]);
  await assert.rejects(updateCommandState(row, { ...row.value, state: { reads: {} } }), { code: "REVISION_CONFLICT" });
  assert.deepEqual((await requireCommandState(other.id)).value.state.reads, {});
  assert.equal((await findCommandStates("project-a", "run-a")).length, 1);
  await createCommandState("project-a", "run-a"); await accountRead("project-a", "run-a", "artifact:ambiguous");
  assert.equal((await requireCommandState(c.id)).value.state.reads?.["artifact:ambiguous"], undefined);
  await assert.rejects(requireCommandState("missing"), { code: "NOT_FOUND" });
});
