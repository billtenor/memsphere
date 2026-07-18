import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { skillInitCommand } from "../src/commands/skill.js";
import { readAllMemoryFiles } from "../src/memory/store.js";
import { bundledReservedMemoryRoot } from "../src/reserved/store.js";

test("skill init installs only the unified memsphere skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-skill-test-"));

  try {
    await skillInitCommand({ directory: dir });

    assert.deepEqual(await readdir(dir), ["memsphere"]);

    const source = await readFile(join(dir, "memsphere", "SKILL.md"), "utf8");
    assert.match(source, /^---\nname: memsphere\n/);
    assert.match(source, /memsphere memory list/);
    assert.match(source, /memsphere memory read/);
    assert.match(source, /memsphere run start/);
    assert.match(source, /memsphere run repeat/);
    assert.doesNotMatch(source, /--output yaml/);
    assert.doesNotMatch(source, /\.memsphere\/memory\/concepts/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unified skill and reserved memories keep the same bootstrap contract", async () => {
  const skill = await readFile(join(process.cwd(), "src", "skills", "memsphere", "SKILL.md"), "utf8");
  const reserved = JSON.stringify((await readAllMemoryFiles(bundledReservedMemoryRoot())).map((file) => file.entity));

  for (const signal of [
    "memsphere memory list",
    "memsphere memory read",
    "--node",
    "node_ref",
    "context",
    "fragment",
    "condition_artifact",
    "memsphere init",
    "memsphere run start",
    "memsphere run report",
    "--artifact-file",
    "通用流程",
    "Procedure Asserts",
    "Actor",
    "Ask human to do",
    "Suggests",
    "Then"
  ]) {
    assert.match(skill, new RegExp(signal));
    assert.match(reserved, new RegExp(signal));
  }

  for (const obsolete of [
    "不得使用 find",
    "不得直接读取 Memory Store 文件",
    "按需导入",
    "Agent 必须完整读取目标 Memory",
    "必须先选择并完整读取适用的 Procedure"
  ]) {
    assert.doesNotMatch(skill, new RegExp(obsolete));
    assert.doesNotMatch(reserved, new RegExp(obsolete));
  }
});
