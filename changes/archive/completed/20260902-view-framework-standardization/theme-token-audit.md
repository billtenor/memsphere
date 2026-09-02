# Shell → Theme Token 差距审计

基线：`src/view/shell/layout.ts`（master `2c2b1445`）原本同时保留基础版、Prototype 覆盖版和四栏版三段规则。公共颜色以 `--view-*` 和 70+ 个硬编码色值混合表达，字号/圆角也由 Shell 直接决定。

## 迁移决策

| Shell 现状 | 最终决策 | 公共 Token / 保留理由 |
| --- | --- | --- |
| `--view-green` / `--view-green-strong` / `--view-green-soft` | 删除视觉私有变量 | `color.accent` / `accentHover` / `accentSoft` |
| `--view-line` 及灰色 border 常量 | 删除 | `color.border` / `borderStrong` |
| `--view-ink` / `--view-muted` 及多组文字灰阶 | 删除 | `color.text` / `textMuted` |
| `--view-canvas` / `--view-panel` 及公共 surface 色 | 删除 | `color.canvas` / `surface` / `subtle` |
| 白色反色文字、Overlay、红色 Badge、账户头像色 | 新增语义 Token | `color.onAccent` / `overlay` / `badge` / `account` |
| 卡片、Popover、Overlay 阴影 | 收敛 | `shadow.card` / `popover` / `overlay` |
| 9–23px 公共字号与 36–56px Display | 收敛为排版阶梯 | `font.sizeXs` / `Sm` / `Base` / `Md` / `Lg` / `Xl` / `Display` |
| 5–25px 公共圆角 | 收敛为尺寸阶梯 | `radius.sm` / `md` / `lg` / `pill` |
| 120ms 公共状态动效 | 收敛 | `motion.fast` |
| `--view-rail-width` / `--view-secondary-width` / `--view-list-width` | 保留为 Shell 私有 | 这是栏位几何和用户拖动状态，不是 Module 可消费的公共视觉 |
| 图标 `filter` | 保留在对应 Shell 组件 | 对单色 SVG 资产的技术转换，不是可继承的颜色值或 Module API |
| 宽、高、grid、position、overflow、responsive breakpoint | 保留在 Shell | 页面几何由 Shell 单独负责 |

## 收敛结果门禁

- `viewShellStyles` 删除历史基础/Prototype 两段，仅保留一套四栏 Shell 规则；media query 是同一规则的响应式状态，不是历史覆盖层。
- Shell 中 `--view-*` 仅允许三项几何宽度变量。
- Shell 公共 CSS 不保留十六进制或 `rgb/rgba` 颜色常量；全部来自 `--mem-view-*`。
- Shell 公共 `font-size` 和数值 `border-radius` 使用 Theme Token；圆形 `50%` 与 `0` 属于形状/几何例外。
- `ViewThemeToken`、`viewThemeCssVariables`、`viewThemeLightTokens` 键集合必须完全一致。
