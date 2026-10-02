# 实现与验证验收材料

Run：`run-20261001-054855z-53c67dce`。分支 `codex/project-models`；基线 `9766bdb6a85c42610a08fed1945a1e06303c5e98`。

本次提交完整工作区实现供研发、架构、测试独立评审，不仅评审此汇总。Human 只参与产品阶段；分域组织已明确后续另议，不纳入当前迭代。

## 审查基准与完整证据

工作区根目录：`/data00/home/liuyanjun.lyj/.codex/worktrees/ce87/vibe-mem`。

- 已确认需求：`changes/active/20261001-project-models/change.md`；Run 产品第 2 轮已批准 Submission。
- 已通过技术方案：`changes/active/20261001-project-models/implementation-plan.md`；Run 三方方案评审 `review-20261001-063839z-02dbd43d`。
- 前序功能实现摘要：`changes/active/20261001-project-models/implementation-summary.md`，逐项需求与文件映射、行为边界和失败修正历史。
- 前序初始验证报告：`changes/active/20261001-project-models/initial-validation.md`，当前步骤重新执行的验证证据、未执行项及 Memory 门禁。
- 开发计划：`changes/active/20261001-project-models/tasks.md`；截图位于同目录 `assets/`。

请查阅 Run 完整产物及实际工作区代码。`git diff` 只能看到 tracked 文件；新增文件仍 untracked，必须打开并检查，不能因未出现在 diff 中忽略。

## 实际改动范围

Tracked 改动以 `git diff --name-only`、`git diff` 为准：配置、Project、View API、模块 Catalog、Settings、双语、扩展导出、文档/Skill、两份 System Memory 与开发副本，以及受影响测试。摘要列出全部具体文件。

新增代码与测试：

- `src/project/models.ts`。
- `src/data/extensions/json-schema-metamodel/index.ts`。
- `modules/org.memsphere.models/module.json`、`adapter/view/index.ts`、`adapter/view/styles.ts`。
- `modules/shared/model-definition.ts`。
- `modules/org.memsphere.model-prototype/` 的完整原型 Module（`module.json`、`adapter/view/index.ts`、`adapter/view/definition-tree.ts`），正式主导航与原型来源明确分开。
- `test/data-json-schema-metamodel.test.ts`、`project-models.test.ts`、`view-models.test.ts`、`models-builtin-view-browser.test.ts`、`model-prototype-tree.test.ts`、`fixtures/project-model-view.ts`。
- 当前需求目录的契约、方案、计划、摘要、初始验证报告和截图。

`.vscode/`、`review-summary.md` 是用户原有内容，`.playwright-cli/` 是临时操作日志，不属于当前实现，不计划提交。没有改动 `src/data/api`，没有模型写 API、网页编辑、模型 CLI、Run 状态迁移或模型分域功能。

## 关键审查路径

1. Project root、可选 `modelsDirectory`、配置保存/CAS、刷新生效与项目隔离；不自动搬迁、不把绝对目录隐藏改写。
2. Draft-07 元模型 Factory 引导与 Store/JSON Serializer/DataManager 的完整链路，完整定义保留但元信息反射有限；业务 Runtime 的现有支持子集及精确依赖。
3. 单次内容消费、同一原文字节快照、完整分页、非法路径、坏项与真实 I/O 故障区别；不能掩盖整体读取故障。
4. 正式 Module 的真实 API、内置四个 raw 业务模型、字段树表、局部 required、数组元素、原文/复制、高级规则提示、键盘与窄屏。
5. 取消/generation、迟到响应、刷新、卸载清理、跨 Project 路由及模型设置入口位置。
6. 新增测试是否覆盖实际可观察契约，不降低既有门禁；Artifact Review 测试辅助函数竞态修正是否保持原断言。
7. README、System Memory、开发副本、Skill 与实际行为是否一致。

## 当前验证结论及限制

初始验证重新全量运行 `npm test`：822 项，821 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过。第 2 轮修订后重新运行：824 项，823 通过、0 失败、1 项相同条件跳过；修订测试 13/13、typecheck、构建、diff check、Project validate 和最终 Memory ChangeSet validate 均通过。正式模型真实 View 集成 14 项、playwright-cli 桌面/窄屏/中英文/设置实际操作均通过。已重启用户 View 至工作区构建，只读核验真实模型 API 与内置详情，无用户配置或文件写入。

第 2 轮修订与意见证据见 `changes/active/20261001-project-models/implementation-revision-2.md`：相对 `$id` 原有 Factory 明确不支持，保留该边界，但宿主不再抢先抛泛化 URL 错误；原始定义保留 BOM，补两项独立回归。产品范围与 API 不变。第 1 轮 Submission 保留原状，第 2 轮以当前实际文件和修订后验证为准。

Windows/macOS 原生未在本机执行；文件系统列表无索引、业务 JSON Schema Runtime 不支持完整标准反射，均为既有及已确认边界，不能由本文推导为三平台或全标准通过。

Memory ChangeSet `change-20261001-065614910z-18de9f8c`，validation passed；digest `59d901b23ad5a33cb2e5c94652e040716c9fdd07c4d921b1c3b007aebb1a9cb2`。View：[Memory 候选差异](http://127.0.0.1:30000/projects/memsphere/changes/change-20261001-065614910z-18de9f8c)。最终内容校验后未修改 Memory。

请分别以研发、架构、测试视角主动检查反例和边界；区分亲自检查/复跑证据与引用的结果，非阻塞问题也留下 risk/suggestion。当前提交尚未实现评审通过或产品交付验收，未 stage/commit/push。
