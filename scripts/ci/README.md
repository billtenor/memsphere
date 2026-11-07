# CI 执行入口

当前为 Human 明确要求的单元测试探索阶段：default 与 full 均只派发 Linux、macOS、Windows 三个单元作业，每个作业的时限为五分钟。浏览器、CLI 子进程、真实服务、文件系统协作与打包冒烟等集成测试保留在仓库，暂不进入 CI。安全扫描与 CI 文件授权保护继续运行。

- `*.unit.test.ts` 表示已经检查依赖和行为的单元测试，CI 用 `--suite=unit` 自动递归发现；命名是入口约定，不代替对测试边界的审查。
- 混合文件中的纯逻辑用例移入同目录的 `.unit.test.ts`，其集成用例保留在原文件。静态输入 fixture 可以读取；产品实际读写持久化、网络、浏览器或进程行为不属于单元测试。
- `npm run test:unit` 构建后运行全部单元文件；`npm test` 仍可在本地运行保留的全部测试。CI 不调用后者，也不调用打包冒烟。
- 不维护预计耗时，不读取 `test-durations.json`。文件按稳定顺序发现，独立文件的并发度默认取 `os.availableParallelism()`，本地可用 `--test-concurrency=N` 显式限制。
- `run-tests.mjs` 只保留独立测试进程的 Home 隔离、输出、取消及归属进程清理。实际耗时仍作为执行结果输出，供诊断使用，不参与调度。
- full 是历史触发/profile 名称，当前不代表集成测试覆盖。新的运行标题和汇总明确标为 units only；合入门禁的既有 status context 名称暂保留，以兼容已安装的规则，描述与材料必须说明只验证了单元测试。

整个目录、`.github/workflows/` 和 `test/ci/` 受 CI change guard 保护。探索提交不代表完成正式流程或验收；恢复集成 CI 时需重新明确覆盖策略。
