import { bool, list, text } from "./types.js";
import { publicArchiveListEntryItem } from "./fields.js";
import { receipt } from "./types.js";

export const archiveContracts = {
  "archive list": [
    receipt("cli-archive-list-1", "成功", {
      items: list(publicArchiveListEntryItem),
      nextCursor: text.optional(),
    }),
  ],
  "archive run": [
    receipt("cli-archive-run-1", "成功", {
      runId: text,
      archived: bool,
    }),
  ],
  "archive restore run": [
    receipt("cli-archive-restore-run-1", "成功", {
      runId: text,
      archived: bool,
    }),
  ],
};
