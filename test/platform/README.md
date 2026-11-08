# OS 边界与测试层级

这里的 `.integration.test.ts` 验证真实系统适配行为，default/full 都在 Linux、macOS、Windows 执行一次。文件头声明 `// @integration-platform: native` 的根目录集成文件遵循同一覆盖规则。

- `process/`：ACP 传输、启动失败、进程适配及执行器取消清理。
- `locks/`：跨进程锁、并发发布与进程退出后的记录一致性。
- `rewind/`：回溯进程树、进程身份与 Windows Job Object 归属。
- `filesystem/`：路径、大小写、链接、权限、文件发布与配置边界。
- `git/`：真实 Git、checkout、Project 修复及 linked worktree。
- `memory-publication/`：Memory 发布、ChangeSet 协作和版本作用域。
- `upgrade/`：升级期间冻结版本、发布及 worktree 隔离。

从混合文件拆出的 `.system.test.ts` 也可能保留在这里，但它们验证命令、产品 HTTP 或完整服务功能，归系统作业在三个系统运行，Windows 专有用例按实际适用条件执行。目录不能覆盖文件明确声明的测试层级。

CI 执行器的原生进程测试保留在受保护的 `test/ci/platform/`。Windows 专有 API 用例保留适用平台 skip，不把跳过说成该系统验证通过。
