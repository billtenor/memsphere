import { action, bool, integer, list, text } from "./types.js";
import { publicAppCheckEntryItem, publicAppListAppsItem, publicAppShowProjectstoresItem, publicAppShowUsage } from "./fields.js";
import { receipt } from "./types.js";

export const appContracts = {
  "app install": [
    receipt("cli-app-install-1", "成功",
      { rule: "选择、安装所需身份/状态及后继；pendingCount 为总数。" }, {
      id: text,
      status: text,
      enabled: bool,
      version: text.optional(),
      nextAction: action.optional(),
    }),
  ],
  "app list": [
    receipt("cli-app-list-1", "成功",
      { omitZero: ["pendingCount"], rule: "选择、安装所需身份/状态及后继；pendingCount 为总数。" }, {
      apps: list(publicAppListAppsItem),
      pendingCount: integer,
      nextCursor: text.optional(),
    }),
  ],
  "app show": [
    receipt("cli-app-show-1", "成功",
      { omitFalse: ["descriptionTruncated"], omitEmpty: ["projectStores"], rule: "configuration 只允许配置定义的公开引用，projectStores 只给声明的绑定，缺绑定为 null。禁止 app.config 内容。" }, {
      id: text,
      name: text,
      version: text,
      enabled: bool,
      revision: text,
      usage: publicAppShowUsage,
      projectStores: list(publicAppShowProjectstoresItem),
      viewChangesRequireRestart: bool,
      configuration: text.optional(),
      description: text.optional(),
      descriptionTruncated: bool.optional(),
    }),
  ],
  "app configure": [
    receipt("cli-app-configure-1", "成功",
      { omitFalse: ["restartRequired"], rule: "配置写入只给状态、revision、是否重启及其动作。" }, {
      id: text,
      status: text,
      revision: text,
      restartRequired: bool,
      nextAction: action.optional(),
    }),
  ],
  "app enable": [
    receipt("cli-app-enable-1", "成功",
      { omitFalse: ["restartRequired"], rule: "enabled 表达实际状态；需重启时给动作。" }, {
      id: text,
      enabled: bool,
      restartRequired: bool,
      nextAction: action.optional(),
    }),
  ],
  "app disable": [
    receipt("cli-app-disable-1", "成功",
      { omitFalse: ["restartRequired"], rule: "enabled 表达实际状态；需重启时给动作。" }, {
      id: text,
      enabled: bool,
      restartRequired: bool,
      nextAction: action.optional(),
    }),
  ],
  "app check": [
    receipt("cli-app-check-1", "成功",
      { counts: { total: "items" }, rule: "每项只给 name/status，total 表示全部检查项；禁止原始探测响应。" }, {
      id: text,
      status: text,
      items: list(publicAppCheckEntryItem),
      total: integer,
      app: text.optional(),
    }),
  ],
};
