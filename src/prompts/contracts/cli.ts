import { integer, list, text } from "./types.js";
import { publicAppCheckEntryItem, publicCliListEntryItem } from "./fields.js";
import { receipt } from "./types.js";

export const cliContracts = {
  "cli register": [
    receipt("cli-cli-register-1", "登记完成",
      { rule: "按实际作用域给登记、绑定状态。register 只需 id/status。" }, {
      id: text,
      status: text,
    }),
  ],
  "cli bind": [
    receipt("cli-cli-bind-1", "成功",
      { rule: "指定 App 才给 app。" }, {
      id: text,
      project: text,
      status: text,
      app: text.optional(),
    }),
  ],
  "cli list": [
    receipt("cli-cli-list-1", "成功",
      { rule: "按实际作用域给登记、绑定状态。register 只需 id/status。" }, {
      items: list(publicCliListEntryItem),
      nextCursor: text.optional(),
    }),
  ],
  "cli show": [
    receipt("cli-cli-show-1", "登记详情",
      { omitEmpty: ["apps"], rule: "收紧现有 cliDetail。显示可调用的登记及应用关系；任意 executable/args/cwd 可能带环境或凭据，普通查询不返回启动配置。", omit: ["invocation", "executable", "args", "cwd", "env", "envFrom"] }, {
      id: text,
      status: text,
      apps: list(text),
      project: text,
      app: text.optional(),
    }),
  ],
  "cli check": [
    receipt("cli-cli-check-1", "成功",
      { counts: { total: "items" }, rule: "每项只给 name/status，total 表示全部检查项；禁止原始探测响应。" }, {
      id: text,
      status: text,
      items: list(publicAppCheckEntryItem),
      total: integer,
      app: text.optional(),
    }),
  ],
};
