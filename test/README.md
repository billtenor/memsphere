# 测试层级

| 层级 | 文件入口 | 被测契约 |
| --- | --- | --- |
| 单元 | `*.unit.test.ts` | 小函数、单个类或小范围算法；可以使用 fake/mock |
| 模块 | `*.module.test.ts` | 真实业务模块及其协作；在 Store、内容读取、时钟、进程观察等系统边界注入 fake |
| 集成 | 其余 `*.test.ts` | 真实文件系统、锁、Git/worktree、CLI/Shell、HTTP、ACP 进程或浏览器边界 |

区别前两层的是被测范围，不是有没有 fake。模块测试保留真实模型 Runtime、序列化、评审与业务状态转换；静态 fixture 可以读取，产品的持久化读写、服务和进程不能作为模块测试的前置条件。

`test/support/` 提供可复用实现，`test/helpers/module-context.ts` 装配真实 ContextControl/GraphRuntime 与内存 Store、时钟、进程观察。各场景独立持有记录和依赖；`reopen()` 创建新句柄，共享记录但不共享测试注入的方法覆盖。模型校验器只共享不可变编译结果。

混合文件按用例拆分：业务恢复、产物依赖、评审、回溯放模块层；实际落盘重开、文件损坏、跨进程锁、身份及退出证明保留集成层。保留原有产品断言，不把真实系统行为改成 fake 的证明。

- `npm run test:unit`、`npm run test:module` 分别构建后运行全部对应文件。
- `node scripts/ci/run-tests.mjs --suite=unit --list` 与 `--suite=module --list` 查看自动发现的文件。
- `--suite=integration` 查看第三层；`npm test` 保留本地全部入口。
- 当前探索 CI 独立执行三系统单元、模块作业。集成暂不自动执行，可手工启用 `include_integration`；快速层成功不代表 full 成功。
