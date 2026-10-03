# PR CI 跟进

PR：https://github.com/billtenor/memsphere/pull/84 。

## macOS 临时目录路径

首个提交 `20b0eb8` 的 macOS 作业在两个新测试的临时目录断言处失败。GitHub 作业：https://github.com/billtenor/memsphere/actions/runs/37123548145/job/111204239046 。

macOS 临时目录可以通过 `/var` 别名访问，而 ESM 模块加载和整理服务使用 `realpath` 得到的 `/private/var` 实际路径。原测试按字符串前缀比较这两种写法，因此把同一位置误判为目录外。

- 整理测试把 fixture 根规范化，并将宽泛的备份前缀断言改为“指定备份目录 + 本次 operationId”的精确路径相等。
- 独立 tarball 测试将解包根及模型源路径规范化，保留“必须来自解包资产目录”的断言，并增加目录分隔符边界，拒绝相似名称的兄弟目录。
- 修复仅涉及测试与本记录，没有跳过测试、改变产品行为或修改 Memory 内容。

Linux 临时目录符号链接可复现原断言失败；规范化后通过，并保留来源目录约束。修复后，别名环境中的整理测试 13/13 通过，独立 tarball 测试 1/1 通过。`npm run typecheck` 和包含 clean build 的 `npm test` 通过：937 项，936 通过、0 失败、1 项 Windows 专用测试在 Linux 跳过。完整日志为 `/tmp/memsphere-pr84-path-fix-tests.log`。提交前确认没有新增 Memory 差异，已验收的最终 checkpoint 保持不变。最终 PR 提交及全部 CI 结果记录于本 Run 的“GitHub PR 创建结果”Artifact。


## Windows 原始资产字节

在因后续提交而结束的首轮 Windows 作业日志中，12 个整理测试和 1 个独立 tarball 测试均报告模型原文不匹配固定基线。Git 的 `core.autocrlf=true` 将仓库原始 JSON 的 LF 转为 CRLF；隔离检出复现时八项源文件全部变化，0/8 匹配原始 SHA。

新增两条仅针对发行模型 JSON 和指定历史原件的 `.gitattributes` `-text` 规则，禁止 Git 对这些字节敏感资产进行换行转换。没有修改原 JSON、固定基线 SHA 或运行时读写，不放宽原文保护；普通文本继续遵守用户的 Git 换行设置。

新增真实 Git 临时仓库回归：在 `core.autocrlf=true` 下 add/checkout-index，22 份实际 JSON、带 BOM 的 LF/CRLF 样本均逐字节保持；普通文本正常转换；无属性的对照成功复现原始问题。独立只读复验同时确认八项源 SHA 和八项历史原文均匹配。

该修复的受影响测试 21/21 通过；typecheck 与包含 clean build 的完整回归通过：938 项，937 通过、0 失败、1 项 Windows 专用测试在 Linux 跳过。日志为 `/tmp/memsphere-pr84-byte-assets-affected.log` 与 `/tmp/memsphere-pr84-byte-assets-full.log`。Memory 内容没有新增差异。
