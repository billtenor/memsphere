# 第 3 轮修订摘要

## 第二轮阻塞项

- Artifact Review 桌面端不再渲染隐藏的移动 Tabs。Module 监听 `matchMedia("(max-width: 820px)")`：进入窄屏时挂载公共 `ui.tabs` 并只显示选中 pane；回到桌面时卸载 tablist、恢复两个 pane，并在重渲染/销毁时移除监听器。
- 浏览器测试新增桌面 `tablist = 0`、桌面到移动动态挂载、移动键盘切换、移动回桌面卸载与双 pane 恢复断言。

## 同批公共契约完善

- 为 Select、Combobox、Disclosure、Progress、Card/Section、Confirmation 补齐严格运行期 validator；所有公开 UI 工厂在入口 fail-fast。普通 Action 与 HeaderAction 的扩展边界分开验证，底层共享按钮渲染器不错误拒绝已由 Host 验证的 Header `tone`。
- `renderPrimitiveIcon()` 运行期拒绝未知系统图标，内置生产字面量仍由构建门禁全量扫描。
- Combobox 增加 `aria-autocomplete="list"`、listbox 可访问名称、活动选项自动滚动；鼠标/键盘选择同时回写受控 query 和 value。`updateDescriptor()` 同样执行严格校验。
- 不确定 Progress 改为框架控制的动画轨道，`prefers-reduced-motion` 下静态呈现；进度条增加可访问名称和对应浏览器断言。
- Run 列表刷新迁移为公共 `ui.iconButton`，删除原生 `<button><img>` 双轨；移除迁移后无调用的旧 Run 私有渲染方法。
- 英文 View Plugin API 补齐与中文相同的完整 `ViewUi` 方法签名和 `ComboboxHandle.updateDescriptor()` 说明；中英文均说明运行期严格校验。

## 非阻塞意见的边界处置

- Memory/Run 主对象列表保留为领域自定义行：它们组合 ChangeSet 评审状态、归档语义和领域导航，强行替换会超出“可直接对应控件”的迁移范围。增强 Content List 由 Reference 及行为测试完整证明，后续可在单独的列表数据模型迭代中评估。
- Memory 搜索、评论 textarea 和 Run actor 多选与逐键重渲染、锚点/多选状态耦合，登记为后续稳定节点与焦点模型改造候选；本轮不以换皮方式冒险迁移。
- 3 处原生 prompt 与 1 处“无候选 Memory”alert 已逐项登记；本期契约明确只要求清零 confirm，输入 Dialog/Toast 另立需求评估。
- Module 领域画布与 Renderer 可继续使用局部视觉值；公共壳和公共控件必须消费 Theme Token，真实 Memory/Run 源码门禁禁止越权声明公共 Token、读取 Host 私有 Token、依赖 Shell 私有选择器或使用 `!important`。

## 验证

- `npm run typecheck`：通过。
- `npm test`：531 项，530 通过，0 失败，1 项 Windows 专属用例在 Linux 条件跳过；构建包含在 pretest 中并通过。
- Artifact Review 浏览器测试：桌面/移动动态 Tabs、ARIA、无横向溢出均通过。
- Reference 浏览器测试：18/18，通过 Combobox ARIA/键盘、受控状态、不确定 Progress 与 reduced-motion 等断言。
- 最终真实 Chromium：控制台 0 error / 0 warning；1440px 与 760px 均无 document 横向溢出；证据为 `evidence/reference-revision-3-desktop.png`、`evidence/reference-revision-3-narrow.png`。
