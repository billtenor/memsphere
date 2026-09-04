# 第 5 轮修订摘要

## 第四轮阻塞项

- 修复 Combobox 在“桌面打开下拉层 → 切换 760px 窄屏 → `scrollIntoView`”路径下偶发保留旧纵坐标的问题。根因是同步 scroll/resize 回调可能早于响应式布局稳定。
- Portal listbox 现在由 `ResizeObserver` 监听触发器尺寸变化，并在打开、祖先滚动、窗口 resize 后使用三帧的短时 `requestAnimationFrame` 校准 `left/top/width`。
- 校准只在事件后短暂运行；关闭与 dispose 会取消待执行帧、断开 Observer 并移除监听器，不存在常驻逐帧测量或泄漏。

## 稳定性门禁

- 浏览器测试不再在 viewport 切换后立即读取一次坐标，而是等待真实几何条件收敛：左右对齐、宽度一致、listbox 顶边等于输入框底边加 4px，然后保留精确坐标断言。
- 同一 Reference 浏览器测试连续运行 3 次，均为 18/18 通过。
- 最终实现执行 `npm test`：531 项，530 通过，0 失败，1 项 Windows 专属用例在 Linux 条件跳过；pretest 构建通过。

## 真实页面复验

- Firefox 1440×900：输入框 `{x:1183.67,y:480.10,width:207.33,height:40}`；listbox `{x:1183.67,y:524.10,width:207.33,height:118}`。
- Firefox 从 1440×900 切到 760×900 并滚动后：输入框 `{x:33,y:618.30,width:694,height:40}`；listbox `{x:33,y:662.30,width:694,height:118}`；document 无横向溢出。
- 全新浏览器会话控制台：0 error / 0 warning。
- 截图：`evidence/combobox-portal-stable-desktop.png`、`evidence/combobox-portal-stable-narrow.png`。

## 验证

- `npm run typecheck`：通过。
- Reference 浏览器测试连续 3 轮：每轮 18/18 通过。
- `npm test`：531 项，530 通过，0 失败，1 跳过。
