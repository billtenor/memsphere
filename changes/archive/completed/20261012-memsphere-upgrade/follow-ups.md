# 技术评审后续项

- 交付门禁：PR 最新 head 的全部适用 Windows CI 必须通过，重点核对 worktree、路径、权限与原子替换。当前仅有 Linux 全量及跨平台API故障路径证据，不声称本机执行Windows。
- 后续维护建议：在新增其他专用 ChangeSet intent 前，考虑将专用生命周期/策略抽离，保留统一锁内guard；本轮不扩大重构范围，不影响当前成果验收。
- 计数审计建议已修复：全量日志保存为evidence/full-tests.tap，计数规则与可复算1204/1203/1汇总在full-test-counts.json。逐文件退出码继续由full-test-results.json保存。

## 首轮 CI 与调度修正

首轮最新 head 9ffe28d 的所有功能检查、Windows 打包 Shell 与安全扫描均通过；预算检查失败（290.4s，门禁285s含15s收尾预留）。Windows project-upgrade.test.ts 实测206.75s，因未登记耗时在约21s后才调度。补充 scripts/test-durations.json 的三平台实测值（Linux73.29s/macOS77.99s/Windows206.75s），使用既有昂贵测试优先策略，保持测试成员、并发、预算门禁不变。调度契约测试通过，项目组列表确认升级测试优先启动；继续以新head完整CI验证。
