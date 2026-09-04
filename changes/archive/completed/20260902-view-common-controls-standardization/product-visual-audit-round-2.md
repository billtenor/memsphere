# 产品视觉巡检修订报告

## 总体结论

首次产品验收发现的视觉问题已经按同一框架责任边界统一修复。Reference Module 的业务画布未被改造成框架组件；修订只收口 Shell、Theme、UI Primitives、Content List 与 Overlay 的公共视觉和交互契约。真实 Firefox 桌面、窄屏及交互态巡检未再发现阻塞问题，浏览器控制台 0 error / 0 warning。

## 巡检步骤

1. **桌面首屏：健康。** 一级/二级菜单、内容列表标题层级与 Header 命名一致；原型激活图标为白色，不再出现粉红误染；选中列表项的标题、说明、Badge 与尾部操作保持可读。证据：`evidence/product-visual-audit-round-2/01-desktop-top.png`。
2. **桌面完整控件区：健康。** Checkbox 与标签同行；Badge 图标和文字同行；Feedback 无图标时按钮不再被拉伸；Progress 使用框架轨道，不依赖浏览器原生外观。证据：`evidence/product-visual-audit-round-2/02-desktop-controls.png`。
3. **紧凑 Dialog：健康。** Host 新增 `compact` 几何规格，Reference 的短内容对话框不再占据 90% 视口；遮罩、关闭按钮与焦点语义保留。证据：`evidence/product-visual-audit-round-2/03-compact-dialog.png`。
4. **紧凑 Drawer：健康。** Drawer 保持全高侧栏语义，宽度由 720px 收紧到 440px；背景页面保留上下文。证据：`evidence/product-visual-audit-round-2/04-compact-drawer.png`。
5. **窄屏首屏：健康。** Shell 转为纵向区域和底部主导航；内容列表获得足够高度，选中项不再把标签挤成竖排，Header 操作仍可见。证据：`evidence/product-visual-audit-round-2/05-narrow-top.png`。
6. **标准 Select：健康。** 下拉选项由框架 Portal listbox 渲染，颜色、圆角、阴影和焦点使用 Theme Token；根据空间自动向上/向下展开，并支持方向键、Home/End、Enter 与 Escape。证据：`evidence/product-visual-audit-round-2/06-standard-select.png`。
7. **确认弹窗：健康。** 危险操作使用标准确认组件，主次动作、危险色、遮罩和关闭入口清晰；Escape 关闭后焦点返回触发按钮由自动化覆盖。证据：`evidence/product-visual-audit-round-2/07-confirmation.png`。
8. **深色按钮悬停：健康。** 主按钮悬停时背景保持深色，文字和图标继续使用白色 on-color，不再出现白字配黑图标或退成浅底。证据：`evidence/product-visual-audit-round-2/08-primary-hover.png`。
9. **右侧栏：健康。** 默认隐藏，由 Header 按钮展开；Host 负责标题、关闭、挤压布局与焦点返回，Module 只提供面板内容和通用交互。证据：`evidence/product-visual-audit-round-2/09-side-panel.png`。
10. **复杂列表选中行：健康。** Badge 与标题保持同一信息层级，描述、状态和当前项操作分区清晰，尾部操作不再挤压正文。证据：`evidence/product-visual-audit-round-2/10-list-selected.png`。
11. **普通列表行：健康。** 非当前项不再携带与当前画布有关的状态和动作，列表恢复易扫读的主副标题结构。证据：`evidence/product-visual-audit-round-2/11-list-unselected.png`。
12. **参考页卡片排布：健康。** 组件按交互、状态、结构三列分组，各卡片按内容自然高度排列，不再被同一 Grid 行强制拉长。证据：`evidence/product-visual-audit-round-2/12-compact-columns.png`。
13. **Disclosure 展开态：健康。** 标题栏以柔和强调底色和向下箭头共同表达“已展开”，正文边界清晰。证据：`evidence/product-visual-audit-round-2/13-disclosure-list-state.png`。
14. **Disclosure 收起态：健康。** 箭头转向右侧且正文隐藏，同一控件的两种状态可以直接对照辨识。证据：`evidence/product-visual-audit-round-2/14-disclosure-collapsed.png`。
15. **Combobox 可识别性：健康。** 收起时显示下拉箭头和“选择或搜索”提示，展开后箭头翻转并显示 Theme 驱动的可筛选 listbox，不再伪装成普通文本框。证据：`evidence/product-visual-audit-round-2/15-combobox-affordance.png`。
16. **真实列表栏状态：健康。** “列表栏状态”示例变为紧凑分段控件；切换“加载”后由左侧 Shell Content List 展示标准 Skeleton，正文不再嵌套一张被拉长的假列表。证据：`evidence/product-visual-audit-round-2/16-list-panel-loading.png`。
17. **列表失败态边距：健康。** 错误反馈作为列表内容区内的紧凑卡片呈现，左右各保留 12px 留白，按钮保持内容宽度。证据：`evidence/product-visual-audit-round-2/17-list-error-inset.png`。
18. **Disclosure 箭头对齐：健康。** 文案区独占弹性空间，折叠箭头贴近标题栏右侧并垂直居中，不再占据第二个弹性列而悬在中间。证据：`evidence/product-visual-audit-round-2/18-disclosure-caret-right.png`。
19. **Combobox 重新展开：健康。** 选择任一评审人后再次聚焦，listbox 恢复展示全部 3 个候选项；只有用户开始输入后才按本轮搜索词过滤。证据：`evidence/product-visual-audit-round-2/19-combobox-reopen-all.png`。

