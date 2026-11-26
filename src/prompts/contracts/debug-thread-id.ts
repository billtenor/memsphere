import { bool } from "./types.js";
import { receipt } from "./types.js";

export const debugThreadIdContracts = {
  "debug-thread-id": [
    receipt("cli-debug-thread-id-1", "成功", {
      identified: bool,
    }),
  ],
};
