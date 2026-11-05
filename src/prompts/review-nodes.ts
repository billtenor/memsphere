import { renderPrompt } from "./renderer.js";
import type { PromptLocale } from "./locale.js";
import type { ReviewNodePromptModel, ReviewNodePromptId } from "./models.js";

export function reviewNodePromptModel(value: unknown, rolePrompts: string[] = [], materials = "", permissions: ReviewNodePromptModel["permissions"] = []): ReviewNodePromptModel {
  const view = value as { node?: { kind?: string }; operation?: string };
  return { data: JSON.stringify(value, null, 2), open: view.node?.kind === "open_review", hasNode: Boolean(view.node), rolePrompts, materials, permissions };
}
export function renderReviewNodeOutput(operation: string, value: unknown, locale: PromptLocale) {
  const view = value as { node?: unknown };
  const name = operation === "submit" ? "submit-receipt" : operation === "list" ? "list" : operation === "show-all" || operation === "show" && "nodes" in view && !("comments" in view) ? "results" : ["show", "report"].includes(operation) ? view.node ? "node" : "summary" : "edit-receipt";
  return renderPrompt(`acp.review-v3.${name}` as ReviewNodePromptId, locale, reviewNodePromptModel(value));
}
