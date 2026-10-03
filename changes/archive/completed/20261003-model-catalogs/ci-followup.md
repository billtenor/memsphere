# PR CI 跟进

PR：https://github.com/billtenor/memsphere/pull/84 。

首个提交 `20b0eb8` 的 macOS 作业在两个新测试的临时目录断言处失败。GitHub 作业：https://github.com/billtenor/memsphere/actions/runs/37123548145/job/111204239046 。

macOS 临时目录可以通过 `/var` 别名访问，而 ESM 模块加载和整理服务使用 `realpath` 得到的 `/private/var` 实际路径。原测试按字符串前缀比较这两种写法，因此把同一位置误判为目录外。

- 整理测试把 fixture 根规范化，并将宽泛的备份前缀断言改为“指定备份目录 + 本次 operationId”的精确路径相等。
- 独立 tarball 测试将解包根及模型源路径规范化，保留“必须来自解包资产目录”的断言，并增加目录分隔符边界，拒绝相似名称的兄弟目录。
- 修复仅涉及测试与本记录，没有跳过测试、改变产品行为或修改 Memory 内容。

Linux 临时目录符号链接可复现原断言失败；规范化后通过，并保留来源目录约束。修复后，别名环境中的整理测试 13/13 通过，独立 tarball 测试 1/1 通过。`npm run typecheck` 和包含 clean build 的 `npm test` 通过：937 项，936 通过、0 失败、1 项 Windows 专用测试在 Linux 跳过。完整日志为 `/tmp/memsphere-pr84-path-fix-tests.log`。提交前确认没有新增 Memory 差异，已验收的最终 checkpoint 保持不变。最终 PR 提交及全部 CI 结果记录于本 Run 的“GitHub PR 创建结果”Artifact。
