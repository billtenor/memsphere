# 功能实现摘要：View 通用控件标准化与业务迁移

## 结果

本轮已把 View 的公共交互与视觉能力收敛到 Host-owned `ViewUi v1`，Reference Module 成为可直接浏览和复制契约的正式组件样板；Memory、ChangeSet、Run、Artifact Review 与 Shell Project 切换已迁移一批可直接对应的真实控件。Module 的领域 Renderer、评论锚点、步骤树、Artifact Review 分栏和自定义关系画布继续由 Feature 自己负责。

真实验收入口：`http://127.0.0.1:30000/reference`

## 采用的开发规范 Statement

- `statements/memsphere-repository-development-rules`
- `statements/memsphere-repository-testing-rules`
- `statements/memsphere-repository-delivery-rules`

采用项：保持公开契约与实现同步、测试真实行为而非只测内部结构、浏览器交互使用 Playwright、修改 System Memory 后执行普通 Store 校验与 Memory ChangeSet 校验、交付前执行完整构建和测试。

## 需求映射与关键实现

### 公共 SDK、Theme 与图标

- `src/view/view-sdk.ts`：增加 Button/Confirmation、Badge、Feedback、Tabs、Segmented、Disclosure、受控 Text/Search/Textarea/Checkbox、Select/Combobox、Progress、Card/Section 及增强 Content List 的公开描述符、句柄、严格 validator 和 `ViewUi` 方法。
- `src/view/theme.ts`：增加 info/success/warning/danger 及 on-color 语义 Token。
- `src/view/system-icon.ts`、`src/commands/view.ts`：建立规范系统图标集合与 alias，补齐 `check/dots-three/sidebar-simple/trash`，未知 system icon fail-fast。
- `src/view/ui-primitives.ts`：实现上述公共 DOM、状态、键盘与 Mount 生命周期；所有公开工厂在运行期严格校验 Descriptor，未知系统图标直接失败；系统图标统一使用 mask + `currentColor`；深色按钮 hover 保持深色与白色文字/图标；禁用态与浅色按钮可辨；Action 防重复提交并以内联 `role=alert` 呈现错误。

### Shell 与组合

- `src/view/view-runtime.ts`：Shell Header/导航复用公共图标与 Action 实现；修复 Header 文字 class 覆盖图标 class 的问题。
- `src/view/host.ts`：Settings 离开前的 Project 切换改为 `ui.confirm()`，取消/关闭恢复原选择和触发器焦点。
- 右侧栏继续由既有 `side.panel` Slot 负责，默认隐藏、由 Header action 打开；Reference 页面展示真实用法。

### Reference Module

- `modules/org.memsphere.reference/adapter/view/index.ts`：统一一级菜单、二级菜单、Content List Header 与 Page Header 的“原型 / 组件参考”命名；展示动作与确认、状态反馈、Tabs/Segmented、表单、Select/Combobox、进度、Badge、Content List、Disclosure、Card、Overlay、Side Panel 的主要状态；关系画布保持自定义业务正文。

### 真实业务迁移

- `modules/org.memsphere.memory/adapter/view/index.ts`：注入 Theme/UI；三处确认改用公共确认框；校验/评论状态改用 Badge；评审进度改用 Progress；Diff/完整内容切换改用 Segmented；保留 Memory Renderer、Diff 语义和带锚点 Section。
- `modules/org.memsphere.run/adapter/view/index.ts`：注入 Theme/UI；Run 状态改用路由 Tabs，列表刷新改用公共 IconButton；归档/废弃改用公共确认框；Artifact Review 的身份/轮次/材料/严重度/尝试改用 Select，评审意见改用受控 Textarea，投票改用 Segmented，提交改用 Confirmation；移动 Tabs 仅在窄屏挂载，回到桌面立即卸载并恢复双栏；错误页改用 Feedback。
- `modules/org.memsphere.run/adapter/view/run-detail.ts`：Slot Binding 的 skip 和保存操作改用公共 Checkbox/Button，失败以内联 Action 错误呈现，不再弹原生 alert。
- 已删除迁移控件对应的私有 select menu、旧 Tabs/Segmented、旧进度条和旧确认框 CSS；未迁移的领域布局 CSS 保留。

## 文档与 Memory

- 更新 `docs/view-plugin-api*.md`、`docs/view-plugin-guide*.md`，描述完整 UI v1 API、受控字段、确认框、状态、内容列表与边界。
- `docs/view-plugin-design*.md` 已与五层边界保持一致。
- 同步 `.memsphere/memory/concepts/memsphere-view.yaml` 与 `reserved-memory/system-memory/concepts/memsphere-view.yaml`。

## 行为与兼容性

- `ViewUi.version`、Theme v1、Slot v1 和稳定 URL 保持不变；旧 UI 方法继续可用。
- 系统图标名称由宽松字符串收紧为运行期规范集合；历史 alias 继续兼容，未知名称会在注册时明确失败。
- 表单为 Module-owned 受控状态，`update()` 保留同一 control DOM 节点，避免输入焦点、选区和 IME composition 丢失。
- Combobox 输出 `aria-autocomplete`、带可访问名称的 listbox 和 active descendant；listbox 通过 Portal 使用触发器视口坐标定位，不受 Shell overflow 裁剪，并在打开、滚动、resize 与触发器尺寸变化后通过短帧校准稳定跟随；选择后同时提交受控 query/value，键盘移动会让活动选项进入视口。
- 不确定 Progress 使用框架自有动画轨道，`prefers-reduced-motion` 下停用动画；确定与不确定进度都有可访问名称。
- 原生 `prompt` 仅保留在本期未抽象的自由文本评论、候选 Memory/Human Actor 选择；原生 `alert` 仅保留“无候选 Memory”的即时通知。所有已迁移 Action/Confirmation 错误均使用组件内反馈。
- Memory/Run 主对象列表仍保留 Module 自定义行：这些行组合 ChangeSet 评审状态、归档语义和领域导航，并非本轮可直接替换而不改变领域行为的纯公共控件；Reference 已完整证明增强 Content List 的公共能力。
- Memory 搜索框、评论 textarea 与 Run actor 多选仍保留原生领域表单，因为当前逐键重渲染、锚点和多选状态需要先改造稳定节点/焦点模型；已迁移的 Artifact Review、Binding 和 Reference 表单均使用公共受控 Field。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm test`：修订后 531 项，530 通过，0 失败，1 项因非 Windows 环境按条件跳过。
- `node dist/cli.js validate`：通过。
- `node dist/cli.js memory change validate --format json`：通过；ChangeSet `change-20260903-064024850z-d6c05ac6`；预览 `http://127.0.0.1:30000/projects/memsphere/changes/change-20260903-064024850z-d6c05ac6`。
- 真实 Chromium：`/reference` 桌面和 760px 窄屏无横向溢出；Confirmation 关闭后焦点回到触发按钮；控制台 0 error / 0 warning。
- 证据：`evidence/reference-desktop.png`、`evidence/reference-narrow.png`、`evidence/reference-confirmation.png`。

## 未验证项

- Windows PowerShell/CMD/Git Bash 专用测试在当前 Linux 环境按测试条件跳过；CI 的 Windows job 继续覆盖该项。
