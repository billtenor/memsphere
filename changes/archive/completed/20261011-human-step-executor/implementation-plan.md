# 实施与验证方案

## 采用的规范与依据

从本 Run 冻结 Memory 读取并采用 `memsphere-repository-development-rules`、`memsphere-repository-testing-rules`、`memsphere-repository-requirement-rules`、`memsphere-repository-delivery-rules`。以正式通过的需求契约为最终验收依据。此文在需求评审期间准备，需求变更时同步修订后再提交方案评审。

## 流程选择授权

本轮 user 原话：“启动敏捷需求流程来处理这个。我就不参与角色了，都由 agent 来吧”。Runner 亲自收到该确定指令，优先于 Memory 中默认选择专用流程的规则。已保留产品第一轮原始意见，并在 `workflow-authorization.md` 和正式 Review disposition 中记录依据；不削弱实现验收标准。

## 代码调查与根因

`modules/org.memsphere.memory/adapter/view/index.ts` 的 `normalizeMemoryFlowNode` 将普通 Action 放入 content，并将 If/While 的 condition Action 放入 content。`memoryFlowHooks` 调用共享 `renderContentFlow`，目前 renderMeta 只渲染 Artifact 信息，因此 human 执行者被遗漏。Memory 详情、ChangeSet Full content 和 Diff 都复用这套 renderer；修复应在此处统一完成。

`modules/shared/view/content-flow.ts` 在步骤标题中先渲染 action、meta，再调用 decorateHead。利用已有 decorateHead hook 为 human 插入执行者标记，无需改共享接口或 Run renderer。Call 单独渲染 target，不处理 actor。

## 实现方式与影响

- 在中英文 fallbackMessages 中定义执行者/Human 文案。
- decorateHead 中只对 `node.content.actor === "human"` 插入标记，位置在 Artifact 信息之前。Agent 和省略 actor 都不插入。
- 普通 Action 的标记绑定 `${node.path}.actor`；If/While 使用 `${node.path}.condition.actor`。沿用 commentable/anchor 协议支持评论及 Diff。
- actor 标记独立于 Artifact 的 data-diff-group，避免执行者变化错误地替换产物。
- 沿用现有 pill 样式和共享标题布局，检查窄屏无溢出。
- System Memory `memsphere-view` 源文件与当前 Project 副本同步加入 Human 展示规则；Skill 的现有 Agent 步骤说明未冲突，确认无需更改。无 manifest 或 DSL 变更。

本轮恢复显示语义，不改变执行权限、Human 暂停行为、Run/Review 持久化结构、Artifact 或 Reviewer 内容。

## 开发任务

1. 复核上一轮候选实现与正式需求契约一致。
2. 补齐或整理能独立保护执行者可见性、ChangeSet 变化和字段定位的浏览器回归测试，避免依靠已有摘要证明边界正确。
3. 若正式 Reviewer 找出实现缺陷，修复对应路径并重跑受影响测试。
4. 同步 Memory，校验最终差异并形成可审阅实施/验证/交付材料。

## 验证方式

- 浏览器集成测试检查普通和嵌套 human、agent 与省略 actor、If/While condition、ChangeSet Full content 和双向 actor 变化、执行者评论定位；已有 Artifact/Reviewer 断言继续保护相邻内容。
- 先执行 `test/builtin-memory-view.test.ts` 和 `test/reserved-store.test.ts`。
- 通过 playwright-cli 在实际 View Shell 检查桌面/390px 窄屏显示、展开收起、执行者评论交互和 console；上一轮临时 Fixture 实测仅作为补充证据，正式验收需真实 Shell。
- 对最终实现执行 `npm run typecheck`、`npm test`（全量）、`npm run build`、`memsphere validate`、`memsphere memory change validate`，保留日志与最终 ChangeSet ID/digest/View。
- Reviewer 独立审查前序 Run Artifact 和工作区 diff，区分亲查、亲跑及引用的证据。

## 向前兼容

结论：不需要向前兼容。没有本地 stable Tag，不增加或迁移持久化字段；既有 human/agent 数据由原结构读取。

## 待决问题

无新增产品决策；发现超出范围的事项记录后续，不自主扩大当前迭代。Review 按 Agent Slot Binding 正式执行。
