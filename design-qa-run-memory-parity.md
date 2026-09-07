# Run 与记忆视图样式一致性 QA

## 审核范围

- Run 列表页
- Run 详情默认折叠态
- 单步骤与产物展开态
- 条件分支展开态
- 820px 窄屏布局

## 调整结果

- 详情元信息由大块胶囊组收敛为安静的单行状态信息。
- 规则、运行时评审绑定、步骤字段与产物统一为轻量披露控件。
- Run 的规则标题统一为记忆页使用的“必须遵守”，建议标题统一为“建议遵守”。
- 步骤内实际结果的披露标题统一为“产出物”，右侧仍展示具体产物名称。
- 运行时评审绑定的展开箭头移动到标题前方，与其他披露控件保持一致。
- 顶层“必须遵守”、运行时评审绑定、步骤内“必须遵守”和“产出物”共用同一折叠行规格：28px 高度、12px/600 字体、5px 间距、4px 圆角及一致的前置箭头占位。
- Memory Procedure 与 Run 现在共用 `mem-content-flow-*` 和 `mem-content-disclosure-*` 展示原语；扩展包中的字号、标签、步骤间距、分支连线和折叠行只维护一套规则，Run 仅保留运行态元信息、评审绑定和产出物结果的增量样式。
- 执行流程标题隐藏，步骤采用与记忆页一致的 36px 类型标签、13px 正文和 10px 间距。
- 默认步骤仅显示动作与产物名称；当前步骤直接把原有类型标签替换为强调色的“当前步骤”，不额外叠加标签。实际产出物展开后显示 file、契约校验、时间，不再使用元信息浮窗；步骤契约的补充信息仍支持悬停或键盘聚焦。
- 产物展开态移除外层实线卡片，内容与步骤左边缘对齐。
- 条件分支移除底色和粗边，改为低透明度的包含关系竖线与短横线。
- 窄屏时产物名称与步骤正文对齐，无横向溢出。

## 验证证据

- `run-parity-10-default-final.png`：最终默认折叠态
- `run-parity-06-artifact-final.png`：产物展开态
- `run-parity-07-branch-final.png`：分支展开态
- `run-parity-09-narrow.png`：820px 窄屏态
- `memory-run-parity-comparison.png`：记忆与 Run 同屏对照
- `run-copy-and-disclosure-aligned.png`：文案及展开箭头一致性
- `run-disclosure-row-parity-final.png`：四种折叠行最终一致性
- `run-disclosure-inner-parity-final.png`：运行时评审绑定与规则、产出物的箭头占位和文字起点一致性

## 自动验证

- `node --test --import tsx test/view-package-borderless.test.ts`
- `npm run build`
- 浏览器控制台：0 errors，0 warnings
- 820px：`scrollWidth === clientWidth`，默认打开的 Run disclosure 数量为 0

## 结论

通过。Run 的默认态、展开态、分支层级、产物披露和窄屏布局已经统一到记忆页的视觉语言。
