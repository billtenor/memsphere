---
id: 20260905-view-package-customization
status: validating
type: feature
created: 2026-09-05
run_id: run-20260904-165459z-d3bd2ad3
---

# 可定制视图、主题与界面资产生态

## 需求

用户可以安装本地界面扩展包，并分别选用其中的主题、页面、组件和样式；本页面中的全部配置统一应用到所有 Project。界面配置覆盖 12 类可扩展 Host 根 Slot 和 Memory/Run 的 4 个 portable cell。默认未配置时，现有界面、URL 与业务能力保持兼容。

Theme、样式和展示包应具备稳定 identity、版本、来源与依赖元数据，为后续分享、导入、官方收录和升级演进保留兼容基础；本迭代只交付可信本地路径，不实现远程市场、自动下载或恶意代码沙箱。

Memory 与 Run 必须实际迁移到新架构：官方现有实现成为 priority 1000 的 fallback candidate，外部候选可 shadow，挂载失败时自动 abdicate 并恢复官方正文；业务状态机、稳定 Route、ChangeSet/Review 与 Artifact Review 操作仍由官方 controller/overlay 持有。

## 验收标准

- 默认只提供一个“界面与主题”入口，按“界面扩展包安装、主题配置、界面配置”分区；安装是包级，应用是 contribution 级，“一键应用全部”是可继续编辑的批量选择。
- 整页只有一个状态和一个保存按钮，校验后原子保存 Home 全局配置；普通 UI 不展示 revision、digest 或 running/disk 配置。
- 扩展包安装、权限、主题、Slot 和样式选择全部为 Home 全局配置并应用到所有 Project；历史 Project View 字段只兼容读取且不参与展示。
- “界面配置”用表格列出全部 16 类用户可配置 Slot，single/keyed 单选、list 多选；新增稳定 Slot 通过统一目录自动进入表格。
- 未配置时 Memory/Run 的 DOM、交互和 URL 保持兼容；四个 presentation/renderer cell 均完成官方候选迁移和用户候选覆盖。
- 同 cell 数值较小 priority 获胜；同 priority 无首选时所有相关外部实例在 apply 前原子失败并回退官方候选，结果不依赖加载顺序。
- 四个 cell 的同步 throw、异步 reject 均恢复官方稳定正文 DOM，清理 container/portal/subscription，并在 diagnostics 中记录 failed/abdicated 与 `fallbackTo`。
- 提供官方完整 light/dark system token、全局 light/dark/system 设置入口、Theme 选择与覆盖、分层回退和来源诊断。
- scoped/shared style 按实例生命周期安装；global style 经过 Manifest、Home、Project 三层授权和 PostCSS fail-closed 检查。
- 外部资产使用进程级 HMAC 不可猜 key、Project/实例隔离和固定 MIME 白名单；跨 Project、旧 key、HTML/SVG/XML/未知类型不可读取。
- 保存 composition 后保持启动快照并提示 restart pending；重启后 resolver、资产、实例、Theme/Style 和 diagnostics 一致重建，A/B Project 不串线。
- 提供不进入 builtin catalog 的可复制预编译示例包，CI 重建并校验签入 bundle，SDK 必须 externalize。
- 中英文文案、宽窄屏、键盘路径、自动化与真实浏览器验证通过；相关 System Memory、Reserved Memory 和 Skill 契约同步。

## 参考与决策

