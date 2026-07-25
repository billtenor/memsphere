export const promptLocales = ["zh-CN", "en"] as const;

export type PromptLocale = typeof promptLocales[number];

export const defaultPromptLocale: PromptLocale = "zh-CN";

export function resolvePromptLocale(value: unknown): PromptLocale {
  return value === "en" ? "en" : defaultPromptLocale;
}
