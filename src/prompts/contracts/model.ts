import { bool, content, list, text, yes } from "./types.js";
import { publicModelListEntryItem, publicModelReadRegistration, publicModelValidateChecks, publicModelValidateDataItem } from "./fields.js";
import { receipt } from "./types.js";

export const modelContracts = {
  "model list": [
    receipt("cli-model-list-1", "成功",
      { rule: "只给模型标识、可发现名称、来源、可用状态与稳定错误码。" }, {
      items: list(publicModelListEntryItem),
      project: text.optional(),
      nextCursor: text.optional(),
    }),
  ],
  "model read": [
    receipt("cli-model-read-1", "--part definition（默认）",
      { rule: "只给所选部分。" }, {
      modelRef: text,
      definition: content,
      project: text.optional(),
    }),
    receipt("cli-model-read-2", "--part registration",
      { rule: "只给所选部分。" }, {
      modelRef: text,
      registration: publicModelReadRegistration,
      origin: text.optional(),
      project: text.optional(),
    }),
    receipt("cli-model-read-3", "--part all",
      { rule: "只给所选部分。" }, {
      modelRef: text,
      registration: publicModelReadRegistration,
      definition: content,
      origin: text.optional(),
      project: text.optional(),
    }),
  ],
  "model create": [
    receipt("cli-model-create-1", "已执行",
      { rule: "registration 仅在写入产生公开登记时返回。", omit: ["definition"] }, {
      operation: text,
      modelRef: text,
      project: text.optional(),
      registration: publicModelReadRegistration.optional(),
    }),
    receipt("cli-model-create-2", "预演",
      { rule: "registration 仅在写入产生公开登记时返回。", omit: ["definition"] }, {
      operation: text,
      modelRef: text,
      dryRun: yes,
      project: text.optional(),
      registration: publicModelReadRegistration.optional(),
    }),
  ],
  "model update": [
    receipt("cli-model-update-1", "已执行",
      { rule: "registration 仅在写入产生公开登记时返回。", omit: ["definition"] }, {
      operation: text,
      modelRef: text,
      project: text.optional(),
      registration: publicModelReadRegistration.optional(),
    }),
    receipt("cli-model-update-2", "预演",
      { rule: "registration 仅在写入产生公开登记时返回。", omit: ["definition"] }, {
      operation: text,
      modelRef: text,
      dryRun: yes,
      project: text.optional(),
      registration: publicModelReadRegistration.optional(),
    }),
  ],
  "model delete": [
    receipt("cli-model-delete-1", "已执行",
      { rule: "registration 仅在写入产生公开登记时返回。", omit: ["definition"] }, {
      operation: text,
      modelRef: text,
      project: text.optional(),
    }),
    receipt("cli-model-delete-2", "预演",
      { rule: "registration 仅在写入产生公开登记时返回。", omit: ["definition"] }, {
      operation: text,
      modelRef: text,
      dryRun: yes,
      project: text.optional(),
    }),
  ],
  "model validate": [
    receipt("cli-model-validate-1", "定义或运行时校验",
      { rule: "data 只在 --check-data 时按授权 Store 给出计数。", omit: ["data"] }, {
      operation: text,
      modelRef: text,
      valid: bool,
      checks: publicModelValidateChecks,
      project: text.optional(),
    }),
    receipt("cli-model-validate-2", "--check-data",
      { rule: "data 只在 --check-data 时按授权 Store 给出计数。" }, {
      operation: text,
      modelRef: text,
      valid: bool,
      checks: publicModelValidateChecks,
      data: list(publicModelValidateDataItem),
      project: text.optional(),
    }),
  ],
};
