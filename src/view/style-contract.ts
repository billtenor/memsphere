export type ModuleStyleBoundaryOptions = Readonly<{
  scope?: string | readonly string[];
}>;

export function validateModuleStyleBoundary(
  source: string,
  label: string,
  options: ModuleStyleBoundaryOptions = {},
): void {
  const errors: string[] = [];
  const inspected = stripCssComments(source);
  if (/--mem-view-[\w-]+\s*:/.test(inspected)) errors.push("must not declare public --mem-view-* tokens");
  if (/var\(\s*--view-[\w-]+/.test(inspected)) errors.push("must not read Host-private --view-* tokens");
  if (/\.view-shell-[\w-]+|\[data-view-slot(?:=|\])/.test(inspected)) errors.push("must not depend on Host-private Shell selectors");
  if (/!important\b/.test(inspected)) errors.push("must not use !important to override the Host");

  if (options.scope) {
    const scopes = typeof options.scope === "string" ? [options.scope] : options.scope;
    const scopeLabel = scopes.join(" or ");
    if (hasUninspectableScopedStyles(source)) {
      errors.push("must keep scoped CSS in an inspectable style/css template literal");
    }
    for (const css of cssTemplateBodies(inspected)) {
      for (const line of css.split(/\r?\n/)) {
        const open = line.indexOf("{");
        if (open < 0) continue;
        const selectorGroup = line.slice(0, open).trim();
        if (!selectorGroup || selectorGroup.startsWith("@") || selectorGroup.endsWith("%")) continue;
        for (const selector of splitSelectorGroup(selectorGroup)) {
          if (!scopes.some(scope => selector.startsWith(scope))) errors.push(`must scope selector to ${scopeLabel}: ${selector}`);
        }
      }
    }
  }

  if (errors.length) throw new Error(`${label}: ${[...new Set(errors)].join("; ")}`);
}

function hasUninspectableScopedStyles(source: string): boolean {
  return /(?:styles?|css)\s*=\s*\[[\s\S]*?\]\s*\.join\s*\(/i.test(source)
    || /new\s+CSSStyleSheet\s*\(/i.test(source)
    || /\.replaceSync\s*\(/i.test(source)
    || /import\s+(?:(?:[^;]*?\s+from\s+|\()\s*)?["'][^"']+\.css\b/i.test(source);
}

export function validateShellThemeStyles(source: string, label = "View Shell"): void {
  const errors: string[] = [];
  const inspected = stripCssComments(source);
  if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|(?:^|[:;,\s])(?:red|blue|green|white|black|gray|grey)(?=\s*[;}])/i.test(inspected)) {
    errors.push("must consume Theme tokens instead of literal colors");
  }
  const privateVariables = [...inspected.matchAll(/--view-[a-z0-9-]+/gi)].map(match => match[0]);
  const allowed = new Set(["--view-rail-width", "--view-secondary-width", "--view-list-width"]);
  const forbidden = [...new Set(privateVariables.filter(variable => !allowed.has(variable)))];
  if (forbidden.length) errors.push(`must not expose private visual variables: ${forbidden.join(", ")}`);
  if ([...inspected.matchAll(/font-size\s*:\s*([^;}]+)/gi)].some(match => !isThemeValue(match[1] ?? ""))) {
    errors.push("must use Theme font-size tokens");
  }
  if ([...inspected.matchAll(/border-radius\s*:\s*([^;}]+)/gi)].some(match => {
    const value = (match[1] ?? "").trim();
    return !isThemeValue(value) && value !== "0" && value !== "50%";
  })) errors.push("must use Theme radius tokens");
  if (errors.length) throw new Error(`${label}: ${errors.join("; ")}`);
}

function cssTemplateBodies(source: string): readonly string[] {
  return [...source.matchAll(/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*`([\s\S]*?)`/g)]
    .map(match => match[1] ?? "")
    .filter(value => value.includes("{") && value.includes("}"));
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function isThemeValue(value: string): boolean {
  return /^var\(\s*--mem-view-[\w-]+\s*\)$/i.test(value.trim());
}

function splitSelectorGroup(value: string): readonly string[] {
  const selectors: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth = Math.max(0, depth - 1);
    else if (value[index] === "," && depth === 0) {
      const selector = value.slice(start, index).trim();
      if (selector) selectors.push(selector);
      start = index + 1;
    }
  }
  const selector = value.slice(start).trim();
  if (selector) selectors.push(selector);
  return selectors;
}
