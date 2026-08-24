# 第二轮修改摘要

- 接受测试评审的阻塞意见，修复废弃 Run 的 Schema 草稿区仍暴露最终提交入口的问题。
- `schemaWriting` 对非 running Run 返回 `readOnly: true`；View 对此状态展示“未接纳的只读草稿”，不展示全局调整入口或 `memsphere run report` 命令。
- 草稿正文及 `awaiting_finalization` 状态继续保留，满足“保留中间产物、废弃后禁止继续写入”的契约。
- 新增 API 与浏览器层回归断言，并通过 Playwright CLI 真实浏览器验证“未接纳的只读草稿”可见、正文保留、归档仍独立可点、页面无 `memsphere run report`；定向测试通过，全量测试 410 total / 409 passed / 0 failed / 1 Windows-only skipped，typecheck、build、Memory / ChangeSet validate 与 `git diff --check` 均通过。
- Windows 原生 `taskkill /T /F` 实机验证仍作为已披露的非阻塞后续项。
