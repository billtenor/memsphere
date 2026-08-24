# 第一轮修改摘要

- 接受研发与架构的阻塞意见，补齐废弃状态机关键边界自动化：done/readOnly/v1、非法 Actor、超长原因、report 竞争、Human Review submit 竞争、Schema 草稿保留与 finalization 拒绝。
- 将 Agent Review 测试改为 running Attempt，验证 worker PID 终止器调用、终止失败 warning 不回滚，并覆盖 Agent CLI ready/comment/submit/fail/retry 迟到写入拒绝。
- 接受架构非阻塞建议，修正 cancelled Human Assignment 的只读文案。
- 接受测试风险意见为后续项：原生 Windows `taskkill /T /F` 实机验证仍未执行，继续在材料中明确披露。
- 修订后验证：定向 137 项通过；全量 410 total / 409 passed / 0 failed / 1 Windows-only skipped；typecheck、build、Project / reserved Memory validate 与 `git diff --check` 均通过。
