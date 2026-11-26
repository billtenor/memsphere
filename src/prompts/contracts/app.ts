import { action, bool, integer, list, text } from "./types.js";
import { publicAppCheckEntryItem, publicAppListAppsItem, publicAppShowProjectstoresItem, publicAppShowUsage } from "./fields.js";
import { receipt } from "./types.js";

export const appContracts = {
  "app install": [
    receipt("cli-app-install-1", "成功", {
      id: text,
      status: text,
      enabled: bool,
      version: text.optional(),
      nextAction: action.optional(),
    }),
  ],
  "app list": [
    receipt("cli-app-list-1", "成功", {
      apps: list(publicAppListAppsItem),
      pendingCount: integer,
      nextCursor: text.optional(),
    }),
  ],
  "app show": [
    receipt("cli-app-show-1", "成功", {
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
    receipt("cli-app-configure-1", "成功", {
      id: text,
      status: text,
      revision: text,
      restartRequired: bool,
      nextAction: action.optional(),
    }),
  ],
  "app enable": [
    receipt("cli-app-enable-1", "成功", {
      id: text,
      enabled: bool,
      restartRequired: bool,
      nextAction: action.optional(),
    }),
  ],
  "app disable": [
    receipt("cli-app-disable-1", "成功", {
      id: text,
      enabled: bool,
      restartRequired: bool,
      nextAction: action.optional(),
    }),
  ],
  "app check": [
    receipt("cli-app-check-1", "成功", {
      id: text,
      status: text,
      items: list(publicAppCheckEntryItem),
      total: integer,
      app: text.optional(),
    }),
  ],
};
