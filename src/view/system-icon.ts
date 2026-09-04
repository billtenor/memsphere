import { systemIconNames, type SystemIconName } from "./view-sdk.js";
export { systemIconNames, type SystemIconName } from "./view-sdk.js";

const systemIconNameSet = new Set<string>(systemIconNames);
const aliases: Readonly<Record<string, string>> = Object.freeze({
  memory: "brain",
  play: "play-circle",
  run: "play-circle",
  gear: "gear-six",
  settings: "gear-six",
  search: "magnifying-glass"
});

export function normalizeSystemIconName(name: string): string {
  const normalized = aliases[name] ?? name;
  return systemIconNameSet.has(normalized) ? normalized : "stack";
}

export function isSystemIconName(name: unknown): name is SystemIconName {
  return typeof name === "string" && systemIconNameSet.has(aliases[name] ?? name);
}
