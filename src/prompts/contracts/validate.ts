import { action, bool, integer, list, literal, oneOf } from "./types.js";
import { publicValidateIssuesItem } from "./fields.js";
import { receipt } from "./types.js";

export const validateContracts = {
  "validate": [
    receipt("cli-validate-1", "成功",
      { rule: "memory-root 和 project-store 明示范围；问题只给稳定 code、相对位置及行列。" }, {
      valid: bool,
      validationScope: oneOf("memory-root", "project-store"),
      changeSetEffect: literal("none"),
      issueCount: integer,
      issues: list(publicValidateIssuesItem, 10),
      nextAction: action.optional(),
    }),
  ],
};
