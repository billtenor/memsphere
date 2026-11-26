import { integer, list, text } from "./types.js";
import { publicAppCheckEntryItem, publicCliListEntryItem } from "./fields.js";
import { receipt } from "./types.js";

export const cliContracts = {
  "cli register": [
    receipt("cli-cli-register-1", "登记完成", {
      id: text,
      status: text,
    }),
  ],
  "cli bind": [
    receipt("cli-cli-bind-1", "成功", {
      id: text,
      project: text,
      status: text,
      app: text.optional(),
    }),
  ],
  "cli list": [
    receipt("cli-cli-list-1", "成功", {
      items: list(publicCliListEntryItem),
      nextCursor: text.optional(),
    }),
  ],
  "cli show": [
    receipt("cli-cli-show-1", "登记详情", {
      id: text,
      status: text,
      apps: list(text),
      project: text,
      app: text.optional(),
    }),
  ],
  "cli check": [
    receipt("cli-cli-check-1", "成功", {
      id: text,
      status: text,
      items: list(publicAppCheckEntryItem),
      total: integer,
      app: text.optional(),
    }),
  ],
};
