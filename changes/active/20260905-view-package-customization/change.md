---
id: 20260905-view-package-customization
status: validating
type: feature
created: 2026-09-05
run_id: run-20260904-165459z-d3bd2ad3
---

# 可定制视图、主题与界面资产生态

## 需求

用户可以在 Home 安装本地 View Package，并在 Project 中组合启用，用自己的展示候选替换 Memory 页面、Memory 详情、Run 页面和 Run Artifact 正文。用户还可以选择 light/dark/system 模式、注册和覆盖 Theme，以及在明确授权后安装 scoped/shared/global style。默认未配置时，现有界面、URL 与业务能力保持兼容。

Theme、样式和展示包应具备稳定 identity、版本、来源与依赖元数据，为后续分享、导入、官方收录和升级演进保留兼容基础；本迭代只交付可信本地路径，不实现远程市场、自动下载或恶意代码沙箱。

Memory 与 Run 必须实际迁移到新架构：官方现有实现成为 priority 1000 的 fallback candidate，外部候选可 shadow，挂载失败时自动 abdicate 并恢复官方正文；业务状态机、稳定 Route、ChangeSet/Review 与 Artifact Review 操作仍由官方 controller/overlay 持有。

## 验收标准

- Home 可添加、检查、授权和移除本地 View Package；Project 可选版本、启禁用、配置实例并处理同 priority 冲突。
- 未配置时 Memory/Run 的 DOM、交互和 URL 保持兼容；四个 presentation/renderer cell 均完成官方候选迁移和用户候选覆盖。
- 同 cell 数值较小 priority 获胜；同 priority 无首选时所有相关外部实例在 apply 前原子失败并回退官方候选，结果不依赖加载顺序。
- 四个 cell 的同步 throw、异步 reject 均恢复官方稳定正文 DOM，清理 container/portal/subscription，并在 diagnostics 中记录 failed/abdicated 与 `fallbackTo`。
- 提供官方完整 light/dark system token、light/dark/system 设置入口、Home/Project Theme 选择与覆盖、分层回退和来源诊断。
- scoped/shared style 按实例生命周期安装；global style 经过 Manifest、Home、Project 三层授权和 PostCSS fail-closed 检查。
- 外部资产使用进程级 HMAC 不可猜 key、Project/实例隔离和固定 MIME 白名单；跨 Project、旧 key、HTML/SVG/XML/未知类型不可读取。
- 保存 composition 后保持启动快照并提示 restart pending；重启后 resolver、资产、实例、Theme/Style 和 diagnostics 一致重建，A/B Project 不串线。
- 提供不进入 builtin catalog 的可复制预编译示例包，CI 重建并校验签入 bundle，SDK 必须 externalize。
- 中英文文案、宽窄屏、键盘路径、自动化与真实浏览器验证通过；相关 System Memory、Reserved Memory 和 Skill 契约同步。

## 参考与决策

- 参考 DeepSeek Harness commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` 的分层包组合、稳定 cell、较小 priority 获胜、失败让位和 Theme 注册模型。
- 沿用本仓库 TypeScript/DOM、ViewHost 生命周期、事务与配置管理；不引入 Cordis、React 或 DSH 包管理器。
- `defineSlot()` v1 保持对象身份兼容，跨包扩展使用 owner 声明、dependency resolve 真实 token 的 portable Slot。
- 外部 Package 可使用基础 `slots`、`router`、只读 `theme` 与 `ui` 创建自己的 Module 页面；`themeRegistry` 与 Style contribution 仍按 Manifest/Home/Project capability 裁剪，官方 Route 所有权不转移。

## 技术与测试方案

由本 Run 的“实施与验证方案”与“开发计划”作为评审权威产物；长期关键约束与最终证据在本文件持续回填。实施顺序为配置/Manifest → resolver/资产 → Runtime/portable Slot → Theme/Style → Memory → Run → Settings/快照 → 示例/文档/Memory。

验证分为纯解析单元、Runtime/配置模块、真实 HTTP/子进程、业务 Module、Playwright 浏览器五层；最终执行 typecheck、全量 test、build、`memsphere validate` 与适用的 Memory ChangeSet validate。

## 开发任务

- [x] 配置、Manifest、Package registry、资产服务和启动快照。
- [x] Runtime priority/shadow/fallback、per-instance service allowlist、portable Slot 与 diagnostics。
- [x] Theme Registry、官方 dark token、mode 切换及 Style 生命周期/安全门禁。
- [x] Memory 与 Run 四个 cell 的官方候选迁移和只读 presentation context。
- [x] Settings 的 Home 安装、Project composition、冲突处理和 restart pending。
- [x] 独立示例、作者文档、中英文文案、System/Reserved Memory 与 Skill 同步。
- [ ] 自动化、浏览器实测、专业评审与产品验收材料。

## 验收结果

已完成独立 Package 正式加载、Settings 点击安装/双层授权/启用/Theme 选择/重启闭环、Memory/Run 页面替换、data renderer fallback、dark Theme 和 scoped/global Style 的 Chromium 验证。双 viewport 截图为 `memory-custom-desktop.png` 与 `memory-custom-mobile.png`。Memory ChangeSet `change-20260904-235551857z-74ca6050` 于最终代码上重新校验通过，Content Digest 为 `54239904d5b75ead6c64af0e0b78b35fce82bd270c361257b2b503d254003607`。`npm run typecheck`、`npm run build`、`git diff --check` 均通过；全量 548 项测试最终结果为 547 passed、1 个 Windows-only skipped、0 failed。专业评审与产品验收材料待完成。
