import { action, bool, integer, literal } from "./types.js";
import { publicDaemonStartTasks, publicDaemonStartView } from "./fields.js";
import { receipt } from "./types.js";

export const daemonContracts = {
  "daemon start": [
    receipt("cli-daemon-start-1", "成功",
      { omitEmpty: ["tasks"], rule: "返回操作后的实际状态。View 运行才给 url；授权方式取枚举，首次配置只给设置键及 Human 动作。tasks 只有分类计数。" }, {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "daemon status": [
    receipt("cli-daemon-status-1", "成功",
      { omitEmpty: ["tasks"], rule: "返回操作后的实际状态。View 运行才给 url；授权方式取枚举，首次配置只给设置键及 Human 动作。tasks 只有分类计数。" }, {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "daemon stop": [
    receipt("cli-daemon-stop-1", "成功",
      { omitEmpty: ["tasks"], rule: "返回操作后的实际状态。View 运行才给 url；授权方式取枚举，首次配置只给设置键及 Human 动作。tasks 只有分类计数。" }, {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "daemon restart": [
    receipt("cli-daemon-restart-1", "成功",
      { omitEmpty: ["tasks"], rule: "返回操作后的实际状态。View 运行才给 url；授权方式取枚举，首次配置只给设置键及 Human 动作。tasks 只有分类计数。" }, {
      running: bool,
      view: publicDaemonStartView,
      tasks: publicDaemonStartTasks.optional(),
      taskErrorCount: integer.optional(),
      settingsConfigKey: literal("view.operator_token").optional(),
      nextAction: action.optional(),
    }),
  ],
  "daemon serve": [
    receipt("cli-daemon-serve-1", "后台专用",
      { rule: "业务调用方可见字段为空；进程使用所属日志或 IPC。" }, {

    }),
  ],
};
