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
      ctx.slots.register(slots.navigationPrimary, {
        id: "core.navigation.home",
        order: 0,
        value: { label: msg("navigation.home"), icon: { kind: "system", name: "house" }, route: home.to() }
      });
      ctx.slots.register(slots.headerTitle, {
        id: "core.header.home",
        when: home.activation,
        value: { title: msg("navigation.home"), subtitle: { text: options.projectName } }
      });
      ctx.slots.register(slots.headerActions, {
        id: "core.header.search",
        order: 0,
        when: home.activation,
        value: {
          label: msg("navigation.searchMemories"),
          icon: { kind: "system", name: "search" },
          run: () => {
            history.pushState({}, "", "/memories");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        }
      });
      ctx.slots.register(slots.headerActions, {
        id: "core.header.market",
        order: 10,
        when: home.activation,
        value: {
          label: msg("navigation.memoryMarket"),
          icon: { kind: "system", name: "plus" },
          run: () => {
            history.pushState({}, "", "/market");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
        }
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
            icon: { kind: "system", name: "gear" },
            run: () => {
              history.pushState({}, "", "/settings/overview");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          }
        }
      });
      ctx.slots.register(slots.sidebarFooter, {
        id: "core.status",
        order: 100,
        value: { kind: "status", label: msg("service.healthy"), status: "healthy" }
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
