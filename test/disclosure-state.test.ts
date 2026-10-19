import assert from "node:assert/strict";
import test from "node:test";
import { DisclosureState, type DisclosureBinding } from "../modules/shared/view/disclosure-state.js";

function choice(key: string, expanded = false): DisclosureBinding & { expanded: boolean } {
  return { key, expanded, read() { return this.expanded; }, write(value) { this.expanded = value; } };
}

test("reading choices preserve both open and closed nodes synchronously across content replacement", () => {
  const state = new DisclosureState();
  const first = [choice("rules"), choice("section", true)];
  state.restore("project:memory", first);
  first[0].expanded = true;
  first[1].expanded = false;
  state.capture();
  const replacement = [choice("rules"), choice("section", true), choice("new")];
  state.restore("project:memory", replacement);
  assert.deepEqual(replacement.map(item => item.expanded), [true, false, false]);
});

test("switching objects records the old object's scope and never borrows its reading choices", () => {
  const state = new DisclosureState();
  const old = choice("rules", true);
  state.restore("project-a:memory-a:diff", [old]);
  state.capture();
  for (const scope of ["project-b:memory-a:diff", "project-a:memory-b:diff", "project-a:memory-a:candidate"]) {
    const other = choice("rules");
    state.restore(scope, [other]);
    assert.equal(other.expanded, false);
    state.capture();
  }
  const back = choice("rules");
  state.restore("project-a:memory-a:diff", [back]);
  assert.equal(back.expanded, true);
});

test("replaced or ambiguous content keeps its default instead of inheriting a different node's choice", () => {
  const state = new DisclosureState();
  state.restore("memory", [choice("position:old-content", true), choice("duplicate", true), choice("duplicate")]);
  state.capture();
  const changed = choice("position:new-content");
  const previouslyAmbiguous = choice("duplicate");
  state.restore("memory", [changed, previouslyAmbiguous]);
  assert.equal(changed.expanded, false);
  assert.equal(previouslyAmbiguous.expanded, false);
  previouslyAmbiguous.expanded = true;
  state.capture();
  const nowAmbiguous = [choice("duplicate"), choice("duplicate")];
  state.restore("memory", nowAmbiguous);
  assert.deepEqual(nowAmbiguous.map(item => item.expanded), [false, false]);
});
