import { currentMemorySyntax } from "../../src/memory/syntax.js";

export function withCurrentMemorySyntax(source: string): string {
  const firstNewline = source.indexOf("\n");
  if (firstNewline < 0 || !source.startsWith("!")) {
    throw new Error("Memory fixture must start with a root YAML tag");
  }
  if (/^syntax:/m.test(source)) {
    throw new Error("Memory fixture already declares syntax");
  }
  return `${source.slice(0, firstNewline + 1)}syntax: ${currentMemorySyntax}\n${source.slice(firstNewline + 1)}`;
}
