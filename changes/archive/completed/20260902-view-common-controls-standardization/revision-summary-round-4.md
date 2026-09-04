# 第 4 轮修订摘要

## 第三轮阻塞项

- Combobox listbox 不再作为字段内的绝对定位元素，而是挂载到 View Mount 提供的 Portal，使用 `position: fixed` 和输入框 `getBoundingClientRect()` 计算 `left/top/width`。
- 打开、任意祖先滚动和窗口 resize 时都会重新定位；关闭与 dispose 会移除 Portal DOM 及所有监听器。点击 Portal 内选项不会被 outside-click 提前关闭。
- 这使下拉层脱离 Shell `overflow:hidden` 的裁剪上下文，同时保持输入框宽度和正下方 4px 间距。

## 自动化几何门禁

- Reference 浏览器测试新增桌面与 760px 窄屏断言：listbox 可见、左边与输入框一致、宽度一致、顶边等于输入框底边加 4px。
- 现有 Combobox ARIA、Home/End/PageUp/PageDown/Enter/Escape、外部点击、受控 query/value 和 active descendant 测试继续通过。

## 真实页面证据

- 1440×900：输入框 `{x:1183.65625,y:480.359375,width:207.328125,height:39.6875}`；listbox `{x:1183.65625,y:524.046875,width:207.328125,height:115}`，可见。
- 760×900：输入框 `{x:33,y:618.546875,width:694,height:39.6875}`；listbox `{x:33,y:662.234375,width:694,height:115}`，可见，document 无横向溢出。
- Chromium 控制台：0 error / 0 warning。
- 截图：`evidence/combobox-portal-desktop.png`、`evidence/combobox-portal-narrow.png`。

## 同批清理

- 删除 Run 刷新迁移后已不再命中的 `.run-list-refresh img` 死 CSS；Run 卡片仍使用真实 `<img>` 的领域图标规则保持不变。

## 验证

- `npm run typecheck`：通过。
- Reference 浏览器测试：18/18 通过。
- `npm test`：531 项，530 通过，0 失败，1 项 Windows 专属用例在 Linux 条件跳过；pretest 构建通过。
