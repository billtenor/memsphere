import { buildSchemaOverviewPromptModel, renderRunOutput, renderPrompt, resolvePromptLocale, type PromptLocale } from "../../src/prompts/index.js";
import type { SchemaWritingSnapshot } from "../../src/run/store.js";

export function printRunOutput(scene: Parameters<typeof renderRunOutput>[0]): void {
  console.log(renderRunOutput(scene, resolvePromptLocale(scene.run.language)));
}

export function printSchemaWritingOverview(
  snapshot: SchemaWritingSnapshot,
  locale: PromptLocale = "en"
): void {
  console.log(renderPrompt(
    "run.schema-overview",
    locale,
    buildSchemaOverviewPromptModel(snapshot, locale)
  ));
}
