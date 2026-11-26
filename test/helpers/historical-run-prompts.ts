import { buildSchemaOverviewPromptModel, renderRunOutput, renderPrompt, resolvePromptLocale, type PromptLocale } from "../../src/prompts/index.js";
import type { SchemaWritingSnapshot } from "../../src/run/store.js";

export function printRunBindingOutput(
  value: unknown,
  output: "json" | "text" | undefined,
  mode: "show" | "update"
): void {
  if ((output ?? "text") === "text") {
    console.log(mode === "update"
      ? "Binding saved. Current and historical rounds stay unchanged; the new binding applies to the next round or future Reviews."
      : "Current and historical rounds are frozen; displayed next bindings apply only when a new round or future Review is created.");
  }
  printStructured(value, output);
}

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

function printStructured(value: unknown, output: "json" | "text" | undefined): void {
  if ((output ?? "text") === "json") {
    console.log(JSON.stringify(value));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}
