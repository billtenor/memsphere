import { list, oneOf } from "./types.js";
import { publicRunnerDetectEntryItem } from "./fields.js";
import { z } from "zod";
import { receipt } from "./types.js";

export const runnerContracts = {
  "runner detect": [
    receipt("cli-runner-detect-1", "成功", {
      items: list(publicRunnerDetectEntryItem),
    }),
  ],
  "runner identity": [
    receipt("cli-runner-identity-1", "识别成功", {
      identified: z.literal(true),
      agentType: oneOf("codex", "traex", "claude"),
    }),
    receipt("cli-runner-identity-2", "未识别", {
      identified: z.literal(false),
    }),
  ],
};
