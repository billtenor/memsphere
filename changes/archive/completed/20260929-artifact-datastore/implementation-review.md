# Run 附属数据接入：实现与验证验收材料

Run：run-20260929-121744z-d56a5df3；当前工作区相对 820530e 的完整实现成果，尚未验收或 commit。

请研发、测试、架构分别独立审查实际 src/、test/、脚本及文档改动，不以本候选或其他 Reviewer 的结论替代代码检查。审查对象包括已冻结的功能实现摘要、初始验证报告及当前 Workspace 的新增和修改文件；git diff 不展示 untracked 文件，请主动读取新增文件。

## 当前基线与材料

- 当前契约：本目录 change.md 与 implementation-plan.md 第 8 章。后续 Human 确认集中收入当前基线；旧 flow[1] Submission 保持不可变，不追溯改写，也不扩大旧通过票。
- 实施方案：implementation-plan.md 第六轮；开发计划：development-plan.md。后续 Human 已确认 .archive.json 与 Run status 同为原生状态 JSON，元信息先保存、状态最后切换；另确认 .gitkeep 仅为可丢弃 Git 占位，新快照/补齐排除，来源 Project 不删除，旧端 Memory 占位在切换后清理。见两份 decision-pending-* 文件，其标题与内容均已标已确认，不是未决项。
- 功能实现摘要：implementation-summary.md（flow[4] 已上报）。
- 初始验证报告：verification-report.md（flow[5] 已上报）。新增 opaque Schema 测试后的最终全量为 710 项，709 通过、0 失败、1 Windows 专属跳过，作为最新验证证据。

## 实际审查入口

Project 四模型八 Store 装配：src/project/run-data.ts、src/config.ts。资源清单与搬运：src/run/content-manifest.ts、src/archive/store.ts、src/archive/worker-guard.ts。Artifact/Schema：src/run/store.ts、src/commands/run.ts、src/cli.ts、src/acp/review-session.ts、src/commands/view.ts。Memory Provider 和独立工具：src/memory/run-provider.ts、factory.ts、project-provider.ts、src/commands/memory.ts、scripts/backfill-run-memory-manifest.mjs。活动 create/append 和失败投影：src/acp/activity.ts。

新增反例与边界测试：test/archive-run-data.test.ts、archive-worker-guard.test.ts、run-data-access.test.ts、run-memory-backfill.test.ts、helpers/run-data.ts；原 Run、Review、View、Memory、Package 回归在全量套件中执行。System Memory 六份源/副本一致，Skill/中英文 Prompt 同步。

src/data/api 没有改动。文件内容不加 envelope/base64、不重编码、不改正式布局或既有 Project 配置。中间产物取消 drafts 目录是已确认例外；旧半成品 drafts 不迁移。旧 Run 有 Memory 快照但缺 files 需手工工具补齐，核心不自动扫描或写回。

复制阶段按源覆盖目标；状态提交后只验证目标并清理旧端，不反向复制残留。四模型每个当前/归档一个 Store，不按 Run 创建 Store，不用 Store.list 推断资源，不新增进度或存在性状态。内容删除仅在状态切换和目标读取成功后；未知文件保留报错。PID 只有 ESRCH 放行，无 PID 保持原处理。

## 结果与限制

typecheck、build、git diff --check、安装 CLI 的 Project validate、Memory ChangeSet validate 通过。新构建 CLI 的显式 Memory root 校验和隔离 Home/Project 校验通过。真实 Home 的较新字段不被基线 schema 支持：globalConfigSchema 与 820530e 相同，直接新构建 CLI validate 在真实 Home 失败；没有篡改全局配置或隐藏该失败，不属于本轮新增回归。

Windows/macOS、云后端未实测，不以 Linux/CI 声称完成。无前端交互组件改动，已有真实浏览器集成回归通过；未另行 playwright-cli 人工操作。其他本轮之外配置演进、日志读取性能、跨卷状态切换、Run status ValueStore 建模仍在后续范围。

请摘要区分亲自读取/复跑、仅引用的结果及残余风险。发现实际 bug 可要求修改；若修复需要新 API、布局、配置、兼容或失败语义选择，由 Runner 先与 Human 决策，不以 Reviewer 意见自行扩张范围。

Memory ChangeSet：change-20260930-092656432z-e44618d2，active / validation passed，digest 9fc3756490040e59a3e3b4199b55472db245c1b68cc6672dfc197fa6cadb0164。View：http://0.0.0.0:30000/projects/memsphere/changes/change-20260930-092656432z-e44618d2 。

本轮不纳入 .vscode/ 或根目录 review-summary.md，不 stage/commit/push，最终仍需 Human 验收。
