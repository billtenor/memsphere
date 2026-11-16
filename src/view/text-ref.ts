import type { TextRef } from "./view-sdk.js";

/** Shared literal/parameter rendering for public UI descriptors. */
export function textValue(value: TextRef): string {
  if ("text" in value) return value.text;
  return value.key.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) => String(value.params?.[name] ?? `{${name}}`));
}