- 参考 DeepSeek Harness commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` 的分层包组合、稳定 cell、较小 priority 获胜、失败让位和 Theme 注册模型。
- 沿用本仓库 TypeScript/DOM、ViewHost 生命周期、事务与配置管理；不引入 Cordis、React 或 DSH 包管理器。
- `defineSlot()` v1 保持对象身份兼容，跨包扩展使用 owner 声明、dependency resolve 真实 token 的 portable Slot。
- 外部 Package 可使用基础 `slots`、`router`、只读 `theme`、`presentation` 与 `ui` 创建自己的 Module 页面；`presentation` 只返回深冻结业务摘要和受控导航，`themeRegistry` 与 Style contribution 仍按 Manifest/Home/Project capability 裁剪，官方 Route 所有权不转移。

## 技术与测试方案

由本 Run 的“实施与验证方案”与“开发计划”作为评审权威产物；长期关键约束与最终证据在本文件持续回填。实施顺序为配置/Manifest → resolver/资产 → Runtime/portable Slot → Theme/Style → Memory → Run → Settings/快照 → 示例/文档/Memory。

验证分为纯解析单元、Runtime/配置模块、真实 HTTP/子进程、业务 Module、Playwright 浏览器五层；最终执行 typecheck、全量 test、build、`memsphere validate` 与适用的 Memory ChangeSet validate。

## 开发任务

- [x] 配置、Manifest、Package registry、资产服务和启动快照。
- [x] Runtime priority/shadow/fallback、per-instance service allowlist、portable Slot 与 diagnostics。
- [x] Theme Registry、官方 dark token、mode 切换及 Style 生命周期/安全门禁。
- [x] Memory 与 Run 四个 cell 的官方候选迁移和只读 presentation context。
- [x] Settings 以统一“界面与主题”页面承载扩展包安装、主题和表格式 contribution 配置；单一保存动作原子写入 Home 全局配置，并只展示可行动状态。
- [x] 独立示例、作者文档、中英文文案、System/Reserved Memory 与 Skill 同步。
- [ ] 自动化、浏览器实测、专业评审与产品验收材料。

## 验收结果

专业评审第 1 轮发现的三个 blocking 已修正：启动层现在冻结全部已注册 Project 的 composition/document revision/digest 与外部资产，Settings/diagnostics 显示 running/disk 和独立 `restartPending`；外部注册必须与 Manifest 的 `cell + id` 完全匹配且 priority 只来自 resolver；Run page 与 Artifact renderer 已补齐同步/异步失败、清理、diagnostics、官方 fallback 及真实 Artifact 启禁用浏览器验证。

可行动 risk 也已收敛：示例提供 source、确定性预编译脚本、构建字节比对、SDK externalize 与复制安装测试，并通过当前 SDK 自动生成内联坏包验证 Host 拒绝；示例使用只读 `presentation` service 而非裸 fetch；renderer 输入深冻结并提供受控动作；Theme light/dark 键集合和 Style namespace 均 fail-closed 校验。双 viewport 截图为 `memory-custom-desktop.png` 与 `memory-custom-mobile.png`。

专业评审第 2 轮指出 presentation 最小契约被静默收窄后，Runner 代理投“要求修改”：现已补齐 page `route`、当前选择与 `openCreate/startRun` 官方流程动作；Memory detail 与 Run Artifact 改用 SDK 明确定义的最小只读 context，保留官方包装的 ChangeSet/Review/copy/download 动作；外部实例的 `router` 服务授权已移除。新增浏览器契约验证 snapshot/records 深冻结、选中项和官方导航动作。

最终 `npm run typecheck`、`npm run build`、`git diff --check` 均通过；全量 557 项测试结果为 556 passed、1 个 Windows-only skipped、0 failed。最终 Memory ChangeSet 为 `change-20260905-014117951z-7ba6d2f2`，校验通过，Content Digest `4e60c70a42ff83cb029a000aa1942fd147c842cda1b2f51c8baa2218c3c2ebdb`，View 入口 `http://0.0.0.0:30000/projects/memsphere/changes/change-20260905-014117951z-7ba6d2f2`。专业复审与产品验收材料待完成。

产品验收第二轮进一步指出包级启用、双保存按钮、Project 主题、技术诊断和仅四个 Slot 的界面仍不符合用户心智。返修后采用“界面扩展包”术语；扩展包只负责安装与权限，主题全局独立配置，界面内容按 Slot/Style 独立选择；一键应用全部只批量填充选择。配置表由 Host 的稳定 Slot 目录生成并展示 16 类用户可配置位置，整页只有一个保存动作和一个可行动状态。旧 `/settings/packages`、`/settings/composition` URL 继续兼容。

返修后最终 `npm run build`、`git diff --check` 和全量 558 项测试通过：557 passed、1 个 Windows-only skipped、0 failed。真实浏览器在当前服务确认统一入口 1 个、旧入口 0 个、界面配置表完整展示 16 类可配置 Slot；旧 packages/composition URL 均进入同一页面。更新后的 Memory ChangeSet 为 `change-20260905-041123536z-7a67ad47`，Content Digest `5bb5f511c114a04a647660a20347dbd0dbcbb32e5a9ece4b7a254938ee8da546`，校验通过。

产品验收第三轮澄清“界面与主题”页面中的所有配置都应对所有 Project 生效，且无需显示额外范围文案。实现已将 Package capability、Theme、Slot、Style 和所需实例统一迁入 Home `view_composition`，Project 历史 View 字段只保留解析兼容、不再参与 resolver；启动快照使用一个全局 composition 为所有已注册 Project 构建实例。页面删除重复介绍卡及全部生效范围分组。跨 A/B Project 浏览器用例验证同一扩展内容同时生效，磁盘修改在重启前仍由全局启动快照隔离。全量 558 项测试结果为 557 passed、1 个 Windows-only skipped、0 failed。最终 Memory ChangeSet 为 `change-20260905-052525896z-679777fa`，Content Digest `8315dc2d43878c7f2b205045dc213fdd5530df18c50a3358c5ebaa3dc616b9a5`，校验通过。
