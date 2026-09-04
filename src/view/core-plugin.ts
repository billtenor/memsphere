import { defineViewPlugin, slots, type ViewMount } from "./view-sdk.js";

export interface CorePluginOptions {
  readonly homeMount: ViewMount;
  readonly messages: Readonly<Record<string, unknown>>;
  readonly projectName: string;
}

export function createCorePlugin(options: CorePluginOptions) {
  const msg = (key: string) => {
    const value = options.messages[key];
    return { text: typeof value === "string" ? value : key } as const;
  };
  return defineViewPlugin({
    name: "memsphere-core-view",
    apiVersion: 1,
    inject: ["slots", "router"],
    apply(ctx) {
      if (!ctx.router) throw new Error("Core View requires the router service");
      const home = ctx.router.register({ id: "home", path: "/" });
      ctx.slots.register(slots.headerTitle, {
        id: "core.header.home",
        when: home.activation,
        value: { title: msg("navigation.home"), subtitle: { text: options.projectName } }
      });
      ctx.slots.register(slots.headerAccount, {
        id: "core.account",
        value: { label: msg("account.avatar"), status: msg("account.localHuman") }
      });
      ctx.slots.register(slots.sidebarFooter, {
        id: "core.settings",
        order: 0,
        value: {
          kind: "action",
          action: {
            label: msg("common.settings"),
            icon: { kind: "system", name: "gear-six" },
            run: () => {
              history.pushState({}, "", `/projects/${encodeURIComponent(options.projectName)}/settings/general`);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          }
        }
      });
      ctx.slots.register(slots.mainView, {
        id: "core.home",
        key: home.key,
        when: home.activation,
        value: options.homeMount
      });
    }
  });
}
