# 原生平台集成契约

这些测试的被测行为依赖操作系统，不只是 fixture 在使用磁盘或进程，因此 default 与 full 都在三个系统执行。

- `process/`：真实 ACP 启动器、daemon、执行器归属进程与取消清理。
- `locks/`：跨进程锁、并发发布及进程退出后的记录一致性。
- `cli/`：原生命令启动、评审 Session 绑定及 CLI 进程边界。
- `rewind/`：回溯后的 worker/Provider 进程树、进程身份与 Windows Job Object 归属。
- `filesystem/`：路径、大小写、链接、权限、文件系统发布及配置边界。
- `git/`：真实 Git、checkout 过滤、Project 生命周期、修复及 linked worktree。
- `memory-publication/`：Memory 发布、ChangeSet 协作、检查点凭据与跨工作区作用域。
- `upgrade/`：项目升级、历史内容迁移及升级期间的 worktree 隔离。

CI 执行器自身的原生进程测试保留在受保护的 `test/ci/platform/`。对应纯逻辑用例已拆回 `.unit.test.ts`，不重复运行。仅使用 Git 准备数据的浏览器业务测试仍归普通集成层；Windows 专有分支保留平台 skip。
