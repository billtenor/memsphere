# 敏捷需求开发交付报告

## 交付结论

“View 通用控件标准化与业务迁移”当前迭代已按确认的需求契约完成实现、验证和技术评审。框架统一负责公共控件的视觉、状态、交互、无障碍与生命周期，Memory、Run、ChangeSet 和 Artifact Review 保留领域数据与自由正文；Reference Module 作为真实 `/reference` 组件参考页保留。

第 5 轮技术评审中，研发、测试、架构师均投票通过。首次产品验收随后提出“修复本次完整视觉巡检发现的问题”；本次修订已处理首批问题及逐项复验反馈，并以 19 个真实浏览器状态重新完成桌面、窄屏与交互态巡检。Human 最新复验认为当前版本“好像可以了，非常好”，随后要求补充的公共控件使用手册也已完成并纳入交付。

## 交付内容

- 扩展公开 `ViewUi v1`：Button/Confirmation、Badge、Feedback、Tabs、Segmented、Disclosure、受控 Form Field、Select/Combobox、Progress、Card/Section 和增强 Content List；公开描述符具备严格运行时校验与可清理 Mount 生命周期。
- 扩展 Theme v1 Token 和公共样式：统一排版、颜色、间距、圆角、焦点、禁用、悬停、动效与 on-color；深色按钮文字和图标一致，悬停保持可读，禁用态可辨。
- Reference Module 在正式 `/reference` 展示全部本期公共组件和关键状态；一级导航、二级菜单、列表栏和 Page Header 的页面命名统一；关系画布继续作为 Module 自定义正文示例。
- 迁移 Memory、ChangeSet、Run 与 Artifact Review 中直接命中的按钮、确认、Badge、反馈、Tabs、Disclosure、表单、进度和公共容器，删除命中范围内重复公共 CSS；领域 Renderer、协议和业务语义不变。
- Content List 支持上上级/上级标题、搜索、分组、选中、次级信息、Badge、尾部操作、展开内容和加载/空/错误状态。
- Combobox listbox 使用 Portal 脱离 Shell 裁剪上下文，通过触发器视口坐标定位，并在打开、滚动、resize 和触发器尺寸变化后短帧校准；自动化等待几何条件真实收敛。
- 产品验收修订统一修复了系统图标 on-color、选中列表项几何、Checkbox/Badge/Feedback/Progress 排列、窄屏列表高度、Select 弹层和 Overlay 尺寸；`overlay` 新增兼容默认值为 `wide` 的 `compact` 几何规格，Reference 示例使用紧凑 Dialog/Drawer，Artifact Review 保持原有大尺寸布局。
- 复验追加修复了 Reference 三栏卡片等高拖伸、Disclosure 缺少展开指示、复杂 Content List 行信息堆叠和 Combobox 被误认作普通输入框的问题；“列表栏状态”现在直接切换左侧真实 Shell 列表的正常/加载/失败状态，不再在正文嵌套伪列表。
- 后续逐项复查又校正了 Disclosure 箭头的右侧对齐、Combobox 重新展开时错误沿用已选文本过滤，以及 Content List 失败反馈贴满列表边界的问题。
- Memory 与 Run 最终复验修复了 Header 面包屑、Segmented 文字居中、刷新/归档等纯图标按钮尺寸与悬停说明；普通 Memory 详情不再显示 ChangeSet 评论入口，“其他记忆变更”列表被移除，记忆变更统一从二级菜单进入。
- 中英文 View Plugin API/Guide、System Memory 与当前 Project Memory 已同步。
- 新增中英文《View 公共控件使用手册》，按 Slot 选择、最小代码、受控状态、生命周期、Theme 边界、反例与交付检查组织，并从 Plugin Guide/API 链接到正式 `/reference` 和 Memory/Run 真实源码。

## 验证结果

- `npm run typecheck`：通过。
- Reference 浏览器测试连续 3 轮：每轮 18/18 通过。
- 产品验收修订的直接影响测试：73/73 通过，覆盖 Artifact Review、ViewHost 组合、Reference 公共控件、Memory、Run、响应式与样式边界；最终边界修订后 `view-fault-isolation-browser` 2/2、`view-responsive` 21/21 再次通过。
- 最终 `npm test`：531 项，530 通过，0 失败，1 项 Windows 专属测试在 Linux 条件跳过；pretest build 通过。
- `npm run typecheck`、`npm run build`、`memsphere validate` 与 `git diff --check`：通过。
- 首次在受限沙盒内执行全量集成测试时，本机回环监听被宿主以 `listen EPERM` 拒绝并导致 ACP 连接连带失败；保持原测试和断言不变，在沙盒外重跑后 531 项全量结果如上。
- 真实 Firefox：1600×1000 与 760×900 下完成 19 个关键状态巡检；Select/Combobox 具有明确弹层线索并支持键盘选择，Combobox 重开恢复全部选项，Disclosure 展开态和右侧箭头可辨，列表状态作用于真实列表栏且失败卡留有边距，窄屏无文字竖排，深色按钮和激活导航图标保持 on-color，控制台 0 error / 0 warning。
- 视觉巡检报告与证据：`product-visual-audit-round-2.md`、`evidence/product-visual-audit-round-2/01-desktop-top.png` 至 `19-combobox-reopen-all.png`。

## Memory 差异

- ChangeSet：`change-20260903-064024850z-d6c05ac6`。
- 变更级校验：通过。
- Base Revision：`98669a5399167baf383e7c58df5ca1637a2e6f53`。
- Content Digest：`dc6411711d17f57347f7384d38c62373e02f6c149b6314b7d078e2891c2728e9`。
- View 入口：`http://127.0.0.1:30000/projects/memsphere/changes/change-20260903-064024850z-d6c05ac6`。

## 验收结论

- 十项需求验收标准均已有代码、自动化或真实浏览器证据覆盖；首次产品验收及后续逐项复验提出的全部阻塞视觉与交互问题均已处置。
- 第 5 轮技术评审：研发通过、测试通过、架构师通过；阻塞意见 0。
- Human 已完成最新页面复验并给出正向结论；新增公共控件手册完成后，当前最终报告提交 Human 与 Product Agent 做流程内正式产品验收。

## 后续范围与残留问题

- 后续根据第三方 Module 真实使用反馈扩展 UI v2、批量迁移和废弃策略，另立需求。
- Combobox 后续健壮性增强：以有限窗口的几何稳定判定替代经验帧数，增加触发器脱离文档/零尺寸保护；当前事件、Observer 和短帧校准已覆盖本轮产品页面与契约。
- Windows PowerShell/CMD/Git Bash 专属用例需由 Windows CI 覆盖；当前 Linux 环境没有历史失败或环境阻塞。
