# 实现 Review Round 2 意见处置

Review：`review-20260902-120356z-18eae670`
Round：`round-20260902-125934z-768d9838`

三名 Reviewer 均投票通过，无 blocking。Runner 在最终投票前继续处理了 5 个 risk 和 2 个 suggestion：

## 本轮已修复

- 系统图标稳定名、别名和 fallback 收敛到 `src/view/system-icon.ts` 单一实现；补齐 `settings → gear-six`、`run → play-circle`，两条公共渲染路径共同消费。服务器显式提供 `/assets/system-icon.js`；单元测试和浏览器测试分别验证 canonical mapping 与实际图标 URL。
- scoped 样式模板扫描不再依赖变量名 `styles/css`；`sheet` 等普通模板名同样进入 scope 检查，并补反例。
- Shell Theme 检查扩展到 hsl/命名颜色、任意非 Theme Token 字号与圆角单位；扫描前剥离 CSS 注释，选择器分组忽略函数括号内逗号；相关正反例均已补齐。
- 中英文 guide 明确 style contract 是启发式构建防错而非安全沙箱，不能证明任意动态字符串安全；同时公开生产 builtin 历史辅助文件尚未全量迁移的覆盖边界。

共享图标模块第一次接入时遗漏了服务器依赖资产路由，导致 Artifact Review 浏览器用例无法启动。该问题在最终全量复跑前被实际测试发现，补齐资产路由后：受影响 Host/Composition/Artifact Review 浏览器测试 49/49，最终全量 518 项中 517 pass / 0 fail / 1 skip。

## 接受为后续演进

- style contract 无法成为对任意动态字符串的安全证明；后续可把生产 builtin 的历史辅助源码逐步全量纳入，并考虑 AST/受控 adoptStyles API。本轮已把最简单模板改名逃逸封死，并在公开文档准确披露边界。
- contentList 当前由 Primitive 独占 input，使用 `oninput` 更新最新 descriptor 是明确实现约束；大列表的 keyed DOM 复用、listener AbortController 化属于性能/可维护性演进，不影响本轮 3 项 Reference 和既有 Module。
- Runtime Header 与通用 Primitive 的最终 DOM/class/tone 不同，按钮渲染仍保留薄适配；图标名称和 fill 集合已先收敛为单一事实来源。若未来控件能力继续扩展，再统一更深层 renderer。
