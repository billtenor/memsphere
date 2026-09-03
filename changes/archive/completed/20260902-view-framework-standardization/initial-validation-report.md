# 初始验证报告

结论：**Review Round 1 指出的问题已修订并完成全量复验；可以重新进入工程审查。Human 产品验收尚未开始。**

> 更正：初次上报时，执行者把被截断的 `npm test` 输出误判为退出码 0；Reviewer 独立复跑发现当时实际为 512 pass / 1 fail / 1 skip。该失败并非环境问题，根因是本轮窄屏 Settings 按钮宽度不足。以下记录以修订后的真实退出码和最终汇总为准。

## 采用的测试规范

已读取并应用 `statements/memsphere-repository-testing-rules`：先执行受影响测试，再执行全量回归；View 交互使用真实 Playwright；System Memory 同时执行 Reserved Store、Project Store 和 ChangeSet 校验。

## 实际执行与结果

| 验证 | 最终结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；包含 builtin/Reference Module 样式边界门禁 |
| SDK + style contract | 通过；新增通用 Action 与不可检查 CSS 逃逸反例 |
| UI/Host + Settings 浏览器定向回归 | 19/19 通过 |
| Memory + View responsive 定向回归 | 相关 38 项通过 |
| `node --import tsx --test test/reserved-store.test.ts` | 10/10 通过 |
| `npm test`（修订后最终源码） | 退出码 0；518 项中 517 pass / 0 fail / 1 skip |
| `memsphere validate` | `memsphere validation passed` |
| `memsphere memory change validate change-20260902-115404752z-b3696ed4 --format json` | `valid: true`，issues 为空；最终 checkpoint digest 未变化 |
| `git diff --check` | 通过 |

## Playwright CLI 实际操作

- 1600×1000：一级菜单、二级菜单、标准内容列表、Header、自由正文均正常；无重叠。
- 390×844：Shell 切换为纵向公共区域和底部一级菜单；`document.scrollWidth = clientWidth = 390`。
- 列表筛选：使用真实 `keyboard.type("研究")` 逐字符输入；输入框保持 active、最终值完整、仅保留 1 个目标条目。桌面和 390×844 均通过。
- Route：键盘聚焦“研究笔记”并按 Enter 后 URL 为 `/reference?item=notes`，`aria-current=page`。
- 自定义交互：聚焦“添加节点”并按 Enter，计数 `2 → 3`。
- 搜索 Overlay：Enter 打开，Escape 关闭，焦点返回搜索按钮。
- reduced motion：模拟 `prefers-reduced-motion: reduce` 后 loading child 的 `animationName` 为 `none`。
- Console：0 error，0 warning。
- 截图：`reference-desktop-1600x1000.png`、`reference-narrow-390x844.png`。

## 首次验证与 Review Round 1 中发现并修复的问题

1. Header action 改为复用通用按钮后，success tone 的 `seal-check-fill.svg` 被降为 regular 图标。修复为 Header 保留原 fill 映射，Memory ChangeSet browser regression 随后通过。
2. 旧窄屏规则和测试把最小 812/1084px 横向画布当作响应式成功。修复为真正的 390px Shell 纵向布局，并把测试契约改为 document 不超过 viewport；Memory、ChangeSet、Settings 窄屏回归通过。
3. 面板拖拽的持久化 inline 宽度最初会覆盖窄屏行高。窄屏 grid row 改用固定 responsive 几何后，实测 secondary 112px、list 236.3px，不再受桌面拖拽值影响。
4. Round 1 发现标准列表在每次输入后重建筛选框。修复为保留稳定的列表根和 filter input，只替换内容子树；UI 合同与真实 Reference 均增加逐字符键入及焦点断言。
5. Round 1 发现 390px Settings 只有 44px 宽且旧测试仍要求横向溢出。修复为 54×48px，并把已经与新需求冲突的旧溢出断言更新为无溢出；同时修复底部栏 project popover 的裁剪问题。
6. Round 1 的非阻塞意见也已收敛：抽取通用 Action validator；增加非法 provider 更新浏览器失败路径；Reference 移除 `innerHTML` 样板；英文 guide 补齐标准列表主路径；build 同时校验 Shell/UI 样式，并拒绝静态门禁不可检查的样式注入形式。

上述均已修复并重跑相关与全量测试；当前无残留失败。

## 历史失败与环境阻塞

- 历史产品测试失败：初次上报曾遗漏 1 个由本轮引入的稳定失败；现已修复并如上更正，不归类为环境 flake。
- 环境阻塞：受限沙箱首次启动 tsx IPC、本机 HTTP server/Chromium 时出现 `EPERM`/只读 cache；按授权在本机执行后验证成功。这不是代码失败。
- ACP 历史失败不参与本阶段验证；本报告只使用当前实际命令结果。

## 未执行项与待办

- Windows PowerShell/CMD/Git Bash 集成用例在当前 Linux 环境由测试自身 skip；未改动该能力，非本轮阻塞。
- Human 产品负责人尚未验收运行中的 Reference Module；在明确通过前，Change 保持 `status: doing`，不归档。

## Memory ChangeSet 证据

- ID：`change-20260902-115404752z-b3696ed4`
- 状态：valid
- View：在正式 View 中打开相对路由 `/projects/memsphere/changes/change-20260902-115404752z-b3696ed4`
