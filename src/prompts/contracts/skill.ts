import { oneOf, text } from "./types.js";
import { receipt } from "./types.js";

export const skillContracts = {
  "skill init": [
    receipt("cli-skill-init-1", "成功", {
      skill: text,
      path: text,
      status: oneOf("installed", "upgraded"),
    }),
  ],
  "skill upgrade": [
    receipt("cli-skill-upgrade-1", "成功", {
      skill: text,
      path: text,
      status: oneOf("installed", "upgraded"),
    }),
  ],
};
