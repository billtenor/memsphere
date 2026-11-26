import { action, bool, integer, list, literal, oneOf } from "./types.js";
import { publicValidateIssuesItem } from "./fields.js";
import { receipt } from "./types.js";

export const validateContracts = {
  "validate": [
    receipt("cli-validate-1", "成功", {
      valid: bool,
      validationScope: oneOf("memory-root", "project-store"),
      changeSetEffect: literal("none"),
      issueCount: integer,
      issues: list(publicValidateIssuesItem, 10),
      nextAction: action.optional(),
    }),
  ],
};
