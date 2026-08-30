import assert from "node:assert/strict";
import test from "node:test";
import {
  defineSlot,
  defineViewPlugin,
  isSlotToken,
  slots,
  type ViewMount
} from "../src/view/view-sdk.js";

test("defineViewPlugin preserves the Plugin object used as the Bundle default export", () => {
  const plugin = {
    name: "example",
    apiVersion: 1 as const,
    inject: ["slots"] as const,
    apply() {}
  };

  assert.equal(defineViewPlugin(plugin), plugin);
});

test("main.view Token carries one stable keyed Mount contract", () => {
  assert.equal(isSlotToken(slots.mainView), true);
  assert.deepEqual(
    {
      name: slots.mainView.definition.name,
      version: slots.mainView.definition.version,
      kind: slots.mainView.definition.kind,
      scope: slots.mainView.definition.scope,
      render: slots.mainView.definition.render
    },
    {
      name: "main.view",
      version: 1,
      kind: "keyed",
      scope: "shell",
      render: "mount"
    }
  );
  assert.equal(slots.mainView.definition.validate({ mount() {} }), true);
  assert.equal(slots.mainView.definition.validate({}), false);
});

test("defineSlot creates branded immutable Tokens without accepting structural forgeries", () => {
  const token = defineSlot<ViewMount, string>()({
    name: "com.example/page",
    version: 1,
    kind: "keyed",
    scope: "page",
    render: "mount",
    validate: value => Boolean(value && typeof value === "object" && "mount" in value)
  });

  assert.equal(isSlotToken(token), true);
  assert.equal(isSlotToken({ definition: token.definition }), false);
  assert.equal(Object.isFrozen(token), true);
  assert.equal(Object.isFrozen(token.definition), true);
});
