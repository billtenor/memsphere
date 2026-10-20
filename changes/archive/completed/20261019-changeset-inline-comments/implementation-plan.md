# 实施与验证方案

## 需求基线与调查结果

基线 origin/master=b8fa54c，工作分支 codex/changeset-inline-comments；Run run-20261019-144339z-278320f8。产品已通过需求契约第二轮。

实际代码位于 modules/org.memsphere.memory/adapter/view/index.ts：renderWholeMemoryChange 把整份文档放入 diffLine，现有 `.memory-inline-diff-content>.memory-commentable {display:inline}` 把结构 section 也误当成行内文本；章节 + 仅依靠标题 hover 显示，指针移入按钮时缺少自 hover 的显示条件；renderComments 只有侧栏而无已保存原行评论挂载。原先 canComment 在 compose/submit 检查 active 且 !claimed，但 renderChangeDetail 无条件注入评论 callback，导致终态仍渲染 +。后端 src/memory/changeset.ts 的 assertMutableChange 已拒绝 completed/abandoned，不改后端门禁。

最新 master 已加入 DisclosureState，在 render() 前 capture，在 renderWorkspace() 最后按 Project、对象、视图和内容语义恢复；不能另建折叠状态系统。合并初检发现 master `ChangeSet comment saves preserve mixed disclosure choices` 的全页面文本选择器会因正文+侧栏重复评论产生 strict violation，应明确作用域，保留并加强原断言。

## 实现方式与影响范围

1. 行内 CSS 只作用于直接的 span.memory-commentable；结构 section 保持块级布局。为章节 + 增加自身 hover 的显示条件，保留原有标题显示限制。
2. renderChangeDetail 仅在 active 且非 claimed 的现有可评论状态注入 callback；compose、submit 和编辑/删除 UI 使用同一条件。completed/abandoned、基线或删除内容不新增写入入口，后端保持原实现。
3. 提取原有单条评论卡片渲染函数，侧栏与原行复用作者、状态、正文和拥有者编辑/删除动作。按当前 Memory reference/path 过滤评论，再以 location.anchor（兼容 target）查找候选 data-anchor；无匹配或整体评论仅保留侧栏，不猜测或创建虚假位置，不挂到 baseline。
4. 评论在最接近的语义行/结构标题附近建立独立容器：标量 li 内、Schema 字段行下方、section 标题下方或 flow head 下方。容器不得进入按钮/标题文本或破坏已有 flex/grid；Schema 字段的 block 评论跨满字段网格。相同位置多条保持存储顺序，跨 Memory 不能串行。Composer 使用相同定位逻辑，避免整份新增 diff 把编辑器移到文档末尾。
5. 保存评论的渲染不主动设置 details.open 或 section.open，不改变用户阅读状态；沿用 master DisclosureState。评论在祖先正文已展开时可见，用户收起正文时同时隐藏，侧栏完整记录保持。整页刷新只承诺数据仍在，按默认折叠状态手动展开查看；侧栏折叠不影响已展开的原行卡片。
6. 不新增公共 Slot、通用组件、持久化字段、权限、生命周期、YAML syntax 或迁移。System Memory 更新 concepts/memsphere-view 的 reserved 源和 .memsphere 开发副本，说明双处展示、折叠优先级、失配退化和终态只读；检查并同步 src/skills/memsphere/SKILL.md 的冗余说明。manifest 身份清单不变。

## 开发任务

- 整理当前候选并恢复 !claimed 原有条件，避免把此前临时试验的 claimed 扩权混入交付。
- 移除 mountInlineComments 对祖先的强制展开，保持单一 DisclosureState。
- 核对行级挂载和 grid/flex 的布局，复用评论卡片而非重复动作逻辑。
- 将新增的大型组合测试按独立可观察契约拆分，复用最短 fixture；调整 master 现有测试的正文/侧栏作用域并增强同步断言。
- 同步 Memory/Skill，完成变更级校验并留存证据。

## 验证方式与验收映射

- 布局和 hover：浏览器驱动 View 集成测试比较新增 Schema/Statement 文档 hover 前后几何值和块级宽度；移动到章节 + 后实际 click 并打开输入框。覆盖桌面/窄屏、不溢出、无 console error。
- 原行持久展示：模拟或真实 API 提交后等待响应和稳定重渲染，分别断言原行和侧栏；同一锚点多条、独立 Memory、target/location 和 snake/camel reference 兼容、缺失锚点和整体评论只保留侧栏；完整内容和差异模式都覆盖。
- 编辑/删除：在明确正文或侧栏作用域操作一张卡片，等待加载后确认两处一致；回归保留 master 的 mixed disclosure choices 测试，不用重复执行无关 UI 构造前置。
- 阅读状态：先打开某行提交评论，再收起该行祖先并触发侧栏切换/刷新，断言保持收起且侧栏可读；主动展开后原行评论可见。整页刷新后手动展开而不要求自动打开。
- 只读边界：completed/abandoned 和 claimed 状态无 +、编辑/删除入口，现有评论仍可读；后端 collaboration 集成测试直接请求终态 comment 写入应失败，不放宽断言。
- 自动化：先运行 builtin-memory-view、memory-changeset-collaboration、memory-diff、disclosure-state，再运行相关 view style/locale、reserved-store，最后 npm run typecheck、npm test、npm run build 和 memsphere validate。使用实际最新代码，不复用早前结果。
- 真人界面等价操作：使用 playwright-cli 在实际官方 Shell/30000 服务测试可用 active ChangeSet 的 +、提交、原行显示、折叠与视图切换；若原历史链接已不可用，以隔离的真实 Project/ChangeSet 准备可清理数据，不修改用户业务评论，不用静态页或独立前端替代。
- Memory 变更后以 memsphere memory change validate 记录有效 ChangeSet ID、valid、稳定 View URL；最终修改后重新校验，不能用普通 validate 代替。

## 采用规范与兼容性

采用 requirements/development/testing/delivery 四份仓库 Statement，特别是最小复杂度、System Memory 同步、测试单一主要失败含义、真实浏览器属于集成测试、先受影响后全量、稳定等待、产物与最终 checkpoint 一致。无其他额外设计规范。

向前兼容：不需要针对稳定 Tag 迁移（无 stable Tag）。保持当前存储/API/权限，历史评论可按已存在的字段读取。没有新增 syntax 关键字。

## 风险与待决问题

原始外部 ChangeSet 已找不到，必须构造受控真实记录做 Shell 验收；全量测试含跨进程和浏览器，需要沙盒外执行并分辨环境故障。基线节点没有候选 anchor 时不显示原行副本，完整评论仍在侧栏。最终 PR 合入由 Human 按流程完成，Agent review 不替代合入确认。无尚需用户选择的设计问题。
