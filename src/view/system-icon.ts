export const systemIconNames = Object.freeze([
  "archive", "arrow-right", "arrows-clockwise", "brain", "caret-down", "check-circle",
  "circle-fill", "clock-counter-clockwise", "code", "cube", "file-text", "folder",
  "gear-six", "house", "magnifying-glass", "play-circle", "plus", "seal-check",
  "sliders-horizontal", "sparkle", "stack", "storefront", "user", "warning-circle", "x"
] as const);

const systemIconNameSet = new Set<string>(systemIconNames);
const aliases: Readonly<Record<string, string>> = Object.freeze({
  memory: "brain",
  play: "play-circle",
  run: "play-circle",
  gear: "gear-six",
  settings: "gear-six",
  search: "magnifying-glass"
});

export const fillSystemIconNames = new Set<string>([
  "brain", "circle", "cube", "gear-six", "house", "play-circle", "seal-check", "stack"
]);

export function normalizeSystemIconName(name: string): string {
  const normalized = aliases[name] ?? name;
  return systemIconNameSet.has(normalized) ? normalized : "stack";
}
