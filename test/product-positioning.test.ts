import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { readReservedMemoryManifest } from "../src/reserved/store.js";

const root = process.cwd();
const reservedRoot = join(root, "reserved-memory", "system-memory");
const projectMemoryRoot = join(root, ".memsphere", "memory");

async function readReserved(relativePath: string): Promise<string> {
  return (await readFile(join(reservedRoot, relativePath), "utf8")).replace(/\r\n/g, "\n");
}

test("README, System Memory, and Skill share the personalized software positioning", async () => {
  const [readme, personalizedSoftware, framework, memory, skill] = await Promise.all([
    readFile(join(root, "README.md"), "utf8"),
    readReserved("concepts/memsphere-personalized-software.yaml"),
    readReserved("concepts/memsphere-framework.yaml"),
    readReserved("concepts/memsphere-memory.yaml"),
    readFile(join(root, "src", "skills", "memsphere", "SKILL.md"), "utf8")
  ]);

  for (const source of [readme, framework, skill]) {
    assert.match(source, /个性化软件/);
    assert.match(source, /Memsphere (?:本身)?不是(?:另一个)? Agent/);
    assert.match(source, /当前版本首先实现(?:了| Memory)/);
  }
  assert.match(personalizedSoftware, /个性化软件/);
  assert.doesNotMatch(personalizedSoftware, /Memsphere 不是 Agent|当前版本首先实现/);
  for (const source of [personalizedSoftware, skill]) {
    assert.match(source, /Prompt/);
    assert.match(source, /Skill/);
    assert.match(source, /个性化 CLI/);
    assert.match(source, /数据/);
    assert.match(source, /界面/);
    assert.match(source, /Token/);
    assert.match(source, /确定性算力/);
  }
  assert.match(framework, /memsphere-personalized-software 定义/);
  assert.match(memory, /Agent 理解并进入个性化软件的入口/);
  assert.match(memory, /不等同于完整的 Memsphere/);
  for (const source of [personalizedSoftware, framework, memory, skill]) {
    assert.doesNotMatch(source, /定义了一套维护、检索和遵循 Memory 的框架/);
  }
});

test("all installed System Memory sources match the current Project copies", async () => {
  const manifest = await readReservedMemoryManifest();
  assert(manifest.system_memory.install.includes("concepts/memsphere-personalized-software.yaml"));

  for (const relativePath of manifest.system_memory.install) {
    const [reserved, project] = await Promise.all([
      readFile(join(reservedRoot, relativePath)),
      readFile(join(projectMemoryRoot, relativePath))
    ]);
    assert(reserved.equals(project), `System Memory copy differs: ${relativePath}`);
  }
});

test("chapter one is a bounded first-use journey based on a real scenario", async () => {
  const tutorial = await readReserved("procedures/memsphere-tutorial-chapter-01.yaml");

  for (const signal of [
    "Human 真实场景",
    "Prompt、Skill、Memsphere",
    "Memory、个性化 CLI、数据和界面",
    "Token 算力与确定性算力",
    "当前能力与 Memory 协作模型",
    "当前教学 Run 的 View 观察指引",
    "个性化软件起点建议"
  ]) {
    assert.match(tutorial, new RegExp(signal));
  }

  const teachingHumanArtifacts = [
    "Human 真实场景",
    "软件生长模型学习确认",
    "当前能力学习确认",
    "View 实践结果"
  ];
  assert.equal(teachingHumanArtifacts.filter((name) => tutorial.includes(`name: ${name}`)).length, 4);
  assert.equal(tutorial.match(/^  - !while$/gm)?.length, 4);
  assert.match(tutorial, /project repair.*不是准入必经步骤/);
  assert.match(tutorial, /不得在本章执行 Memory edit\/publish/);
  assert.match(tutorial, /View 顶部进入“Run”/);
  assert.match(tutorial, /每一步上报的产物就是 Artifact/);
  assert.doesNotMatch(tutorial, /View 实际展示的“任务”/);
  assert.match(tutorial, /教学流程-第二章.*作为可选后续入口/);
  assert.match(tutorial, /不得把启动第二章设为第一章完成条件/);
  assert.doesNotMatch(tutorial, /请你启动 memsphere 教学流程-第三章/);
});

