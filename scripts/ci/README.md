# CI 执行入口

测试文件通过目录自动发现和明确的层级后缀选取，不维护预计耗时表或逐文件运行名单。

| 测试范围 | default | full |
| --- | --- | --- |
| `*.unit.test.ts` | Linux、macOS、Windows | Linux、macOS、Windows |
| `*.module.test.ts` | Linux、macOS、Windows | Linux、macOS、Windows |
| OS 契约 `*.integration.test.ts` | Linux、macOS、Windows | Linux、macOS、Windows |
| 普通 `*.integration.test.ts` | Linux | Linux、macOS、Windows |
| `*.system.test.ts` | 暂不执行 | 暂不执行 |

单元、模块、集成使用不同的 CI job。OS 契约位于 `test/platform/`、`test/ci/platform/`，或在文件头声明 `// @integration-platform: native`。声明依据是被测契约，不能只因 fixture 使用文件或进程就扩大平台覆盖。进程、跨进程锁、文件系统、Git/worktree、Memory 发布、升级、Context/Review、产物归档和模型存储按职责分组，每个文件在适用平台仅执行一次。

系统层包含产品 API、浏览器、真实命令树和完整后台服务功能验证；即使文件位于 platform 目录，也不会进入集成矩阵。Windows 打包 CLI/Shell 冒烟同属系统层，暂不执行。当前运行名 `CI (unit + module + integration)`，完整 full 汇总暂停，不能用部分覆盖发布 full 成功。

- `npm run test:unit`、`npm run test:module`、`npm run test:integration` 分别构建后执行对应层。
- `run-tests.mjs --suite=unit|module|integration|system --list` 查看相应选取；默认 `regression` 只包含前三层，显式 `all` 才包含系统层。
- CI plan 拒绝未声明四种层级后缀的实际测试，并校验各系统没有漏跑或重复分配；系统测试明确排除。
- 每个测试作业保持五分钟时限。独立文件默认按 `os.availableParallelism()` 并发；保留每文件 Home 隔离、输出与归属进程清理。
- 不读取 `test-durations.json`、不按预计耗时排序。上传的实际 results JSON 仅供诊断和本次实测对比。
- 涉及真实浏览器进程清理的适配器契约会按需安装 Chromium；这与通过页面验证产品功能的系统测试是不同范围。

本目录、`.github/workflows/` 与 `test/ci/` 受 CI change guard 保护。探索提交不代表流程评审或完整验收完成。
