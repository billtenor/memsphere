import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import Handlebars from "handlebars";
import { promptLocales, type PromptLocale } from "./locale.js";
import type { PromptInputMap, PromptTemplateId } from "./models.js";
import { listPromptTemplateIds, promptDefinition } from "./registry.js";

type RenderStage = "input" | "asset" | "compile" | "render";

export class PromptRenderError extends Error {
  constructor(
    readonly templateId: PromptTemplateId,
    readonly locale: PromptLocale,
    readonly stage: RenderStage,
    cause: unknown
  ) {
    super(
      `Prompt render failed: template=${templateId}; locale=${locale}; stage=${stage}; `
      + `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }
}

const templateRoot = fileURLToPath(new URL("./templates", import.meta.url));
export interface PromptAssets {
  read(locale: PromptLocale, path: string): string;
  partials(locale: PromptLocale): Array<{ name: string; source: string }>;
}

/** Each renderer owns its template cache and reads assets through one boundary. */
export function createPromptRenderer(assets: PromptAssets) {
  const engines = new Map<PromptLocale, typeof Handlebars>();
  const compiled = new Map<string, Handlebars.TemplateDelegate>();

  function renderPrompt<K extends PromptTemplateId>(
    id: K,
    locale: PromptLocale,
    input: PromptInputMap[K]
  ): string {
    const definition = promptDefinition(id);
    let parsed: PromptInputMap[K];
    try {
      parsed = definition.schema.parse(input);
    } catch (error) {
      throw new PromptRenderError(id, locale, "input", error);
    }

    const key = `${locale}:${id}`;
    let template = compiled.get(key);
    if (!template) {
      const engine = engineFor(locale);
      let source: string;
      try {
        source = assets.read(locale, definition.path);
      } catch (error) {
        throw new PromptRenderError(id, locale, "asset", error);
      }
      try {
        template = engine.compile(source, {
          strict: true,
          noEscape: true,
          preventIndent: true
        });
        compiled.set(key, template);
      } catch (error) {
        throw new PromptRenderError(id, locale, "compile", error);
      }
    }

    try {
      return template(parsed).replace(/\s+$/, "");
    } catch (error) {
      throw new PromptRenderError(id, locale, "render", error);
    }
  }

  function validatePromptAssets(): void {
    for (const locale of promptLocales) {
      engineFor(locale);
      for (const id of listPromptTemplateIds()) {
        const definition = promptDefinition(id);
        try {
          assets.read(locale, definition.path);
        } catch (error) {
          throw new PromptRenderError(id, locale, "asset", error);
        }
      }
    }
  }

  function engineFor(locale: PromptLocale): typeof Handlebars {
    const cached = engines.get(locale);
    if (cached) return cached;
    const engine = Handlebars.create() as typeof Handlebars;
    engine.registerHelper("unlessNil", function (
      this: unknown,
      value: unknown,
      options: Handlebars.HelperOptions
    ) {
      return value === undefined || value === null ? options.inverse(this) : options.fn(this);
    });
    engine.registerHelper(
      "ifDecision",
      function (
        this: unknown,
        decision: { kind?: string } | undefined,
        kind: string,
        options: Handlebars.HelperOptions
      ) {
        return decision?.kind === kind ? options.fn(this) : options.inverse(this);
      }
    );
    engine.registerHelper("ifOne", function (
      this: unknown,
      value: number,
      options: Handlebars.HelperOptions
    ) {
      return value === 1 ? options.fn(this) : options.inverse(this);
    });
    engine.registerHelper("unlessOne", function (
      this: unknown,
      value: number,
      options: Handlebars.HelperOptions
    ) {
      return value === 1 ? options.inverse(this) : options.fn(this);
    });
    engine.registerHelper("ifEq", function (
      this: unknown,
      left: unknown,
      right: unknown,
      options: Handlebars.HelperOptions
    ) {
      return left === right ? options.fn(this) : options.inverse(this);
    });
    for (const partial of assets.partials(locale)) engine.registerPartial(partial.name, partial.source);
    engines.set(locale, engine);
    return engine;
  }

  return { renderPrompt, validatePromptAssets };
}

const defaultRenderer = createPromptRenderer({
  read: (locale, path) => readFileSync(join(templateRoot, locale, path), "utf8"),
  partials: locale => walkTemplates(join(templateRoot, locale)).flatMap(path => {
    const relativePath = relative(join(templateRoot, locale), path).split(sep).join("/");
    return relativePath.includes("/partials/")
      ? [{ name: relativePath.replace("/partials/", "/").replace(/\.hbs$/, ""), source: readFileSync(path, "utf8") }]
      : [];
  })
});
export const renderPrompt = defaultRenderer.renderPrompt;
export const validatePromptAssets = defaultRenderer.validatePromptAssets;

function walkTemplates(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walkTemplates(path));
    else if (entry.isFile() && entry.name.endsWith(".hbs")) paths.push(path);
  }
  return paths;
}
