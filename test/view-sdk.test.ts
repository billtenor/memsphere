import assert from "node:assert/strict";
import test from "node:test";
import {
  createHostRouteActivation,
  createHostRouteTarget,
  defineSlot,
  defineViewPlugin,
  isHeaderActionDescriptor,
  isHeaderTitleDescriptor,
  isNavigationItemDescriptor,
  isRouteActivation,
  isRouteTarget,
  isSlotToken,
  slots,
  type ViewMount,
  type ViewRenderContext
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

test("ViewRenderContext exposes the Host-resolved readonly Route location", () => {
  const context: ViewRenderContext = {
    module: { projectId: "p", moduleId: "org.test.module", moduleVersion: "1.0.0", instanceId: "one" },
    route: {
      pathname: "/items/example",
      search: "",
      hash: "",
      params: { id: "example" },
      routeKey: "org.test.module@1.0.0:one:route:detail"
    }
  };
  assert.equal(context.route.params.id, "example");
});

test("built-in Tokens expose the four approved Slot contracts", () => {
  assert.deepEqual(
    Object.values(slots).map(slot => ({
      name: slot.definition.name,
      kind: slot.definition.kind,
      scope: slot.definition.scope,
      render: slot.definition.render
    })),
    [
      { name: "navigation.primary", kind: "list", scope: "project", render: "descriptor" },
      { name: "header.title", kind: "single", scope: "page", render: "descriptor" },
      { name: "header.actions", kind: "list", scope: "page", render: "descriptor" },
      { name: "main.view", kind: "keyed", scope: "shell", render: "mount" }
    ]
  );
  for (const slot of Object.values(slots)) {
    assert.equal(isSlotToken(slot), true);
    assert.equal(Object.isFrozen(slot), true);
    assert.equal(Object.isFrozen(slot.definition), true);
  }
});

test("Route values are accepted only when created by the ViewHost bridge", () => {
  const activation = createHostRouteActivation();
  const target = createHostRouteTarget();
  assert.equal(isRouteActivation(activation), true);
  assert.equal(isRouteTarget(target), true);
  assert.equal(isRouteActivation({}), false);
  assert.equal(isRouteTarget({ path: "/memories" }), false);
  assert.equal(Object.isFrozen(activation), true);
  assert.equal(Object.isFrozen(target), true);
});

test("Descriptor validators accept standard data and reject HTML or forged Routes", () => {
  const route = createHostRouteTarget();
  const navigation = {
    label: { text: "Memory" },
    icon: { kind: "system", name: "memory" },
    route
  };
  const title = {
    title: { key: "memory.title" },
    subtitle: { text: "Project memories" },
    breadcrumbs: [{ label: { text: "Home" }, route }]
  };
  const action = { label: { text: "Refresh" }, run() {} };

  assert.equal(isNavigationItemDescriptor(navigation), true);
  assert.equal(slots.navigationPrimary.definition.validate(navigation), true);
  assert.equal(isHeaderTitleDescriptor(title), true);
  assert.equal(slots.headerTitle.definition.validate(title), true);
  assert.equal(isHeaderActionDescriptor(action), true);
  assert.equal(slots.headerActions.definition.validate(action), true);
  assert.equal(isNavigationItemDescriptor({ ...navigation, route: { path: "/memories" } }), false);
  assert.equal(isHeaderTitleDescriptor({ ...title, html: "<b>unsafe</b>" }), false);
  assert.equal(isHeaderActionDescriptor({ ...action, element: {} }), false);
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
