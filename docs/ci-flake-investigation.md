# CI flake investigation

This document creates a documentation-only change for measuring the existing CI workflow without changing its behavior.

For the diagnostic pull request, repeated runs should be classified by:

- operating system and job;
- failing workflow step;
- normalized error signature;
- first-run failure versus rerun result.

The investigation should preserve first-run failures as evidence. A successful rerun confirms intermittency but does not convert the original result into a deterministic pass.

## 测试超时排查与设计

### 确认超时发生在哪个边界

先从作业日志记录平台、提交、尝试次数、文件并发数、失败的文件及用例。按[测试层级与 CI 矩阵](../scripts/ci/README.md)确认该用例属于单元、模块、集成、系统或端到端层。系统测试通过真实产品入口验证子系统，进程内调用真实 CLI 命令树也属于这一层。

| 日志证据 | 查什么 |
| --- | --- |
| 单个 TAP 用例报 `testTimeoutFailure` | 查看用例的阈值和最后到达的阶段。文件总耗时还包括同文件的其他用例、准备及清理。 |
| 进程、浏览器或轮询等待超时 | 查看等待的状态、最后一次观测、相关进程是否仍然存活，以及取消是否传到该操作。 |
| GitHub 作业达到时限 | 按步骤区分依赖安装、构建、测试和上传。测试 runner 的结果 JSON 可用于定位耗时文件。 |

判断超时是否普遍时，选定一段运行历史，按测试层、平台和用例统计首次尝试的超时次数与执行次数。记录重跑结果，并对照同一文件单跑和矩阵并发下的阶段耗时，区分集中发生在少数用例的问题和跨文件的资源争用。

### 分阶段计时，再按证据改测试

1. 用 `performance.now()` 记录准备、被测动作、等待状态及清理的耗时。在退出或失败时用 `t.diagnostic()` 保留最后一个阶段和已完成阶段。多次 CLI 调用可以按启动、命令执行、进程退出拆开观察。
2. 通过真实 Store 或业务 API 准备非被测状态。用例保留针对公开入口的断言，例如 CLI 拒绝跨 Run 访问、受限 Reviewer 的权限和已经保存的节点。参数路由和输出格式可在进程内运行真实命令树。Shell、打包、Worker 启停、权限或进程归属本身是契约时，保留对应的真实边界。
3. 优先去掉每次命令重复的 Git 查询、Store 打开和无关的前置命令。同一次调用内复用已经校验的配置与服务，跨命令按需重读当前版本。对互相独立的只读操作可小范围并行，并等待全部结束；依赖前序结果、修改共享状态、`cwd` 或环境变量的操作保持顺序。
4. 以状态、事件或 IPC 握手驱动等待，并给子操作设有界期限。清理阶段独立核对原始进程句柄或进程创建身份，停止并确认测试所属进程退出后再移除临时目录。把用例的 `AbortSignal` 传入正在运行的查询和轮询。Windows 上多次查询进程身份时可复用[测试用 CIM 观察器](../test/helpers/windows-process-observer.ts)，其宿主随 fixture 关闭。

### 验证修复

先构建，再单独重现原失败文件或用例。如果单跑通过，按失败作业的操作系统和文件并发数复验对应测试层。下面的 `4` 是本案例 Windows 作业的文件并发数，其他作业应使用各自日志中的值。

```bash
npm run build
node --import tsx --test test/exploration-schema-review.system.test.ts
node scripts/ci/run-tests.mjs --suite=system --test-concurrency=4
```

记录实际命令、提交、平台、并发、结果和阶段耗时。保留原失败证据和用例阈值，用修复版本的同平台矩阵结果确认修复。测试层级、时限及覆盖边界见[项目测试规范](../.memsphere/memory/statements/memsphere-repository-testing-rules.yaml)。

### 案例 PR #166

最初仅 [`exploration-schema-review.system.test.ts`](../test/exploration-schema-review.system.test.ts) 在两个平台的系统作业中失败。macOS 有 4 项超时，Windows 有 6 项。这个文件经真实 CLI 验证 Schema 写作、Review 和 Reviewer 进程重启，默认 CI 不执行系统测试层。[初始 Full CI](https://github.com/billtenor/memsphere/actions/runs/45354467066)

减少命令内的重复加载和测试准备后，Windows 仅剩 Reviewer 重启一项超时，耗时 63.3 秒。最终版本在原 60 秒阈值下用时 52.8 秒，其中首次 Reviewer 调用及等待失败约 20.2 秒，重试调用与回执约 16.5 秒。Windows 原失败文件 9 项全通过，三平台 54 个作业全部通过。[Windows 阶段日志](https://github.com/billtenor/memsphere/actions/runs/45579254845/job/139084909646) · [最终 Full CI](https://github.com/billtenor/memsphere/actions/runs/45579254845)
