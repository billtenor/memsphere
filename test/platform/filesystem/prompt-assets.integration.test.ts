import assert from "node:assert/strict";
import test from "node:test";
import { renderPrompt, validatePromptAssets } from "../../../src/prompts/renderer.js";

test("filesystem prompt adapter loads all bundled templates and locale partials", () => {
  validatePromptAssets();
  for (const locale of ["en", "zh-CN"] as const) {
    const rendered = renderPrompt("run.review-configuration-required", locale, { preflightJson: "{}" });
    assert.match(rendered, /run start <procedure> --name <run-name> --review-config <path>/);
    assert.doesNotMatch(rendered, /{{/);
  }
});
