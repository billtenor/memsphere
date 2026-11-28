# CI 执行入口

测试文件通过目录自动发现和明确的层级后缀选取，不维护预计耗时表或逐文件运行名单。

PR 和手动运行的缺省选择为 default；显式选择 full 或向 master 推送时运行 full。

| 测试范围 | default | full |
| --- | --- | --- |
| `*.unit.test.ts` | Linux、macOS、Windows | Linux、macOS、Windows |
| `*.module.test.ts` | Linux、macOS、Windows | Linux、macOS、Windows |
| OS 契约 `*.integration.test.ts` | Linux、macOS、Windows | Linux、macOS、Windows |
| 普通 `*.integration.test.ts` | Linux | Linux、macOS、Windows |
| `*.system.test.ts` | 不运行 | Linux、macOS、Windows |
| `*.e2e.test.ts` | 不运行 | 有实际用例时在 Linux、macOS、Windows 运行 |

测试分为 unit、module、integration、system、e2e 五层，各层使用独立 CI job。平台集成契约位于 `test/platform/`、`test/ci/platform/`，或在文件头声明 `// @integration-platform: native`。声明依据是被测契约。进程、跨进程锁、文件系统、Git/worktree、Memory 发布、升级、Context/Review、产物归档和模型存储按职责分组，每个文件在适用平台仅执行一次。

系统层包含产品 API、浏览器、真实命令树和完整后台服务功能验证。Windows 打包 CLI/Shell 冒烟同属系统层，单独运行并测量。这些作业仅在 full 执行。系统层每个平台一个作业，执行相应范围内全部用例。full 自动发现 E2E 文件并在适用平台生成独立作业。完整 full 汇总必须确认全部已建设层级及 Windows 打包作业成功。

- `npm run test:unit`、`npm run test:module`、`npm run test:integration`、`npm run test:system` 分别构建后执行对应层。
- `run-tests.mjs --suite=unit|module|integration|system|e2e --list` 查看相应选取；默认 `regression` 只包含前三层，显式 `all` 才包含系统和端到端层。
- CI plan 拒绝未声明五种层级后缀的实际测试，并校验各系统在所选 profile 下没有漏跑或重复分配；full 将每个适用文件在每个平台恰好分配一次，default 明确排除系统及端到端文件。
- default 会运行的测试作业限时五分钟，full 中相同的平台/套件也保持五分钟：三个系统的单元、模块、OS 契约集成，以及 Linux 的普通集成。full 额外新增的作业限时三十分钟：macOS/Windows 的普通集成、三个系统的系统/端到端，以及 Windows 打包/Shell。这些是整个作业的时限；保留用例已有的单项超时。
- 独立文件默认按 `os.availableParallelism()` 并发；保留每文件 Home 隔离、输出与归属进程清理。
- 不读取 `test-durations.json`、不按预计耗时排序。上传的实际 results JSON 仅供诊断和本次实测对比。系统测试阶段包含 fixture 准备与清理；作业总耗时另计安装依赖、浏览器、构建及上传，不包含 runner 排队。
- 涉及真实浏览器进程清理的适配器契约会按需安装 Chromium；这与通过页面验证产品功能的系统测试是不同范围。

本目录、`.github/workflows/` 与 `test/ci/` 受 CI change guard 保护。探索提交不代表流程评审或完整验收完成。

## 观察 MR 的 Full-only 变更

在干净的 MR 合并候选 checkout 中，以实际 base SHA 执行：

```bash
npm run test:changed -- --base <SHA> --dry-run
npm run test:changed -- --base <SHA>
```

输出记录 base 和候选、每个文件的选择原因及平台。dry-run 只生成计划。直接执行会在当前平台构建并验证选中的文件，输出逐文件实际用例数和剩余平台。使用与现有 CI 相同的 Node 及浏览器依赖，含浏览器的套件需要先安装 Chromium。

dry-run 的退出码 0 表示计划有效。实际执行的退出码 0 表示合法空集或全部计划任务有通过证据，1 表示测试失败，2 表示计划不确定、需要补证或仍有未执行范围。中断沿用文件 runner 的信号退出码。删除、未映射文件、runner 与通用配置明确列为待补证。Windows 打包变更需在候选版本运行 `ci.yml` 的 **Windows packaged CLI shells** 作业，由它安装打包产物并覆盖四种 shell。

GitHub 的 **Changed Full-only test observation** 工作流接受一个 PR 编号，固定该 PR 的合并候选及父提交并汇总各平台和套件的实际结果。检查是按需启动的独立观察，Full CI 和合入门禁继续使用原有记录。
