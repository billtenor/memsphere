# 可定制视图与公共组件交付报告

## 交付内容

当前工作树基于 HEAD `08809c884c0d0ec56478fc3606a9902a4cc013cc`，包含此前已提交实现和本轮尚未提交的验收修订。

本迭代交付可信本地界面扩展包安装、主题选择、全局界面组合及默认回退；全部配置应用到所有 Project。设置页区分安装与已安装内容，统一保存，界面配置以表格和下拉单选/多选承载。删除重复 Package 权限开关。当前可选位置共 20 项：12 个公开框架位置、全局样式、4 个 Module portable cell、3 个公共组件 cell。

极简扩展包保留流程层级和轻量分支线，减少实线框；规则与字段默认折叠，提供展开全部/收起全部；别名只是显示名称，YAML 仍使用 names。步骤契约的产物与评审分开显示，补充信息通过悬停或键盘聚焦查看，实际产出物默认折叠。

Memory 与 Run 共用流程节点、内容画布、列表正文及规则折叠组件。Host 公共 UI 层声明 content.document、content.flow、content.disclosure 的 v1 default cell；模块通过 ctx.ui.contentComponent 使用，扩展包可统一选择实现。公共内容节点保留业务处理器；折叠实现保留原生 details/summary。未选候选或候选失败时使用默认实现。Run 继续管理运行状态、评审绑定、下载及产出物业务操作。

公共 slot 是同步内容组合契约：允许包装或调整默认内容，尚不是完整可序列化流程数据模型。跨模块共享契约不等同于所有业务区域都已转为公共组件。文档、SDK 类型、示例 Manifest/入口、配置目录和 View 概念记忆已同步。

## 验证结果

提交前对包含最新 Run 标签和产出物元信息调整的代码再次执行全量测试：561 项，560 passed、1 项 Windows-only skipped、0 failed。复验命令为 `node scripts/run-tests.mjs`，最新日志保存在本次执行环境 `/tmp/memsphere-commit-final-suite.log`；最新 `npm run build` 构建已通过。

构建、类型检查、git diff --check 和普通 Project Store 校验通过。公共组件专项覆盖重复调用、原生折叠、事件保留、无候选默认展示及错误候选回退。扩展包安装、禁用默认恢复、跨 Project 配置以及 Memory/Run 浏览器回归已执行。

全量首轮发现 6 个旧浏览器用例仍假设正文默认展开，或使用旧列表 DOM 路径。已修正为显式展开、检查正文对齐及共享正文容器；保留评审浮窗滚动隔离、横向滚动局部化、引用展开和刷新后状态检查。受影响单测复验通过。

## Memory 证据

本次同步 `.memsphere/memory/concepts/memsphere-view.yaml` 及 Reserved Memory 对应概念，记录公共组件与 20 项配置目录。

- ChangeSet：`change-20260907-014245831z-da668b2b`
- 变更级校验：`memsphere memory change validate` 通过（ChangeSet validation passed）。
- Base Revision：`08809c884c0d0ec56478fc3606a9902a4cc013cc`
- Content Digest：`385460738e5606e61da47e66a344bae8d5e9cba221d74227d9ef198fe35e5c8b`
- View：http://localhost:30000/projects/memsphere/changes/change-20260907-014245831z-da668b2b

普通 memsphere validate 的成功不替代上述变更级校验。后续若修改 Memory，将重新验证并更新本报告。

## 验收结论与评审历史

用户已在当前对话明确表示“好，验收通过”，验收对象包含极简效果、Memory/Run 一致性与公共组件 slot；这不被当作对旧报告的追溯投票。

此前实现评审对启动冻结、Manifest 注册匹配、fallback、输入上下文和配置交互提出的问题已有历史修正记录，详见 change.md。旧交付报告第 3 轮产品意见要求补齐后续范围、残留问题、Memory 校验证据和收尾状态；Human 已明确授权对旧报告投要求修改，提交于 review-20260905-015134z-469d8b0d / round-20260905-041708z-16ef22d5。本报告逐项补齐，并纳入之后用户确认的公共组件范围。

本报告第 4 轮（round-20260907-014638z-88c346d2）已获得 Human 与 Product 通过票，Runner 阅读意见后批准，Run 已进入 flow[8] 范围核对与 commit；是否创建 PR 仍由 flow[9] 向 Human 询问。

提交前补充：用户已验收 Run 当前步骤标签直接替换原类型标签，以及实际产出物取消元信息浮窗、展开后仅展示 file / 契约校验 / 时间。相关构建及 9 项专项回归通过。此段是提交阶段的追加记录，不更改 Review 中已冻结的报告快照。

## 后续范围

在线 Registry/市场、自动下载和升级、Verified/Official Curated 治理与审核后台、作者身份/命名空间/许可治理、恶意 JS 或 CSS 沙箱、HMR、在线可视化主题编辑器仍不在本次交付范围。

更细粒度 Slot 拆分已交付三个公共组件入口；其余领域组件、完整结构化流程模型、异步组件生命周期和布局编辑仍属于后续按需求演进范围，不承诺所有 DOM 均可替换。

## 残留问题与收尾

可信本地扩展仍具有同源 JavaScript 能力；样式校验不是恶意代码安全沙箱。`@keyframes` / `@font-face` 自动命名隔离保留为开启分享生态前的治理事项。

已有交互与响应式浏览器验证不等于全部主题、设备和复杂业务数据组合的完整视觉覆盖；原报告提及的额外 Run/light 截图仍作为可选补充，不作为本次验收阻塞项。

浏览器临时快照目录 `.playwright-cli/`、`.playwright/` 属于本地验证产物，不纳入提交。提交范围包含实际源码、示例、契约文档、测试、相关 Memory 和交付记录。采纳产品评审建议，明确将 design-qa.md、design-qa-memory-outline.md、design-qa-run-memory-parity.md 三份视觉 QA 记录作为验收证据纳入；其中外部截图路径仅为本次执行环境证据，不宣称随仓库分发。

全量验证成功后已更新 change.md 验收记录、移除 active status、写入 completed_at，并归档到 `changes/archive/completed/20260905-view-package-customization/`。本报告从归档目录提交正式 Review。Git commit 和可选 PR 严格按 Run 后续步骤进行；目录归档不代表尚未完成的报告 Review 已通过。
