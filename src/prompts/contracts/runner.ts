import { list, oneOf } from "./types.js";
import { publicRunnerDetectEntryItem } from "./fields.js";
import { z } from "zod";
import { receipt } from "./types.js";

export const runnerContracts = {
  "runner detect": [
    receipt("cli-runner-detect-1", "成功",
      { rule: "安装探测状态及已知版本；禁止探测命令的原始 stdout。" }, {
      items: list(publicRunnerDetectEntryItem),
    }),
  ],
  "runner identity": [
    receipt("cli-runner-identity-1", "识别成功",
      { rule: "识别成功才给 agentType。" }, {
      identified: z.literal(true),
      agentType: oneOf("codex", "traex", "claude"),
    }),
    receipt("cli-runner-identity-2", "未识别",
      { rule: "识别成功才给 agentType。", omit: ["agentType"] }, {
      identified: z.literal(false),
    }),
  ],
};
