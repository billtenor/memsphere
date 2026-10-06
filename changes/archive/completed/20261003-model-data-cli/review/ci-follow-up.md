# PR #85 CI 修复跟进

2026-10-06，Human 要求持续跟进至所有 CI 成功。沿用 PR #85、分支 codex/model-data-cli；后续 CI 任务记录于 Run run-20261006-065351z-1d8ac4fa，原敏捷 Run 已完成，不改历史冻结评审产物。

## 初次失败及修复

原 head 85aed8668eea5514e3d1acaf0a44a19391a1d892，CI Run 37424003929、Security Run 37424003951。

- macOS 系统临时目录的 /var 前缀实际指向 /private/var；模型修改把可信 Project 根路径中的别名误报为模型目录内路径转向。模型写入现在只规范化可信 Project 根前缀，日志以真实根与目标路径保存；模型存储内部符号链接及越界目标仍拒绝。添加真实目录别名下成功写入及失败回滚两个回归契约。
- 跨进程测试、故障注入和路径断言使用 mkdtemp 原始路径，实际 Store 使用 fs.realpath 后的路径。macOS 前缀和 Windows 临时目录别名使 IPC 等待或故障注入没有命中真实调用。统一测试 fixture 与 Worker 的实际路径，保持原成功、冲突、故障和进程中断断言，不跳过测试。
- Security 的三个 generic-api-key 命中是不可变人工 CLI 验收记录中的文件 SHA-256。逐项与原 commit 的实际 blob 字节计算结果一致，确认不是凭据。只加入原 commit、原文件、原规则、原行号三个精确历史 fingerprint；不扩展文件或规则级 allowlist，原验收证据保持不变。

## 本地验证与继续条件

- 受影响五个文件：73 项测试全部通过，0 失败，含新增两项 Project 别名回归。
- typecheck、build、构建 CLI 和真实安装包冒烟通过。普通 Memory validate 通过。
- Project 冒烟初次和完整回归的前置构建重叠，dist 暂时移除导致 ENOENT；构建完成后复验通过。属于本地验证调度错误，保留原失败日志，没有据此改产品实现或降低断言。
- Gitleaks 本地按原 PR commit 范围与相同配置重新扫描通过（本地版本 8.30.1，GitHub Action 为 8.24.3）；仍需由 GitHub Security 确认。
- 完整 npm test 串行回归正在执行；新 head 的三平台主套件、Node 20 锁/CLI、Windows 安装包与 Security 结果以 GitHub 为准，尚未宣布全部 CI 成功。

本次未修改 Memory、命令契约或已批准范围。现有最终 Memory Checkpoint change-20261005-031024825z-a1b5f8c3 的内容仍匹配，passed，digest 076c3c71256feb93c6754b44fecaa97d0b461b2da54b15da7bc1321a10a1f04e，View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3 。不创建空 ChangeSet。

修复 commit 推送后继续观察最新 head，发现新问题则修复并复验；只有最新 head 的全部检查成功才上报 CI 跟进 Run 完成。不合并 PR、不发布 GitHub review/comment。
