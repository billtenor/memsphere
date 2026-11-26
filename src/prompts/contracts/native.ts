import { bool, list, text } from "./types.js";
import { receipt } from "./types.js";

export const nativeContracts = {
  "continue": [
    receipt("cli-continue-1", "上下文帮助", {
      project: text,
      runId: text,
      status: text,
      available: bool,
      commands: list(text),
      stepId: text.optional(),
      reviewId: text.optional(),
      usage: text.optional(),
    }),
  ],
};
