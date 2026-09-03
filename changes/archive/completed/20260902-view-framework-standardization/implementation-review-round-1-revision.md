# 实现 Review Round 1 修订摘要

Review：`review-20260902-120356z-18eae670`
Round：`round-20260902-120356z-2a1710bd`

## Blocking 修订

1. **标准列表逐键输入丢焦点**
   - `src/view/ui-primitives.ts` 不再在 provider 更新时替换整个列表根；保留原 filter input，仅重建 `.mem-view-list-content`。
   - `test/view-host-composition.test.ts` 的 UI 合同和真实 Reference 两条浏览器测试都改用 `page.keyboard.type()`，断言 active element、完整值和最终过滤结果。
   - Playwright CLI 在 1600×1000 与 390×844 实测输入“研究”：`active=true`、`value=研究`、items=1。
2. **全量测试失败与错误报告**
   - `src/view/shell/layout.ts` 把窄屏 Settings 恢复为 54×48px，并允许底部栏项目菜单越过 sidebar 边界显示。
   - `test/view-settings-browser.test.ts` 保留 ≥54×44 的触控断言；只将与新验收标准冲突的“必须横向溢出”旧断言改为“不得横向溢出”。
   - 修订后定向浏览器回归 19/19；最终 `npm test` 退出码 0，518 项中 517 pass / 0 fail / 1 skip。
   - `initial-validation-report.md` 与汇总已明确记录初次误判，不把稳定失败包装成环境问题。

## Risk / Suggestion 修订

1. **通用 Action validator**：`src/view/view-sdk.ts` 新增 `isActionDescriptor()`；列表项、按钮和其他非 Header 场景不再复用 Header validator，Header 只在通用 Action 上追加 tone 校验；SDK 测试锁定该边界。
2. **非法 provider 更新**：Runtime 捕获更新错误、释放当前列表并在列表宿主显示局部诊断；新增浏览器失败路径用例，证明不会静默保留部分旧列表。
3. **Reference 的 `innerHTML` 样板**：hero 与 canvas 全部改用 `createElement`/`textContent`，避免 Reference 示范不安全的数据拼接模式。
4. **英文开发主路径**：`docs/view-plugin-guide.en.md` 已补齐 `ctx.ui.contentList()`、既有 `content.list` 注册方式、五层职责与禁止事项，与中文 guide 对等。
5. **样式门禁**：`scripts/build-view-assets.mjs` 在 build 中校验真实 `viewShellStyles` 与 `viewUiStyles`；scoped Module 对数组 join、`CSSStyleSheet.replaceSync` 与外置 CSS import 等不可检查形式直接失败，且新增反例测试。
6. **系统图标集合**：中英文 API 文档固定 Primitives 支持的 25 个稳定名称、5 个兼容别名及未知名称回退行为，避免静默行为无契约。

## 最终验证

- `npm run typecheck`：通过。
- `npm run build`：通过，含 builtin、Reference、Shell、UI 样式门禁。
- ViewHost + Settings 浏览器定向回归：19/19。
- `npm test`：517 pass / 0 fail / 1 skip，退出码 0。
- `memsphere validate`：通过。
- `memsphere memory change validate change-20260902-115404752z-b3696ed4`：通过；base revision `2c2b1445f87d0b074f2835e99e7c4327fd8dd427`。
- Playwright CLI：桌面与窄屏逐字符筛选保持焦点；390px document overflow=0；Settings 54×48；console 0 error / 0 warning。
