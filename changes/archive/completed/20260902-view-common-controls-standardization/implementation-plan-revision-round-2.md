# 实施方案第 2 轮修订摘要

- 补齐受控表单公开契约：文本类字段显式包含 `value`、`placeholder`、`onInput`，Checkbox 显式包含 `checked`、`indeterminate`、`onChange`。
- 明确 Tabs 的路由与面板边界：item 使用 `route | action`，路由状态由 URL 驱动；公共组件只管理 tab 交互和可选 `aria-controls`，领域 Module 管理 tabpanel Mount 与显隐。
- 明确 `ui.confirm(): Promise<boolean>` 的确认、取消、Escape、X 和错误语义；异步 action 失败不关闭 Dialog并允许重试。
- 增加系统图标严格校验与本期资产清单，移除未知名称静默回退；系统图标统一跟随 `currentColor`。
- 增加 Content List 的标准 `error + retry` 状态，并明确与 loading、empty 互斥。
- 收窄 Disclosure 迁移范围：带 ChangeSet 评论锚点的 Memory section 保持领域实现，只迁移无锚点的简单折叠区。
- 明确 Memory/Run 状态 pill 迁移为 Badge，领域 meta/anchor pill 保留并改用明确领域 class。
- 补充原生 dialog 测试迁移；本期仅清理 `confirm()`，明确保留 prompt/alert 的范围与原因。
- 纳入测试与架构建议：Combobox 完整键盘/ARIA断言、Settings 与稳定深链验收、按钮图标/hover/禁用态自动化锁定、真实 System Memory 路径、Content List 复用 sections。
