import type { AcpProviderDefinition, AcpProviderType } from "../../acp/catalog.js";
import type { AcpProviderDetectionResult } from "../../acp/detection.js";
import { enViewMessages, enViewPluralMessages } from "./en.js";
import { zhCNViewMessages, type ZhCNViewMessageKey } from "./zh-CN.js";

export const viewLocales = ["zh-CN", "en"] as const;
export type ViewLocale = typeof viewLocales[number];
export type ViewMessageKey = ZhCNViewMessageKey;
export type ViewMessageParams = Record<string, string | number | boolean | null | undefined>;
export type ViewMessage = string | { one: string; other: string };

const messages: Record<ViewLocale, Record<ViewMessageKey, ViewMessage>> = {
  "zh-CN": zhCNViewMessages,
  en: { ...enViewMessages, ...enViewPluralMessages }
};

export function resolveViewLocale(value: unknown): ViewLocale {
  return value === "en" ? "en" : "zh-CN";
}

export function viewMessages(locale: unknown): Record<ViewMessageKey, ViewMessage> {
  return messages[resolveViewLocale(locale)];
}

export function formatViewMessage(
  locale: unknown,
  key: ViewMessageKey,
  params: ViewMessageParams = {}
): string {
  const message = viewMessages(locale)[key];
  const template = typeof message === "string"
    ? message
    : message[new Intl.PluralRules(resolveViewLocale(locale)).select(Number(params.count)) === "one" ? "one" : "other"];
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function formatViewDate(locale: unknown, value: string | number | Date): string {
  const resolved = resolveViewLocale(locale);
  return new Intl.DateTimeFormat(resolved, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: resolved === "en" ? undefined : false
  }).format(new Date(value));
}

export function serializeViewMessages(locale: unknown): string {
  return JSON.stringify(viewMessages(locale))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function localizeAcpProviderDefinition(
  definition: AcpProviderDefinition,
  locale: unknown
): AcpProviderDefinition {
  const type = definition.type;
  return {
    ...definition,
    installHelp: formatViewMessage(locale, providerMessageKey("installHelp", type)),
    windowsSupport: {
      ...definition.windowsSupport,
      reason: formatViewMessage(locale, providerMessageKey("windowsReason", type))
    }
  };
}

export function localizeAcpProviderDetection(
  result: AcpProviderDetectionResult,
  locale: unknown
): AcpProviderDetectionResult {
  const installHelp = formatViewMessage(locale, providerMessageKey("installHelp", result.type));
  if (result.status === "missing") {
    return {
      ...result,
      reason: formatViewMessage(locale, "settings.provider.detection.missing", { command: result.command }),
      installHelp
    };
  }
  if (result.status === "version_unknown") {
    return {
      ...result,
      reason: formatViewMessage(locale, "settings.provider.detection.versionUnknown"),
      installHelp
    };
  }
  if (result.status === "failed") {
    return {
      ...result,
      reason: formatViewMessage(locale, "settings.provider.detection.failed", {
        reason: result.reason ?? formatViewMessage(locale, "common.unknown")
      }),
      installHelp
    };
  }
  return { ...result, installHelp };
}

function providerMessageKey(
  group: "installHelp" | "windowsReason",
  type: AcpProviderType
): ViewMessageKey {
  return `settings.provider.${group}.${type}` as ViewMessageKey;
}
