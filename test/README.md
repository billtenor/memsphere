# 测试层级

| 层级 | 文件入口 | 被测契约 |
| --- | --- | --- |
| 单元 | `*.unit.test.ts` | 小函数、单个类或局部算法；可以使用 fake/mock |
| 模块 | `*.module.test.ts` | 真实业务模块协作；系统能力由共享 fake 隔离 |
| 集成 | `*.integration.test.ts` | 多模块协作及真实存储、锁、Git、进程、网络客户端等系统适配契约 |
| 系统 | `*.system.test.ts` | 通过命令树、公开 API、浏览器界面或完整后台服务入口验证子系统功能 |
| 端到端 | `e2e`（预留，尚未建设） | 从用户目标出发，验证完整任务及跨子系统用户旅程 |

完整测试模型采用五层，当前只建设前四层；本轮不新增端到端套件或 CI 作业。

分类按验证范围和实际调用链判断。HTTP 客户端访问测试服务器验证适配器协议，属于集成；启动产品 HTTP 服务并验证公开 API 结果，属于系统。真实进程用于验证锁或进程身份，不自动成为系统测试；通过 CLI 参数、环境、输出和持久化结果验证完整命令功能，属于系统。名字含 CLI/View 不决定层级。

混合文件按用例拆开，保留原有断言、超时和平台专有条件。测试开始前构造完整 Home/Project/Run/Review 等环境，不代表可以把对外功能用例归为集成；真实环境和数据准备保留在系统层，后续单独设计执行方式。

`test/support/` 提供内存 Store、Provider、时钟、进程观察和 View 状态替身。`test/helpers/module-context.ts` 装配真实业务模块。各场景独立持有记录和依赖；`reopen()` 创建共享记录的独立句柄，不共享测试注入的方法覆盖。

- `npm run test:unit`、`npm run test:module`、`npm run test:integration`、`npm run test:system` 分别构建并运行对应层。
- `node scripts/ci/run-tests.mjs --suite=<layer> --list` 查看自动发现的文件；`--suite=system --list` 只列出系统测试，不执行。
- `npm test` 和执行器默认的 `regression` 范围包含前三层，不运行系统测试。`--suite=all` 仅用于显式选择包括系统在内的全部文件。
- CI 各层独立执行。default 的单元、模块及适用集成作业限时五分钟；full 运行相同作业时仍为五分钟。full 额外运行的 macOS/Windows 普通集成、三个平台的系统/端到端及独立 Windows 打包 Shell 作业限时三十分钟。default 不运行系统/端到端和打包作业；full 汇总要求全部适用层级成功。

OS 契约集成在 `platform/` 中，或通过文件头 `// @integration-platform: native` 显式声明；业务职责决定作业分组。default/full 都在 Linux、macOS、Windows 各运行一次，平台专有用例保留 skip。普通集成 default 在 Linux、full 在三个系统运行。CI 校验每个应跑文件在各适用系统恰好分配一次，并拒绝缺少层级标记的新文件。
