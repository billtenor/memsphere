# CI 执行入口

单元、模块与集成测试使用不同的 CI job，所有测试文件仍由目录自动发现，不维护耗时表或逐文件运行名单。

| 测试范围 | default | full |
| --- | --- | --- |
| `*.unit.test.ts` 单元测试 | Linux、macOS、Windows | Linux、macOS、Windows |
| `*.module.test.ts` 模块测试 | Linux、macOS、Windows | Linux、macOS、Windows |
| `test/platform/`、`test/ci/platform/` 原生集成契约 | Linux、macOS、Windows | Linux、macOS、Windows |
| 其他集成/模块协作测试 | Linux | Linux、macOS、Windows |

当前按 Human 指示进行快速层探索，自动 CI 只执行单元和模块；第三层集成及 Windows 打包作业暂缓，手工设置 `include_integration=true` 才启用上表中的集成覆盖。未执行集成时汇总跳过，运行名为 `CI (unit + module)`，不能作为 full 门禁证据。

`platform` 目录明确表示被测契约有操作系统差异风险。进程生命周期、跨进程锁、原生 CLI、回溯进程归属、文件系统、Git/worktree、Memory 发布与项目升级分别分组；普通浏览器集成按模型/设置与内容/评审界面分组，每个文件在适用系统上只分配一次。普通浏览器或 HTTP 业务契约不会只因使用浏览器或通过 Git 准备 fixture 就归为原生测试。Windows 专有 API 用例保留适用平台限制，不把其他系统跳过说成验证通过。

- `npm run test:unit` 构建后运行全部单元文件；`npm test` 保留本地全部测试入口。
- `node scripts/ci/run-tests.mjs --suite=unit --list` 查看单元选取；`--suite=module` 查看全部模块文件；`--suite=integration` 查看第三层测试；`--suite=platform` 查看原生契约。CI 的业务分组由 `ci-plan.mjs` 组合相应子集。
- 每个测试和打包冒烟作业保持五分钟时限，独立文件的并发度默认取 `os.availableParallelism()`，可用 `--test-concurrency=N` 显式限制。不维护或读取 `test-durations.json`，实际耗时只是诊断结果，不参与排序。
- `run-tests.mjs` 保留每个测试进程的 Home 隔离、输出与归属进程清理。
- Windows 包安装与 PowerShell/CMD/Git Bash 冒烟属于 Windows 专用集成作业，独立于单元测试；其他系统的原生启动器由对应平台集成契约覆盖。
- full 汇总必须同时确认三系统单元和模块、全部集成及 Windows 打包作业成功；不能沿用先前 unit-only 探索结果证明集成覆盖。

整个目录、`.github/workflows/` 和 `test/ci/` 受 CI change guard 保护。探索提交不代表正式流程或验收已经完成。
