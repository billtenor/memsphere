# 功能实现摘要

## 实现与需求映射

- `modules/org.memsphere.memory/adapter/view/index.ts`：新增独立引用目录，ChangeSet 使用完整候选摘要判断有效引用。原位规则 renderer 保持既有数量、正文、章节定义、展开/收起。打开命题保留 change query 并解除 section=changes 对详情呈现的覆盖。覆盖验收 1–3。
- `src/memory/changeset.ts`：detail snapshot callback 提供 baseMemoryRoot，退出仍统一清理两份目录，根路径不出现在 HTTP payload。覆盖验收 8。
- `src/commands/view.ts`：返回完整候选 referenceMemories；临时 summary 显式不传长期 cache；候选和基线各共享读取 Promise/索引的 RuleLookup。有效规则从相应 snapshot 解析，解析失败隔离到单个引用，保留有效兄弟成员并再次整体解析以沿用去重；原始声明不修改，普通 effective API 仍严格拒绝无效引用。覆盖验收 1、4、5、8。
- `test/view-responsive.test.ts`：新增四项浏览器驱动集成测试，覆盖未修改目标、真正无效引用、混合有效/无效引用，以及修改目标后的两版本投影与候选导航。fixture 可选建立真实 Git Store，候选修改在隔离临时 Workspace 中经 edit/validate 形成 checkpoint，完整恢复 cwd/env。覆盖验收 1–5、8。
- `changes/active/20261014-changeset-rule-references/`：本 Run 的需求、评审修订、方案、任务及证据。

## 影响与兼容性

恢复已有引用展示契约，不改 YAML、CLI 或持久化语义。API 新增只读目录和有效规则投影，memory-diff 既有排除 effectiveRules 的行为保持，原始 !ref、comment anchor 未变化。普通 Memory detail 的 canonical 引用规则保持。新增 lookup 缓存只在当前 snapshot callback 存活，不把一次性 root 写入 ViewMemoryCache。

采用 memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-memory-access-rules、memsphere-yaml-syntax-rules。已完整检查 memsphere-memory、memsphere-view、memsphere-statement、memsphere-procedure 与 skill：均已覆盖现有来源入口/展开契约，无新增 Memory 能力。`git diff --name-only -- .memsphere/memory reserved-memory src/skills` 无输出，因此无 Memory 差异，不创建空 ChangeSet。

## 当前验证

- build 通过；typecheck 在补修后通过。
- `node --import tsx --test test/view-responsive.test.ts test/memory-changeset.test.ts`：30/30 通过，日志 evidence/affected-tests.txt。
- 新增混合引用与版本隔离回归分别通过，完整受影响文件也通过。
- playwright-cli 实际操作展开、收起、跳转通过；重复 12 次 detail 请求后 GC/heap snapshot 无保留的 disposable preview 路径。日志 evidence/browser-and-lifecycle.txt。

## 尚待验证/审查

本 Run 全量 npm test、最终 typecheck 与 Store 校验在下一验证步骤执行；此前会话全量结果不代替本轮结果。随后提交研发/架构/测试 Agent 成果评审，再由 Human 进行最终验收。运行中 View 尚未升级，最终交付为待审核 PR。
