# 技术评审后续项

- 交付门禁：PR 最新 head 的全部适用 Windows CI 必须通过，重点核对 worktree、路径、权限与原子替换。当前仅有 Linux 全量及跨平台API故障路径证据，不声称本机执行Windows。
- 后续维护建议：在新增其他专用 ChangeSet intent 前，考虑将专用生命周期/策略抽离，保留统一锁内guard；本轮不扩大重构范围，不影响当前成果验收。
- 计数审计建议已修复：全量日志保存为evidence/full-tests.tap，计数规则与可复算1204/1203/1汇总在full-test-counts.json。逐文件退出码继续由full-test-results.json保存。
