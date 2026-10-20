# 当前迭代需求契约

## 整体目标

让 ChangeSet 差异阅读和逐行修改意见可正常使用，完成本次修复的独立 Agent 评审、验证和 PR 交付。

## 当前迭代范围

修复整份新增 Schema/Statement 被行内 CSS 污染导致的 hover 布局异常；修复章节 + 在鼠标移入时消失，恢复 active 可评论目标的输入与提交；保存的 Comment 在绑定 Memory 的原行下展示，侧栏保留；completed/abandoned 禁止评论且不显示添加/修改/删除入口，已有评论只读显示；保持最新 master 展开状态保留契约。

既有实现作为候选，不因为代码已经存在而绕过方案、独立评审或验证。用户明确“completed 就不允许评论，别展示 +”；较早允许 completed 评论的试验已撤销，后端不扩大写入权限。

## 后续范围与不做事项

不新增评论数据协议、权限、认证、生命周期或后端能力，不重新开启 completed；不改 Artifact Review；不对无匹配 anchor 的评论猜测落点，侧栏仍是完整记录入口。不会自动合入 PR；流程内产品、研发、架构、测试 review 全部由 Agent，最终流程的 Human 合入确认单独保留，未将“不参与 review”解释为任意自动合入授权。

## 交付物

代码、回归测试、对应 System Memory 的 reserved 源与开发 Project 副本同步、Skill 同步检查、当前迭代 change 记录、需求/方案/验证/交付 Run 产物、一个本分支 PR 及其最新提交的全部适用 CI 结果。

## 验收标准

- 新增文档的差异正文保持块级布局和可用宽度；hover Added/新增 不改变文档几何布局。
- active 可评论目标 + 在标题和按钮之间移动时不会隐藏，提交保存成功。
- 标量行、结构章节、流程节点评论准确关联 Memory 与 anchor；差异和完整内容都显示已保存的对应评论，同一行多条按已有顺序展示；其他 Memory 不串行。
- 原行评论仅在其祖先正文已展开时可见；保存、编辑、删除评论和切换侧栏不得自动展开或收起正文。用户主动收起的正文及其原行评论一同隐藏，侧栏仍可查看完整评论。重新展开原行时立即展示已保存的评论；完整页面刷新按正文默认折叠状态，不承诺自动展开。删除和编辑后两处一致。
- completed、abandoned 的 + 与写入入口隐藏，后端原有只读门禁继续生效；已有评论仍可读。
- 用户的正文展开/收起选择与 master 会话内状态保持兼容，评论操作不重置阅读结构。
- 必跑 typecheck、受影响 View/Comment/披露状态测试、npm test、npm run build、memsphere validate；明确更新 concepts/memsphere-view 的 reserved 源与开发副本，说明原行/侧栏展示、折叠优先级、终态只读及无锚点降级；检查并同步 Skill 冗余说明。运行 reserved-store 测试和变更级 validate，保存最终 ID、状态、View URL。真实 Shell 用 playwright-cli 验证受影响交互，记录环境和结果。

## 向前兼容

结论：不需要向前兼容。git tag --list '*stable*' 无结果，不存在需要另行承诺的 stable checkpoint。保留现有 Comment 存储字段、读取、后端权限和终态只读行为，不引入迁移。

## 采用的项目规范

已读取 statements/memsphere-repository-requirement-rules（独立向前兼容章节）、memsphere-repository-development-rules（最小复杂度、System Memory 与 Skill 同步）、memsphere-repository-testing-rules（受影响测试、全量回归、真实 Shell 交互和 Memory 校验）、memsphere-repository-delivery-rules（验收、需求归档及证据）。领域参考 concepts/memsphere-view，流程 procedures/memsphere-agile-requirement-development；changes/README.md 约束本轮需求记录。无其他额外需求规范。

## 待确认项

无需要用户补充的需求决策；用户已经授权全 Agent review。折叠优先级是落实最新 master 既有阅读状态契约的边界澄清，不是新增自动定位或提示功能；不新增折叠标题提示或自动展开能力。实现细节由 Agent 按契约处理，范围变化仍须遵守流程门禁。此契约不要求用户参与中间 Artifact Review。
