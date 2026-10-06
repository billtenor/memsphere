# PR #86 CI 跟进

## 干净 Runner 的 Git 身份

首轮 Ubuntu CI 在 9 项 App 测试中报 `Git identity is required`。测试只设置 GIT_AUTHOR/GIT_COMMITTER 环境变量，而 Managed Project 的创建前置检查读取 git config；本机已有 Git 身份掩盖了该依赖。

修复在每个 App fixture 的临时目录写入专用 gitconfig，通过 GIT_CONFIG_GLOBAL 传给当前进程及 CLI 子进程，finally 恢复原值并清理临时目录。不写用户全局配置，不降低产品身份检查，不删减测试断言。

验证：

- 修复前使用 GIT_CONFIG_GLOBAL=/dev/null 和 GIT_CONFIG_NOSYSTEM=1 复现失败，日志 /tmp/app-ci-reproduce.log。
- 修复后在相同隔离条件下 App 专项 11/11 通过，日志 /tmp/app-ci-isolated-tests.log。
- typecheck 通过；npm test 完整回归 1111 项，1110 通过、0 失败、1 Windows 平台跳过，日志 /tmp/app-ci-fixed-full-tests.log。
- 本次仅修改测试前置环境，无 Memory 差异。

跨平台最终结果以 GitHub PR 最新提交的 CI checks 为准。
