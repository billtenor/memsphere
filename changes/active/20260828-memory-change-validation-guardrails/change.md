---
id: 20260828-memory-change-validation-guardrails
status: todo
type: feature
created: 2026-08-28
run_id: run-20260828-040552z-e22e56e9
---

# Memory 变更级校验与 ChangeSet 交付门禁

## 需求

改进 Memory 编辑后的变更级校验引导和交付门禁，使 Agent 能稳定区分 `memsphere validate` 与 `memsphere memory change validate`，避免只完成正式 Store 校验却没有创建或更新 ChangeSet、也没有向 Human 提供 ChangeSet ID 与 View 链接。

该门禁同时适用于 Managed 与 Embedded Project：

- Managed Project 的 Memory 修改必须在受控 ChangeSet 候选上完成变更级校验，并按既有 publish 流程发布。
- Embedded Project 的 Memory 工作树修改必须创建或复用逻辑 ChangeSet，完成变更级校验后再通过正常 Git 流程集成。
- 两类 Project 的创建时机、候选位置和集成方式可以不同，但都不能用普通 `memsphere validate` 代替变更级校验。

本需求来源于 View 中文化迭代中的真实遗漏：正式 Store 校验已经通过，但交付报告未包含 Memory ChangeSet；直到 Human 主动索要链接后才补执行 `memsphere memory change validate`。关联证据为 ChangeSet `change-20260828-035525403z-9dd8d41d`，但本需求不纳入该中文化迭代实现。

## 验收标准

- 修改 Managed 或 Embedded Project 的 Memory 后，适用规则明确要求执行 `memsphere memory change validate [change-id]`；普通 `memsphere validate` 明确不能满足该门禁。
- 通用敏捷开发流程在实现验证、交付报告或 commit 前检查 Memory 交付差异；存在 Memory 差异时，交付报告必须包含匹配当前内容的 ChangeSet ID、校验状态和 View 链接。
- memsphere Skill 在靠前且醒目的位置提供 Memory 写入硬门禁，而不是只在 ChangeSet 详细说明中间接提及。
- `memsphere validate` 的命令帮助和成功输出明确说明其校验范围，以及不会创建或更新 ChangeSet，并提示 `memsphere memory change validate`。
- `memsphere validate` 保持原有职责，不因普通整体校验自动创建 ChangeSet，也不破坏 `--memory-root` 的无 Home、Registry 或 Binding 校验能力。
- 自动化测试覆盖 Managed 与 Embedded 两类 Project、CLI 提示、`validate` 无创建 ChangeSet 副作用、Skill/Memory/Procedure 规则一致性，以及交付报告门禁。
- Project System Memory、Reserved System Memory 和 `src/skills/memsphere/SKILL.md` 的重叠语义保持一致，并通过适用的完整回归。

## 范围

- 修订 Memory 编辑、仓库开发、仓库测试和敏捷交付相关的 Statement/Procedure 规则。
- 修订 memsphere Skill 的 Memory 写入门禁和命令区分说明。
- 改进 `memsphere validate` 的 help、文本输出及适用的结构化诊断设计。
- 增加 CLI、ChangeSet、System Memory 同步和流程契约测试。
- 同时覆盖 Managed 与 Embedded Project 的变更级校验要求。

## 不做事项

- 不让 `memsphere validate` 自动创建、更新、发布或完成 ChangeSet。
- 不合并 `memsphere validate` 与 `memsphere memory change validate` 两个命令的职责。
- 不改变 Managed publish、Embedded Git 集成、ChangeSet claim/comment 或生命周期语义。
- 不在当前 View 中文化 Run `run-20260827-140127z-439c5941` 中实施本需求。

## 关联需求

- `20260818-changeset-effective-validation`：已完成，提供 ChangeSet 有效 Store 校验入口。
- `20260822-changeset-experience-loop`：已完成，提供 Embedded ChangeSet 体验闭环。
- `20260823-changeset-active-lifecycle`：已完成，定义 ChangeSet active 生命周期。
- 重复需求：无。

## 技术与测试方案

待开发前补充。

## 开发任务

待开发前补充。

## 验收结果

尚未开始。
