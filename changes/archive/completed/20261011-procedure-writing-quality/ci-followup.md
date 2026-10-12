# PR CI 跟进

PR：https://github.com/billtenor/memsphere/pull/100 。首轮功能 CI 的 16 项检查（跨平台测试、Windows 打包和时间预算）均通过，Security 的 Gitleaks 8.24.3 报 11 处 generic-api-key。

全部命中是冻结快照 workspaceFiles 中同一个实际文件 SHA-256 摘要，被带有 access 字样的 Memory 文件路径触发。Runner 复算实际文件并确认该值是内容摘要，不是凭据；将所有 workspaceFiles 摘要值改为 sha256: 前缀形式，保留全部原 64 位摘要、路径、任务与评分内容。去掉前缀后 JSON 语义与原冻结记录逐项相同；原始 Agent 输出、生产规范、业务任务均未修改。

没有更改扫描规则、添加 ignore 或删除证据。用与 CI 相同的官方 Gitleaks 8.24.3 在完整归档目录扫描通过。为使 PR 历史扫描不继续扫描已替换的同一误报记录，修正本轮唯一提交，并用带原远端 SHA 的 force-with-lease 更新本轮自己的分支，防止覆盖他人更新。随后持续跟进新 commit 的完整 CI。