## 阻塞意见处置

- 激活导航和深色按钮图标颜色：将反色滤镜限制在图片图标，CSS mask 系统图标改为继承 `currentColor`；SSR 仅对真正支持 fill 的图标请求填充资源。
- Content List 选中行挤压：多 Badge 移入正文信息区并允许换行，尾部 Badge 和操作保留独立几何；收紧动作间距。
- 窄屏列表可用高度：提高列表区最小高度和视口占比，确保标题、筛选、分组与首项可同时识别。
- Checkbox、Badge、Feedback、Progress：修正 DOM 顺序和布局模型，并用 Theme Token 与自定义 Progress 轨道统一浏览器表现。
- Select 原生弹层：保留公开 `HTMLSelectElement` 受控 API 兼容性，新增 Host 风格 Portal listbox、边界钳制、上下翻转和键盘交互。
- Dialog/Drawer 空白与比例：在 Overlay Descriptor 增加可选 `size: "wide" | "compact"`，默认 `wide` 保持 Artifact Review 兼容，短内容示例使用 `compact`。
- Reference 卡片等高拖伸：按交互、状态、结构重组为三列自然流，卡片使用内容高度，不再共享 Grid 行高。
- Disclosure 状态不清：公共 Header 增加系统折叠箭头，展开时使用强调底色和向下箭头，收起时箭头转向右侧。
- Content List 信息堆叠：标题与单 Badge 归入 heading，只有当前复杂示例项展示第三行状态、尾部动作和展开操作。
- Combobox 输入/下拉歧义：公共控件增加下拉箭头、展开翻转和“选择或搜索”提示，保留键入筛选能力。
- 列表状态示例语义错误：移除正文内嵌的 loading/error 列表，改为通过示例控件驱动左侧真实 `content.list` 状态。
- Disclosure 箭头居中：为文案容器增加专用 class，避免通用 `span` 规则误命中图标，并用自动外边距将箭头固定在右侧。
- Combobox 重开丢失候选项：分离已选展示值与当前筛选词，聚焦重开清空临时筛选，输入事件才更新筛选词。
- Content List 失败态贴边：为列表内容区直属 Feedback 增加统一 12px 外边距，保持紧凑状态卡语义。

## 无障碍与证据边界

- 自动化验证了 Select 的 listbox/option 角色、受控值、键盘选择和展开状态；确认弹窗验证了 dialog 角色、Escape 与焦点返回；Progress 与只读状态具备相应 ARIA。
- 截图只能确认可见对比度、布局和状态辨识，不能单独证明屏幕阅读器朗读质量；完整键盘行为由浏览器集成测试覆盖，未执行人工屏幕阅读器测试。
