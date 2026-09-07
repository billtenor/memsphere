import postcss, { type AtRule, type ChildNode, type Declaration, type Root, type Rule } from "postcss";

export interface ValidatedGlobalStyle {
  readonly css: string;
  readonly assets: readonly string[];
}

const allowedAtRules = new Set([
  "media", "supports", "layer", "container", "font-face", "keyframes", "-webkit-keyframes"
]);

const forbiddenSelectorFragments = [
  ".view-shell-",
  "[data-view-slot",
  "[data-view-shell",
  "[data-view-page-portals",
  "#memsphere-view-root"
];

export function validateGlobalStyle(source: string, namespace?: string): ValidatedGlobalStyle {
  let root: Root;
  try {
    root = postcss.parse(source, { from: undefined });
  } catch (error) {
    throw new Error(`global style could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const warnings = root.toResult().warnings();
  if (warnings.length) throw new Error(`global style parser warning: ${warnings[0]!.text}`);
  const assets = new Set<string>();
  walkNodes(root, assets, namespace ? namespaceMatcher(namespace) : undefined);
  return Object.freeze({ css: root.toString(), assets: Object.freeze([...assets]) });
}

export function rewriteGlobalStyleUrls(
  source: string,
  resolveAsset: (relativePath: string) => string,
): string {
  const validated = validateGlobalStyle(source);
  const root = postcss.parse(validated.css, { from: undefined });
  root.walkDecls((declaration) => {
    declaration.value = rewriteCssValue(declaration.value, resolveAsset);
  });
  root.walkAtRules((rule) => {
    if (rule.params) rule.params = rewriteCssValue(rule.params, resolveAsset);
  });
  return root.toString();
}

export function scopePackageStyle(source: string, owner: string): string {
  if (!owner.trim() || /["\\\r\n]/.test(owner)) throw new Error("scoped style owner is invalid");
  const validated = validateGlobalStyle(source);
  const root = postcss.parse(validated.css, { from: undefined });
  const scope = `[data-view-module-owner="${owner}"]`;
  root.walkRules(rule => {
    const parentName = rule.parent?.type === "atrule" ? rule.parent.name.toLowerCase() : "";
    if (parentName === "keyframes" || parentName === "-webkit-keyframes") return;
    if (rule.selector.includes(",")) throw new Error("scoped style selectors must not contain an ambiguous comma list");
    rule.selector = rule.selector.includes(":root")
      ? rule.selector.replaceAll(":root", scope)
      : `${scope} ${rule.selector}`;
  });
  return root.toString();
}

function walkNodes(root: Root, assets: Set<string>, namespace?: RegExp): void {
  root.walk((node) => {
    if (!isKnownNode(node)) throw new Error(`global style contains an unsupported AST node: ${node.type}`);
    if (node.type === "atrule") validateAtRule(node, assets);
    if (node.type === "rule") validateRule(node);
    if (node.type === "decl") validateDeclaration(node, assets, namespace);
  });
}

function validateAtRule(rule: AtRule, assets: Set<string>): void {
  const name = rule.name.toLowerCase();
  if (name === "import") throw new Error("global style must not use @import");
  if (!allowedAtRules.has(name)) throw new Error(`global style uses unsupported @${rule.name}`);
  collectAssets(rule.params, assets);
}

function validateRule(rule: Rule): void {
  const selector = stripCssComments(rule.selector).toLowerCase();
  if (!selector.trim()) throw new Error("global style contains an empty selector");
  if (forbiddenSelectorFragments.some(fragment => selector.includes(fragment))) {
    throw new Error(`global style targets a Host-private selector: ${rule.selector}`);
  }
}

function validateDeclaration(declaration: Declaration, assets: Set<string>, namespace?: RegExp): void {
  if (declaration.important) throw new Error("global style must not use !important");
  if (declaration.prop.toLowerCase().startsWith("--mem-view-")) {
    throw new Error(`global style must not declare public Theme token ${declaration.prop}`);
  }
  if (namespace && declaration.prop.startsWith("--") && !namespace.test(declaration.prop)) {
    throw new Error(`style custom property is outside its declared namespace: ${declaration.prop}`);
  }
  collectAssets(declaration.value, assets);
}

function namespaceMatcher(namespace: string): RegExp {
  if (!/^--[a-z0-9-]+(?:\*)?$/i.test(namespace) || namespace.indexOf("*") !== namespace.length - 1) {
    throw new Error(`style namespace must be a custom-property prefix ending in *: ${namespace}`);
  }
  const escaped = namespace.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}[a-z0-9-]+$`, "i");
}

function collectAssets(value: string, assets: Set<string>): void {
  for (const asset of cssUrls(value)) {
    if (!isSafeRelativeAsset(asset)) throw new Error(`global style asset URL is not package-relative: ${asset}`);
    assets.add(asset);
  }
  if (/\b(?:url|(?:-webkit-)?image-set)\s*\(/i.test(value) && !balancedFunctions(value)) {
    throw new Error("global style contains an ambiguous resource function");
  }
  if (/\bexpression\s*\(/i.test(value)) throw new Error("global style contains dynamic CSS expression()");
}

function cssUrls(value: string): string[] {
  const urls: string[] = [];
  const pattern = /\burl\s*\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)'"\s][^)]*?))\s*\)/gi;
  for (const match of value.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const decoded = raw.replace(/\\([\\"'])/g, "$1").trim();
    if (!decoded) throw new Error("global style contains an empty url()");
    urls.push(decoded);
  }
  return urls;
}

function rewriteCssValue(value: string, resolveAsset: (relativePath: string) => string): string {
  return value.replace(
    /\burl\s*\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)'"\s][^)]*?))\s*\)/gi,
    (_match, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
      const raw = (doubleQuoted ?? singleQuoted ?? bare ?? "").replace(/\\([\\"'])/g, "$1").trim();
      return `url("${escapeCssString(resolveAsset(raw))}")`;
    }
  );
}

function isSafeRelativeAsset(value: string): boolean {
  if (!value || value.includes("\0") || value.includes("\\")) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(value)) return false;
  const path = value.split(/[?#]/, 1)[0]!;
  const segments = path.replace(/^\.\//, "").split("/");
  return segments.every(segment => Boolean(segment) && segment !== "." && segment !== "..");
}

function balancedFunctions(value: string): boolean {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && !quote && !escaped;
}

function isKnownNode(node: ChildNode): boolean {
  return node.type === "rule" || node.type === "decl" || node.type === "atrule" || node.type === "comment";
}

function stripCssComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "");
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\f]/g, "");
}
