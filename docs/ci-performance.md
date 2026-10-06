# CI 性能约束

CI 与 Security 的整条 workflow 从 GitHub `created_at` 到完成应不超过 300 秒，包含排队、环境准备、测试、构建、产物上传与依赖 Job。不能通过增加 timeout 或删除测试满足该约束。预算检查在完成前预留 15 秒清理时间；最终验收仍读取 GitHub 的真实完成时间。

## 执行方式

CI 在 Linux、macOS、Windows 上各执行全部测试。`scripts/run-tests.mjs` 自动发现 `test/*.test.ts`，按 `scripts/test-durations.json` 的历史耗时采用最长任务优先算法分成四组，每组两个独立进程并行；单个测试文件内部仍串行。每个文件获得独立临时 MEMSPHERE_HOME，测试自身的临时仓库、配置和浏览器 Context 继续隔离。没有历史数据的新文件使用默认权重并自动加入，不依赖人工维护测试清单。

`npm run test:ci -- --shard=1/4` 运行其中一组；`node scripts/run-tests.mjs --shard=1/4 --list` 查看计划；`npm test` 运行全部文件。`--test-concurrency=N` 控制文件进程数量。`--results=<path>` 或 CI_TEST_RESULTS 保存计划、退出码及文件耗时；失败不停止其他文件，也不转换为成功。

`pretest:ci` 执行一次完整 build，同时完成 core 与 View Module 的 TypeScript 检查。测试后复用该产物执行每个平台的 Project smoke，不再重复构建。Windows 的独立 npm 安装、Run/View 生命周期和四种 Shell smoke 均保留；它在完成 build 后使用 `npm pack --ignore-scripts` 复用产物，用户发布包的 prepack 构建契约不变。

每组上传计时记录用于后续更新权重。`CI five-minute budget` 等待所有测试组和 Windows package smoke，任何测试失败或整条 workflow 超预算都会失败。Security 也执行同一预算检查。所有主 Job 的执行上限为五分钟，预算 Job 为一分钟。

## 基线

App 合入前 PR #86 的完整测试步骤：Linux 9m23s、macOS 13m00s、Windows 19m11s。Windows 依赖安装和 Chromium 下载合计约 30 秒，主要瓶颈是测试文件全局串行。历史 Windows 测试用例累计约 1079 秒，其中 Project 命令文件约 126 秒，App 安装约 75 秒。优化结果以新分支 GitHub Actions 的实际完成时间为准。
