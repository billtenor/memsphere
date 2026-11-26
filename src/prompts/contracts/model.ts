import { bool, content, list, text, yes } from "./types.js";
import { publicModelListEntryItem, publicModelReadRegistration, publicModelValidateChecks, publicModelValidateDataItem } from "./fields.js";
import { receipt } from "./types.js";

export const modelContracts = {
  "model list": [
    receipt("cli-model-list-1", "成功", {
      items: list(publicModelListEntryItem),
      project: text.optional(),
      nextCursor: text.optional(),
    }),
  ],
  "model read": [
    receipt("cli-model-read-1", "--part definition（默认）", {
      modelRef: text,
      definition: content,
      project: text.optional(),
    }),
    receipt("cli-model-read-2", "--part registration", {
      modelRef: text,
      registration: publicModelReadRegistration,
      origin: text.optional(),
      project: text.optional(),
    }),
    receipt("cli-model-read-3", "--part all", {
      modelRef: text,
      registration: publicModelReadRegistration,
      definition: content,
      origin: text.optional(),
      project: text.optional(),
    }),
  ],
  "model create": [
    receipt("cli-model-create-1", "已执行", {
      operation: text,
      modelRef: text,
      project: text.optional(),
      registration: publicModelReadRegistration.optional(),
    }),
    receipt("cli-model-create-2", "预演", {
      operation: text,
      modelRef: text,
      dryRun: yes,
      project: text.optional(),
      registration: publicModelReadRegistration.optional(),
    }),
  ],
  "model update": [
    receipt("cli-model-update-1", "已执行", {
      operation: text,
      modelRef: text,
      project: text.optional(),
      registration: publicModelReadRegistration.optional(),
    }),
    receipt("cli-model-update-2", "预演", {
      operation: text,
      modelRef: text,
      dryRun: yes,
      project: text.optional(),
      registration: publicModelReadRegistration.optional(),
    }),
  ],
  "model delete": [
    receipt("cli-model-delete-1", "已执行", {
      operation: text,
      modelRef: text,
      project: text.optional(),
    }),
    receipt("cli-model-delete-2", "预演", {
      operation: text,
      modelRef: text,
      dryRun: yes,
      project: text.optional(),
    }),
  ],
  "model validate": [
    receipt("cli-model-validate-1", "定义或运行时校验", {
      operation: text,
      modelRef: text,
      valid: bool,
      checks: publicModelValidateChecks,
      project: text.optional(),
    }),
    receipt("cli-model-validate-2", "--check-data", {
      operation: text,
      modelRef: text,
      valid: bool,
      checks: publicModelValidateChecks,
      data: list(publicModelValidateDataItem),
      project: text.optional(),
    }),
  ],
};
