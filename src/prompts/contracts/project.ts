import { action, bool, integer, list, oneOf, text } from "./types.js";
import { publicProjectListEntryItem, publicProjectModelsInitializeContextcontrol, publicProjectModelsInitializeSystem, publicProjectShowHealth, publicProjectUpgradeFailure, publicProjectUpgradeMemory, publicProjectUpgradeModels, projectedUpgradeModels, projectListItem } from "./fields.js";
import { receipt } from "./types.js";

function upgradePhase(phase: Record<string, unknown>): Record<string, unknown> {
  const result = { ...phase };
  for (const key of ["created", "updated", "deleted", "retained"]) {
    if (result[key] === 0) delete result[key];
  }
  return result;
}

export const projectContracts = {
  "project models initialize": [
    receipt("cli-project-models-initialize-1", "成功",
      { omitZero: ["diagnosticCount"], rule: "只给对象、计数与相应 revision/处理状态；诊断以登记字段表现。" }, {
      project: text,
      created: integer,
      retained: integer,
      diagnosticCount: integer,
      system: publicProjectModelsInitializeSystem,
      contextControl: publicProjectModelsInitializeContextcontrol.optional(),
    }),
  ],
  "project create": [
    receipt("cli-project-create-1", "成功",
      { rule: "root 是登记的项目位置，bound 表示实际绑定；详情可按返回动作查询。" }, {
      project: text,
      root: text,
      storeType: oneOf("managed", "embedded"),
      bound: bool,
      nextAction: action.optional(),
    }),
  ],
  "project clone": [
    receipt("cli-project-clone-1", "成功",
      { rule: "root 是登记的项目位置，bound 表示实际绑定；详情可按返回动作查询。" }, {
      project: text,
      root: text,
      storeType: oneOf("managed", "embedded"),
      bound: bool,
      nextAction: action.optional(),
    }),
  ],
  "project register": [
    receipt("cli-project-register-1", "成功",
      { rule: "root 是登记的项目位置，bound 表示实际绑定；详情可按返回动作查询。" }, {
      project: text,
      root: text,
      storeType: oneOf("managed", "embedded"),
      bound: bool,
      nextAction: action.optional(),
    }),
  ],
  "project list": [
    receipt("cli-project-list-1", "成功",
      { items: { items: { schema: projectListItem, select(row) {
        const { missing, ...rest } = row;
        return missing === false ? rest : row;
      } } }, rule: "根路径用于识别登记对象；show 区分规范/有效 Memory Root。禁止 Home 注册表与其他工作区绑定。" }, {
      items: list(publicProjectListEntryItem),
      nextCursor: text.optional(),
    }),
  ],
  "project show": [
    receipt("cli-project-show-1", "成功",
      { rule: "根路径用于识别登记对象；show 区分规范/有效 Memory Root。禁止 Home 注册表与其他工作区绑定。" }, {
      name: text,
      root: text,
      storeType: oneOf("managed", "embedded"),
      canonicalMemoryRoot: text,
      health: publicProjectShowHealth,
      effectiveMemoryRoot: text.optional(),
      branch: text.optional(),
      revision: text.optional(),
    }),
  ],
  "project upgrade": [
    receipt("cli-project-upgrade-1", "成功",
      { rule: "各阶段保留状态、非零计数及 system 范围；失败给 stage/code 和恢复动作。", nested: {
        models: { schema: projectedUpgradeModels, select: phase => ({ ...upgradePhase(phase),
          ...(phase.system ? { system: upgradePhase(phase.system as Record<string, unknown>) } : {}) }) },
        memory: { schema: publicProjectUpgradeMemory, select: upgradePhase }
      } }, {
      cliVersion: text,
      overall: oneOf("upgraded", "unchanged", "failed", "not_run"),
      models: publicProjectUpgradeModels,
      memory: publicProjectUpgradeMemory,
      validation: oneOf("not_run", "passed", "failed"),
      project: text.optional(),
      storeType: oneOf("managed", "embedded").optional(),
      failure: publicProjectUpgradeFailure.optional(),
      nextAction: action.optional(),
    }),
  ],
  "project repair": [
    receipt("cli-project-repair-1", "成功",
      { rule: "只给对象、计数与相应 revision/处理状态；诊断以登记字段表现。" }, {
      project: text,
      storeType: oneOf("managed", "embedded"),
      created: integer,
      updated: integer,
      deleted: integer,
      revision: text.optional(),
      worktree: text.optional(),
      nextAction: action.optional(),
    }),
  ],
  "project bind": [
    receipt("cli-project-bind-1", "关系已更新",
      { rule: "只给 project、relation。" }, {
      project: text,
      relation: oneOf("primary", "mounted", "unbound"),
    }),
  ],
  "project unbind": [
    receipt("cli-project-unbind-1", "关系已更新",
      { rule: "只给 project、relation。" }, {
      project: text,
      relation: oneOf("primary", "mounted", "unbound"),
    }),
  ],
  "project mount": [
    receipt("cli-project-mount-1", "关系已更新",
      { rule: "只给 project、relation。" }, {
      project: text,
      relation: oneOf("primary", "mounted", "unbound"),
    }),
  ],
  "project unmount": [
    receipt("cli-project-unmount-1", "关系已更新",
      { rule: "只给 project、relation。" }, {
      project: text,
      relation: oneOf("primary", "mounted", "unbound"),
    }),
  ],
  "project prune": [
    receipt("cli-project-prune-1", "成功",
      { rule: "只给清理的登记条数。" }, {
      removedCount: integer,
    }),
  ],
};
