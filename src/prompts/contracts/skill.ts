import { oneOf, text } from "./types.js";
import { receipt } from "./types.js";

export const skillContracts = {
  "skill init": [
    receipt("cli-skill-init-1", "成功",
      { rule: "只给 skill、安装目标 path、实际 status。" }, {
      skill: text,
      path: text,
      status: oneOf("installed", "upgraded"),
    }),
  ],
  "skill upgrade": [
    receipt("cli-skill-upgrade-1", "成功",
      { rule: "只给 skill、安装目标 path、实际 status。" }, {
      skill: text,
      path: text,
      status: oneOf("installed", "upgraded"),
    }),
  ],
};
