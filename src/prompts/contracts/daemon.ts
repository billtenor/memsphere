import { action, bool, integer, literal } from "./types.js";
import { publicDaemonStartTasks, publicDaemonStartView } from "./fields.js";
import { receipt } from "./types.js";

export const daemonContracts = {
  "daemon start": [
    receipt("cli-daemon-start-1", "成功", {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "daemon status": [
    receipt("cli-daemon-status-1", "成功", {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "daemon stop": [
    receipt("cli-daemon-stop-1", "成功", {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "daemon restart": [
    receipt("cli-daemon-restart-1", "成功", {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "daemon serve": [
    receipt("cli-daemon-serve-1", "后台专用", {

    }),
  ],
};
