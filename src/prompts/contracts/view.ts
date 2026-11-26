import { action, bool, integer, literal } from "./types.js";
import { publicDaemonStartTasks, publicDaemonStartView } from "./fields.js";
import { receipt } from "./types.js";

export const viewContracts = {
  "view start": [
    receipt("cli-view-start-1", "成功", {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "view stop": [
    receipt("cli-view-stop-1", "成功", {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "view restart": [
    receipt("cli-view-restart-1", "成功", {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "view status": [
    receipt("cli-view-status-1", "成功", {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "view serve": [
    receipt("cli-view-serve-1", "后台专用", {

    }),
  ],
};
