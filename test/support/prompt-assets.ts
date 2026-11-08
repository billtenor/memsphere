import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promptLocales } from "../../src/prompts/locale.js";
import type { PromptAssets } from "../../src/prompts/renderer.js";

// Load immutable source text as test input before invoking the renderer. The
// subject under test can only read this map and cannot consult the filesystem.
export function promptAssetFixture(): PromptAssets {
  const sources = new Map<string, string>();
  const root = fileURLToPath(new URL("../../src/prompts/templates/", import.meta.url));
  function load(directory: string, prefix: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const key = `${prefix}/${entry.name}`, path = join(directory, entry.name);
      if (entry.isDirectory()) load(path, key);
      else if (entry.isFile() && entry.name.endsWith(".hbs")) sources.set(key, readFileSync(path, "utf8"));
    }
  }
  for (const locale of promptLocales) load(join(root, locale), locale);
  return {
    read(locale, path) {
      const source = sources.get(`${locale}/${path}`);
      if (source === undefined) throw new Error(`Missing fixture prompt: ${locale}/${path}`);
      return source;
    },
    partials: locale => [...sources].filter(([key]) => key.startsWith(`${locale}/`) && key.includes("/partials/"))
      .map(([key, source]) => ({ name: key.slice(locale.length + 1).replace("/partials/", "/").replace(/\.hbs$/, ""), source }))
  };
}