test("chapter three teaches Run execution and configurable Artifact Review roles", async () => {
  const [tutorial, experience, run, actor, review, view, procedure] = await Promise.all([
    readReserved("procedures/memsphere-tutorial-chapter-03.yaml"),
    readReserved("procedures/memsphere-tutorial-chapter-03-review-experience.yaml"),
    readReserved("concepts/memsphere-run.yaml"),
    readReserved("concepts/memsphere-actor.yaml"),
    readReserved("concepts/memsphere-artifact-review.yaml"),
    readReserved("concepts/memsphere-view.yaml"),
    readReserved("concepts/memsphere-procedure.yaml")
  ]);

  assert.match(run, /Action 的 actor 只区分 human 与 agent/);
  assert.match(run, /Runner 是 Memsphere 在当前通用 Agent 框架中的实际执行者/);
  assert.match(run, /主 Agent 和子 Agent 共同构成 Runner/);
  assert.match(actor, /Actor 不等同于 Procedure 中 Action 的 actor 字段/);
  assert.match(actor, /Review Slot.*Binding/);
  assert.match(review, /不可变 Artifact Submission/);
  assert.match(review, /ChangeSet Comment 是两种不同对象/);
  assert.match(view, /Memory 与 Run 是 View 的顶层入口/);
  assert.match(view, /本地操作界面/);
  assert.match(view, /不等同于.*专属界面/);
  assert.match(procedure, /memsphere-run/);
  assert.match(procedure, /memsphere-actor.*memsphere-artifact-review/);

  assert.match(tutorial, /Run 步骤执行者只区分 Human 和 Runner/);
  assert.match(tutorial, /实际检查第三章教学环境/);
  assert.match(tutorial, /当前 Project 至少有一名 Human Actor/);
  assert.match(tutorial, /没有任何可用 ACP Provider.*不得继续阻塞/);
  assert.match(tutorial, /Runner 内部如何分工由通用 Agent 框架管理/);
  assert.doesNotMatch(tutorial, /调用本章的 Agent 在执行 run start 预检时/);
  assert.match(tutorial, /请启动 memsphere 教学流程-第三章 Review 体验流程/);
  assert.match(tutorial, /Review 体验 Run 是否还没有结束/);
  assert.match(experience, /review:\n\s+- Human 体验者\n\s+- Agent 观察者/);
  assert.match(tutorial, /不得要求 Human 复述或回答概念/);
  assert.doesNotMatch(tutorial, /Human 的多角色 Review 观察结果/);
  assert.doesNotMatch(tutorial, /role_bindings|permission_grants/);
});

test("chapter two prepares and runs one personalized Procedure through four gates", async () => {
  const tutorial = await readReserved("procedures/memsphere-tutorial-chapter-02.yaml");

  for (const signal of [
    "Human 提供的个性化流程",
    "Memory 市场",
    "已校验的个性化 Procedure",
    "memsphere memory change validate",
    "ChangeSet 查看说明",
    "已提交 Comment",
    "请启动 <个性化流程名称> 流程",
    "个性化流程运行状态",
    "Human 的 Run 检查结果",
    "提交 Review 意见"
  ]) {
    assert.match(tutorial, new RegExp(signal));
  }

  assert.equal(tutorial.match(/^  - !while$/gm)?.length, 4);
  assert.equal(tutorial.match(/name: Human 的流程启动请求/g)?.length, 1);
  assert.doesNotMatch(tutorial, /!if/);
  assert.doesNotMatch(tutorial, /^\s{4,}- !while$/m);
  assert.match(tutorial, /不得 publish、commit、push、merge 或废弃 ChangeSet/);
  assert.match(tutorial, /不得修改 System Memory、Mounted Memory/);
  assert.match(tutorial, /环境是否还没有准备就绪/);
  assert.match(tutorial, /Human 是否还没有提供一个想使用的个性化流程/);
  assert.match(tutorial, /Human 提供的个性化流程是否还没有准备就绪/);
  assert.match(tutorial, /个性化流程是否还没有运行结束/);
  assert.doesNotMatch(tutorial, /请你启动 memsphere 教学流程-第三章/);
  assert.doesNotMatch(tutorial, /^\s+review:/m);
});
