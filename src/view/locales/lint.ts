export interface ViewLiteralViolation {
  line: number;
  sink: string;
  value: string;
}

const allowedStaticText = new Set(["memsphere"]);
const allowedDynamicText = new Set([
  "ID",
  "memsphere run report --run "
]);

function isNaturalLanguage(value: string): boolean {
  return /[A-Za-z]{2,}|[\u3400-\u9fff]/u.test(value);
}

function allowedDynamicLiteral(value: string): boolean {
  if (allowedDynamicText.has(value)) return true;
  if (!/^<[^>]+>/.test(value)) return false;
  const visibleText = value.replace(/<[^>]*>/g, "").replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, "");
  return !isNaturalLanguage(visibleText);
}

/**
 * Guards the embedded View template against fixed user-facing copy outside the
 * locale bundle or the Memory DSL vocabulary. The allowlist is deliberately
 * limited to the product brand, structural markup, and a copyable CLI command.
 */
export function findUnlocalizedViewLiterals(source: string): ViewLiteralViolation[] {
  const violations: ViewLiteralViolation[] = [];
  const normalizedSource = source.replace(/\r\n/g, "\n");
  const lines = normalizedSource.split("\n");
  let inStaticBody = false;
  let inScript = false;

  for (const [index, line] of lines.entries()) {
    if (line.includes("<body")) inStaticBody = true;
    if (inStaticBody && line.includes("<script>")) inScript = true;
    if (inStaticBody && !inScript) {
      for (const match of line.matchAll(/>([^<]+)</g)) {
        const value = match[1].replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, "").trim();
        if (isNaturalLanguage(value) && !allowedStaticText.has(value)) {
          violations.push({ line: index + 1, sink: "static HTML", value });
        }
      }
      for (const match of line.matchAll(/(?<![\w-])(aria-label|title|placeholder)="([^"]+)"/g)) {
        const value = match[2].trim();
        if (isNaturalLanguage(value)) {
          violations.push({ line: index + 1, sink: match[1], value });
        }
      }
    }
  }

  const lineAt = (offset: number): number => normalizedSource.slice(0, offset).split("\n").length;
  const sinkPattern = /(?:\.(textContent|innerHTML|title|placeholder)\s*=|\.(append)\(|\b(pill|blockTitle|taskSectionHeader|settingsReadOnly|settingsTextField|settingsTextArea|settingsSelectField)\(|\b(badges\.push)\(|\b(document\.createTextNode)\()\s*(["'`])([\s\S]*?)\6/g;
  const dynamicAttributePattern = /\.setAttribute\(\s*(["'`])(aria-label|title|placeholder)\1\s*,\s*(["'`])([\s\S]*?)\3/g;
  const dialogPattern = /\b(confirm|alert|prompt)\(\s*(["'`])([\s\S]*?)\2/g;

  for (const match of normalizedSource.matchAll(sinkPattern)) {
    const value = match[7];
    if (!isNaturalLanguage(value) || allowedDynamicLiteral(value)) continue;
    violations.push({
      line: lineAt(match.index),
      sink: match[1] || match[2] || match[3] || match[4] || match[5] || "DOM sink",
      value
    });
  }
  for (const match of normalizedSource.matchAll(dynamicAttributePattern)) {
    const value = match[4];
    if (isNaturalLanguage(value) && !allowedDynamicLiteral(value)) {
      violations.push({ line: lineAt(match.index), sink: match[2], value });
    }
  }
  for (const match of normalizedSource.matchAll(dialogPattern)) {
    const value = match[3];
    if (isNaturalLanguage(value) && !allowedDynamicLiteral(value)) {
      violations.push({ line: lineAt(match.index), sink: match[1], value });
    }
  }
  return violations;
}
