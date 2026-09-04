# 第 2 轮修订摘要

本轮接受第 1 轮架构师的阻塞意见，并主动完成研发、测试提出的契约内风险项；没有扩大领域边界。

## 阻塞意见处置

- Artifact Review 窄屏 pane 已改用动作型 `ui.tabs`，tabpanel 仍由 Run Module 管理；补齐 `tablist/tab/aria-selected/aria-controls` 与方向键行为测试。
- Run/Artifact Review 的 inline comment、Locate、Activity、binding、review open、rule toggle 等可直接映射按钮已改用 `ui.button/ui.iconButton`。
- Memory 中可直接映射的重试、刷新、评论保存/取消/删除、完成评审等 `.memory-btn` 已迁移；评论锚点、Renderer Section 和列表行等领域交互保持在 Memory Module。
- `.run-btn`、`.memory-btn`、旧 mobile tab id 和 `.artifact-review-select*` 已从生产代码清零；领域布局 class 保留。
- Artifact Review 草稿保存不再自行吞掉异常或拼装私有错误块，失败由公共按钮统一提供 `disabled + aria-busy + role=alert`，输入保留并可重试。

## 风险与建议处置

- Reference Content List 现在真实展示第三行描述、多 Badge、尾部操作、展开详情嵌套 Mount，以及 loading/error 状态。
- 新增 Content List 行为测试，覆盖尾部操作不触发行 action、嵌套 Mount 在折叠/状态切换/pagehide 时准确 dispose、loading/error 就地渲染。
- Combobox 新增 `ComboboxHandle.updateDescriptor()`，Module 可受控更新 query/value/options；选择后显示选项 label。Reference 使用该受控路径。
- 新增 Combobox 的 PageUp/PageDown/Home/End/Enter/Escape、过滤后 active descendant、外部点击关闭和选择值测试；Tabs/Segmented 新增 roving 与选中 ARIA 测试。
- Field 为 label/description 生成稳定关联，错误态提供 `aria-invalid`、`aria-describedby` 和 `role=alert`。
- Feedback 补齐 loading/read-only 的 busy/read-only 语义和可区分视觉；Reference 展示 read-only；不确定 Progress 标记状态并在 reduced-motion 下禁用动画/过渡。
- 样式门禁新增对真实 Memory/Run Module 源文件的 CI 校验，并断言被迁移的旧公共控件 class 不得回归。门禁继续允许 Feature 的领域几何和视觉自由，但禁止声明公共 Token、读取 Host 私有 Token/Selector 或用 `!important` 越界。

## 验证结果

- `npm run typecheck`：通过。
- `npm test`：531 项，530 通过，0 失败，1 项 Windows 条件跳过。
- `memsphere validate`：通过。
- `memsphere memory change validate --format json`：通过，ChangeSet `change-20260903-064024850z-d6c05ac6`。
- 真实 Chromium：Content List 折叠、Combobox End+Enter、760px 窄屏均通过；document 无横向溢出，控制台 0 error / 0 warning。

## 证据

- Reference：`http://127.0.0.1:30000/reference`
- ChangeSet：`http://127.0.0.1:30000/projects/memsphere/changes/change-20260903-064024850z-d6c05ac6`
- 桌面截图：`evidence/reference-revision-desktop.png`
- 窄屏截图：`evidence/reference-revision-narrow.png`
