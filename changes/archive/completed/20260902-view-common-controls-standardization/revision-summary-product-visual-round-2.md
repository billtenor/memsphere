# 产品验收修订摘要

## 修改原因

Human 产品负责人在首次产品验收中投票要求修改：修复本次完整视觉巡检发现的问题。

## 本轮逐条修改

1. 修复激活“原型”导航图标和深色按钮图标的颜色继承；避免为不支持 fill 的 `sparkle` 请求不存在资源。
2. 重排标准 Content List 行，将多 Badge 放入正文信息区，保持长标题、描述、单 Badge、尾部动作和展开动作的稳定几何。
3. 提高窄屏 Content List 区域高度，消除首项信息被挤压和文字竖排。
4. 修复 Checkbox、Badge、Feedback、Progress 的公共布局与跨浏览器外观。
5. 将 Select 的原生系统弹层替换为 Theme 驱动的 Portal listbox，增加焦点样式、键盘交互、视口钳制与上下翻转，同时保留 `HTMLSelectElement` API 兼容性。
6. 为 Host Overlay 增加兼容默认值为 `wide` 的 `compact` 尺寸；Reference Dialog/Drawer 使用紧凑规格，Artifact Review 的既有大尺寸行为不变。
7. 补充 Select 与 Overlay 尺寸的 SDK/浏览器契约测试，并完成 9 个真实 Firefox 视觉状态复查。

## 验证

- `npm run typecheck`：通过。
- 直接影响测试：73/73 通过。
- `npm test`：531 项，530 通过，0 失败，1 项 Windows 专属测试按 Linux 条件跳过。
- `npm run build`：通过（同时由 `npm test` pretest 再次执行）。
- `memsphere validate`：通过。
- `memsphere memory change validate change-20260903-064024850z-d6c05ac6`：通过；Content Digest `dc6411711d17f57347f7384d38c62373e02f6c149b6314b7d078e2891c2728e9`。
- `git diff --check`：通过。
- 真实 Firefox 视觉与交互巡检：9 个状态通过；控制台 0 error / 0 warning。

## 复验入口

- Reference Module：`http://127.0.0.1:30000/reference`
- Memory ChangeSet：`http://127.0.0.1:30000/projects/memsphere/changes/change-20260903-064024850z-d6c05ac6`
- 视觉证据：`changes/active/20260902-view-common-controls-standardization/evidence/product-visual-audit-round-2/`
