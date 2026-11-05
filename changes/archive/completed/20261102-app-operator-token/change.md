---
id: 20261102-app-operator-token
completed_at: 2026-11-02
type: bug
created: 2026-11-02
run_id: run-20261102-041506z-0c2b123c
---

# 远程 View App 操作令牌传播

通过非 loopback View 访问 Evolver 时，工作台加载显示 `Settings operator token is required`。宿主 `ctx.api.invoke()` 没有携带 Settings 已验证并存储的操作令牌，所有经过该入口的 App 操作均受影响。

## 验收标准

- App 调用自动携带当前标签页已验证的操作令牌，有效令牌可加载业务数据。
- 没有令牌或令牌不正确时，后端仍拒绝受保护的请求。
- Settings 重新验证会话令牌后，后续 App 调用使用最新令牌，无需重新装载插件。
- 覆盖浏览器调用入口和非 loopback 后端鉴权的回归通过。

## 技术与测试方案

在 `api.invoke()` 每次调用时读取 `memsphere.settingsToken.v1`，非空时添加 Bearer Authorization；保持现有 App/Project 路径约束、JSON 请求和错误传播。

补充 ViewHost 浏览器集成测试和真实 View App 鉴权集成测试，先验证旧实现失败，再执行修复后的受影响测试、类型检查与构建。已有 Settings、Models 令牌处理无需改变。Memory、Changes、Run 的后端鉴权覆盖议题不纳入本次修复。

## 开发任务

- [x] 通过 bug 理解与修复方案评审。
- [x] 补充失败回归并修复统一 App 调用。
- [x] 验证浏览器、后端、构建及实际页面。
- [x] 创建 PR，跟进全部适用 CI。

## 验收结果

`node --import tsx --test test/view-host-composition.test.ts test/app-install.test.ts`：41/41 通过。新增回归覆盖有效、缺失、错误、重新验证及清除会话令牌；真实非 loopback 配置的后端测试确认鉴权仍有效。旧实现的有效令牌及令牌更新用例失败，证明回归能够复现原问题。`npm run typecheck` 与 `npm run build` 均通过。

通过 playwright-cli 在实际设置页验证操作令牌后，修复前 Evolver list 仍返回 401；仅替换本机运行时构建文件、保留回滚副本后，同一标签页刷新返回 200，错误消失。服务无需重启。修复已通过 PR #129 合入 master（e1739e5ed3bc36212ab78897e4d8d70e7caffaec）。合入后主仓库重新构建通过，运行时资产与已验证修复一致，已不再依赖临时热修复。

无 Memory 交付差异；已核对 App 远程操作令牌既有契约，本次恢复预期行为。未运行全量本地回归，改动由受影响 ViewHost/App 测试及构建覆盖，后续跟进适用 CI。原始线上检查、回归输出与流程评审证据保留在 Run 及临时工作文件，单次原始证据不随代码提交。

## 合入与收尾

[PR #129](https://github.com/billtenor/memsphere/pull/129) 已合入。默认 CI、全量跨平台 CI 和合入门禁全部通过。用户明确确认“已确认正常，可以收尾”。合入后主仓库构建通过，变更说明归档，按同一 Run 清理本轮本地开发分支并结束流程。
