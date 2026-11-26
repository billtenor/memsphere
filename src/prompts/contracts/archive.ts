import { bool, list, text } from "./types.js";
import { publicArchiveListEntryItem } from "./fields.js";
import { receipt } from "./types.js";

export const archiveContracts = {
  "archive list": [
    receipt("cli-archive-list-1", "成功",
      { rule: "只给本页归档对象 kind、id、archivedAt? 和 nextCursor?。" }, {
      items: list(publicArchiveListEntryItem),
      nextCursor: text.optional(),
    }),
  ],
  "archive run": [
    receipt("cli-archive-run-1", "成功",
      { rule: "列表只给归档对象类型、ID、时间；写操作只给 runId 和归档布尔状态。" }, {
      runId: text,
      archived: bool,
    }),
  ],
  "archive restore run": [
    receipt("cli-archive-restore-run-1", "成功",
      { rule: "列表只给归档对象类型、ID、时间；写操作只给 runId 和归档布尔状态。" }, {
      runId: text,
      archived: bool,
    }),
  ],
};
