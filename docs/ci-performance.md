# CI 性能约束

CI 与 Security 的整条 workflow 从 GitHub `created_at` 到完成应不超过 300 秒，包含排队、环境准备、测试、构建、产物上传与依赖 Job。不能通过增加 timeout 或删除测试满足该约束。预算检查在完成前预留 15 秒清理时间；最终验收仍读取 GitHub 的真实完成时间。

## 执行方式

CI 在 Linux、macOS、Windows 上各执行全部测试。`scripts/run-tests.mjs` 自动发现 `test/*.test.ts`，按主要验证契约分成七个类别：模型与设置 UI、评审与 Shell UI、Memory 与 Project CLI、App/Model/Data CLI、Project 生命周期、Memory 存储与变更、Run/Data/SDK。Job 使用类别名称，Linux 和 macOS 合并相关类别以减少 runner 排队和准备开销，Windows 使用细分类别。

类别由测试文件名和浏览器入口识别，新测试自动加入对应类别或运行时类别，不依赖人工维护文件清单。配置契约测试检查每个平台的类别组合恰好覆盖全部测试文件一次，避免合并类别后重复或遗漏。每个类别内部依据 `scripts/test-durations.json` 的平台独立计时优先执行昂贵文件，用 2–4 个独立进程并行；单个测试文件内部仍串行。每个文件获得独立临时 MEMSPHERE_HOME，测试自身的临时仓库、配置和浏览器 Context 继续隔离。

`npm run test:ci -- --suite=app-cli` 运行 App/Model/Data CLI；`node scripts/run-tests.mjs --suite=app-cli --list` 查看文件清单；`npm test` 运行全部文件。`--test-concurrency=N` 控制文件进程数量。`--results=<path>` 或 CI_TEST_RESULTS 保存类别、计划、退出码及文件耗时；失败不停止其他文件，也不转换为成功。

`pretest:ci` 执行一次完整 build，同时完成 core 与 View Module 的 TypeScript 检查。测试后复用该产物执行每个平台的 Project smoke，不再重复构建。Windows 的独立 npm 安装、Run/View 生命周期和四种 Shell smoke 均保留；它在完成 build 后使用 `npm pack --ignore-scripts` 复用产物，用户发布包的 prepack 构建契约不变。

每组上传计时记录用于后续更新权重。`CI five-minute budget` 等待所有测试组和 Windows package smoke，任何测试失败或整条 workflow 超预算都会失败。Security 也执行同一预算检查。所有主 Job 的执行上限为五分钟，预算 Job 为一分钟。

## 基线

App 合入前 PR #86 的完整测试步骤：Linux 9m23s、macOS 13m00s、Windows 19m11s。Windows 依赖安装和 Chromium 下载合计约 30 秒，主要瓶颈是测试文件全局串行。历史 Windows 测试用例累计约 1079 秒，其中 Project 命令文件约 126 秒，App 安装约 75 秒。优化结果以新分支 GitHub Actions 的实际完成时间为准。
