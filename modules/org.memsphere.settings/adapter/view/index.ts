import { defineViewPlugin, slots, type Disposer, type RouteLocation, type RouteToken } from "@memsphere/view-sdk";
import { createSettingsViews } from "./settings-view.js";

export interface SettingsViewConfig {
  readonly locale?: string;
  readonly messages?: Readonly<Record<string, unknown>>;
  readonly projectApiBase?: string;
}

export default defineViewPlugin<SettingsViewConfig>({
  name: "memsphere-settings-view",
  apiVersion: 1,
  inject: ["router", "slots"],
  apply(ctx, config) {
    if (!ctx.router) throw new Error("Settings View requires the router service");

    const section = ctx.router.register({ id: "section", path: "/settings/:module" });
    let secondaryLease: Disposer | undefined;
    let titleLease: Disposer | undefined;
    const publishSecondary = (location: RouteLocation) => {
      const selected = normalizeSettingsSection(location.params.module);
      const previous = secondaryLease;
      secondaryLease = ctx.slots.upsert(slots.navigationSecondary, {
        id: "settings-secondary",
        when: section.activation,
        value: {
          title: { text: text(config, "common.settings", "设置") },
          icon: { kind: "system", name: "gear-six" },
          items: settingsSecondaryItems(config, section, selected)
        }
      });
      void previous?.();
      const previousTitle = titleLease;
      titleLease = ctx.slots.upsert(slots.headerTitle, {
        id: "settings-title",
        when: section.activation,
        value: {
          title: { text: settingsSectionLabel(config, selected) },
          subtitle: { text: ["project", "participants"].includes(selected)
            ? text(config, "navigation.projectSettingsSubtitle", "管理当前项目配置。")
            : text(config, "navigation.globalSettingsSubtitle", "管理 Memsphere 全局配置。") }
        }
      });
      void previousTitle?.();
    };
    ctx.lifecycle.own(() => { void titleLease?.(); void secondaryLease?.(); });
    const views = createSettingsViews({
      config,
      route: section,
      navigate: target => ctx.router!.navigate(target),
      onRoute: publishSecondary
    });
    ctx.lifecycle.own(views.dispose);

    const initialSection = normalizeSettingsSection(ctx.router.location.params.module);
    ctx.slots.register(slots.navigationSecondary, {
      id: "settings-secondary",
      when: section.activation,
      value: {
        title: { text: text(config, "common.settings", "设置") },
        icon: { kind: "system", name: "gear-six" },
        items: settingsSecondaryItems(config, section, initialSection)
      }
    });
    ctx.slots.register(slots.headerTitle, {
      id: "settings-title",
      when: section.activation,
      value: {
        title: { text: settingsSectionLabel(config, initialSection) },
        subtitle: { text: ["project", "participants"].includes(initialSection)
          ? text(config, "navigation.projectSettingsSubtitle", "管理当前项目配置。")
          : text(config, "navigation.globalSettingsSubtitle", "管理 Memsphere 全局配置。") }
      }
    });
    ctx.slots.register(slots.mainView, {
      id: "settings-main",
      key: section.key,
      when: section.activation,
      value: views.detail
    });
    ctx.slots.register(slots.searchProviders, {
      id: "settings-search",
      order: 300,
      value: {
        label: { text: text(config, "common.settings", "设置") },
        icon: { kind: "system", name: "gear-six" },
        async search({ query }) {
          const entries = [
            ["general", "常规"], ["view", "界面服务"],
            ["providers", "ACP 提供方"], ["participants", "参与者配置"]
          ] as const;
          const needle = query.trim().toLowerCase();
          return entries.filter(([, label]) => !needle || label.toLowerCase().includes(needle)).map(([module, label]) => ({
            title: { text: label }, summary: { text: text(config, "common.settings", "设置") }, type: { text: text(config, "common.settings", "设置") },
            icon: { kind: "system" as const, name: "gear-six" }, route: section.to({ module })
          }));
        }
      }
    });
  }
});

function settingsSecondaryItems(config: SettingsViewConfig, section: RouteToken, selected: string) {
  const entries = [
    ["general", text(config, "settings.general", "通用设置"), "gear-six"],
    ["view", text(config, "settings.viewService", "界面服务"), "sliders-horizontal"],
    ["providers", text(config, "settings.providers", "模型提供商"), "sparkle"],
    ["participants", text(config, "settings.participants", "参与者"), "user"],
  ] as const;
  return entries.map(([id, label, icon]) => ({
    id,
    label: { text: label },
    icon: { kind: "system" as const, name: icon },
    selected: selected === id,
    route: section.to({ module: id })
  }));
}

function settingsSectionLabel(config: SettingsViewConfig, section: string): string {
  const labels: Readonly<Record<string, string>> = {
    general: text(config, "settings.general", "通用设置"),
    view: text(config, "settings.viewService", "界面服务"),
    providers: text(config, "settings.providers", "模型提供商"),
    project: text(config, "navigation.project", "当前项目"),
    participants: text(config, "settings.participants", "参与者")
  };
  return labels[section] ?? labels.general;
}

function normalizeSettingsSection(section: string | undefined): string {
  return !section || section === "overview" ? "general" : section;
}

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
