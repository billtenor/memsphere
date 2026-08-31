import { defineViewPlugin, slots, type ViewMount } from "@memsphere/view-sdk";
import { createSettingsView } from "./settings-view.js";

export interface SettingsViewConfig {
  readonly locale?: string;
  readonly messages?: Readonly<Record<string, unknown>>;
}

export default defineViewPlugin<SettingsViewConfig>({
  name: "memsphere-settings-view",
  apiVersion: 1,
  inject: ["router", "slots"],
  apply(ctx, config) {
    if (!ctx.router) throw new Error("Settings View requires the router service");

    const section = ctx.router.register({ id: "section", path: "/settings/:module" });
    const mount: ViewMount = createSettingsView({
      config,
      route: section,
      navigate: target => ctx.router!.navigate(target)
    });

    ctx.slots.register(slots.headerTitle, {
      id: "settings-title",
      when: section.activation,
      value: {
        title: { text: text(config, "navigation.settingsLabel", "Memsphere 设置", { name: "Memsphere" }) },
        subtitle: { text: text(config, "navigation.globalSettingsSubtitle", "管理全局配置与项目配置。") }
      }
    });
    ctx.slots.register(slots.mainView, {
      id: "settings-main",
      key: section.key,
      when: section.activation,
      value: mount
    });
  }
});

function text(
  config: SettingsViewConfig,
  key: string,
  fallback: string,
  params: Readonly<Record<string, string | number>> = {}
): string {
  const candidate = config.messages?.[key];
  const template = typeof candidate === "string" ? candidate : fallback;
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
