import assert from "node:assert/strict";
import test from "node:test";
import { assertProjectName } from "../src/project/model.js";


test("project names are readable stable identifiers", () => {
  for (const name of ["memsphere", "career-memory", "team.memory_1"]) assert.equal(assertProjectName(name), name);
  for (const name of [
    "", "Team", "space name", "项目", ".", "..", "project.",
    "con", "con.memory", "prn", "aux", "nul", "com1", "com9.log", "lpt1", "lpt9.yaml"
  ]) assert.throws(() => assertProjectName(name));
});
