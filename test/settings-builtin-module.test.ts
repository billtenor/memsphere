import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import {
  createHostRouteActivation,
  createHostRouteTarget,
  slots,
  type RegisterOptions,
  type RouteDefinition,
  type SlotKind,
  type SlotToken
} from "../src/view/view-sdk.js";

const bundled = await build({
  entryPoints: [resolve("modules/org.memsphere.settings/adapter/view/index.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  alias: { "@memsphere/view-sdk": resolve("src/view/view-sdk.ts") }
});
const settingsPlugin = (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.text).toString("base64")}`)).default;

test("Settings Builtin Module registers its durable Route and Slot contract", async () => {
  const registrations: Array<{ slot: string; options: RegisterOptions<unknown> & { key?: string } }> = [];
  const activation = createHostRouteActivation();
  const target = createHostRouteTarget();
  const routeDefinitions: RouteDefinition[] = [];

  await settingsPlugin.apply({
    module: { projectId: "p", moduleId: "org.memsphere.settings", moduleVersion: "1.0.0", instanceId: "settings" },
    lifecycle: { disposed: false, own: disposer => disposer },
    router: {
      location: { pathname: "/settings/general", search: "", hash: "", params: { module: "general" } },
      register(definition) {
        routeDefinitions.push(definition);
        return { key: "settings-route", activation, to: () => target };
      },
      async navigate() {}
    },
    slots: {
      register(
        slot: SlotToken<string, SlotKind, unknown, string>,
        options: RegisterOptions<unknown> & { key?: string }
      ) {
        registrations.push({ slot: slot.definition.name, options });
        return () => {};
      }
    }
  }, { locale: "zh-CN", messages: { "common.settings": "设置" } });

  assert.deepEqual(routeDefinitions, [{ id: "section", path: "/settings/:module" }]);
  assert.deepEqual(registrations.map(entry => entry.slot), [
    slots.navigationSecondary.definition.name,
    slots.headerTitle.definition.name,
    slots.mainView.definition.name,
    slots.searchProviders.definition.name
  ]);
  assert.equal(registrations[2]?.options.key, "settings-route");
  assert.equal(typeof (registrations[2]?.options.value as { mount?: unknown }).mount, "function");
  assert.equal(typeof (registrations[3]?.options.value as { search?: unknown }).search, "function");
});
