import { action, bool, integer, list, oneOf, text } from "./types.js";
import { publicProjectListEntryItem, publicProjectModelsInitializeContextcontrol, publicProjectModelsInitializeSystem, publicProjectShowHealth, publicProjectUpgradeFailure, publicProjectUpgradeMemory, publicProjectUpgradeModels } from "./fields.js";
import { receipt } from "./types.js";

export const projectContracts = {
  "project models initialize": [
    receipt("cli-project-models-initialize-1", "成功", {
      project: text,
      created: integer,
      retained: integer,
      diagnosticCount: integer,
      system: publicProjectModelsInitializeSystem,
      contextControl: publicProjectModelsInitializeContextcontrol.optional(),
    }),
  ],
  "project create": [
    receipt("cli-project-create-1", "成功", {
      project: text,
      root: text,
      storeType: oneOf("managed", "embedded"),
      bound: bool,
      nextAction: action.optional(),
    }),
  ],
  "project clone": [
    receipt("cli-project-clone-1", "成功", {
      project: text,
      root: text,
      storeType: oneOf("managed", "embedded"),
      bound: bool,
      nextAction: action.optional(),
    }),
  ],
  "project register": [
    receipt("cli-project-register-1", "成功", {
      project: text,
      root: text,
      storeType: oneOf("managed", "embedded"),
      bound: bool,
      nextAction: action.optional(),
    }),
  ],
  "project list": [
    receipt("cli-project-list-1", "成功", {
      items: list(publicProjectListEntryItem),
      nextCursor: text.optional(),
    }),
  ],
  "project show": [
    receipt("cli-project-show-1", "成功", {
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
    receipt("cli-project-upgrade-1", "成功", {
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
    receipt("cli-project-repair-1", "成功", {
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
    receipt("cli-project-bind-1", "关系已更新", {
      project: text,
      relation: oneOf("primary", "mounted", "unbound"),
    }),
  ],
  "project unbind": [
    receipt("cli-project-unbind-1", "关系已更新", {
      project: text,
      relation: oneOf("primary", "mounted", "unbound"),
    }),
  ],
  "project mount": [
    receipt("cli-project-mount-1", "关系已更新", {
      project: text,
      relation: oneOf("primary", "mounted", "unbound"),
    }),
  ],
  "project unmount": [
    receipt("cli-project-unmount-1", "关系已更新", {
      project: text,
      relation: oneOf("primary", "mounted", "unbound"),
    }),
  ],
  "project prune": [
    receipt("cli-project-prune-1", "成功", {
      removedCount: integer,
    }),
  ],
};
