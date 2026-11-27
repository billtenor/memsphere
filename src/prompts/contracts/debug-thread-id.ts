import { bool } from "./types.js";
import { receipt } from "./types.js";

export const debugThreadIdContracts = {
  "debug-thread-id": [
    receipt("cli-debug-thread-id-1", "成功",
      { rule: "只给 identified，宿主 thread ID 不公开。" }, {
      identified: bool,
    }),
  ],
};
