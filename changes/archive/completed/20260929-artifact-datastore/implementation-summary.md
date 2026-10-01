# Run 附属数据接入：功能实现摘要

Run：run-20260929-121744z-d56a5df3。基线：820530e。本文为实现候选，不代表 Review、Human 验收或 commit 已完成。

采用 statements/memsphere-repository-development-rules、statements/memsphere-repository-testing-rules、statements/memsphere-repository-requirement-rules；以 implementation-plan.md 第六轮和后续 Human 明确的元信息、.gitkeep 决策为当前依据。旧需求 Submission 保持不可变，不扩大历史通过票的范围。

## 关键实现与需求映射

- src/project/run-data.ts、src/config.ts：进程共享内置 raw/filesystem Extension Registry，Project 按既有 runsRoot、archiveRoot 装配四个 raw 模型和八个 Store；StoreId 为模型 ID/current 或 /archive。复用 DataManager，日志内部配置 application/x-ndjson → .acp.jsonl，不新增用户配置，不按 Run 创建 Store。DataStore 内容调用不需要先解析模型定义。
- src/run/store.ts：正式 Artifact、Submission/context、中间产物经 Artifact Store 写入、读取、删除；原文件名、内容和 digest 保持。中间文件由 artifacts/drafts 改为 artifacts 下的稳定 .draft.md 文件，阶段仍由 schemaDrafts 记录。Schema 最终提交读取本地候选并校验，不再要求内部草稿路径；既有冻结 Submission 不覆盖。
- src/commands/run.ts、src/cli.ts：统一 run artifact export --run --step --file [--force]。默认选择中间文件、当前 Submission 或最近 Event，只导出本地副本，不推进状态，不提供历史版本参数。默认拒绝覆盖，force 替换目标条目避免修改硬链接底层冻结内容；拒绝托管根目录和符号链接目标。
- src/acp/review-session.ts、src/commands/view.ts、src/commands/run.ts：Reviewer、View 和 CLI 内容读取经 Store，不通过本地内容文件访问；原业务归属与路径检查保留。无前端组件、交互和用户 Store 配置改动。
- src/run/store.ts、src/memory/run-provider.ts、src/memory/project-provider.ts、src/memory/factory.ts、src/commands/memory.ts：快照通过 Store 保存后一次发布 memorySnapshot.files；Run 专用 Provider 按清单解析 Memory 逻辑身份，支持文件名不等于 canonical name，不用 Store.list。普通 Project Memory 来源不变。
- scripts/backfill-run-memory-manifest.mjs、package.json：独立旧 Run 补齐工具随包提供；默认只检查，--write 仅补缺失 files，不覆盖已有清单，不移动内容。核心缺清单报使用工具的提示，不自动扫描或写回。
- src/acp/activity.ts：原 ACP JSONL 字节与展示快照布局不变，有限批次首批 create、后续 append；保持运行中可读和错误回调一次、不停止 Agent。失败后后续快照从实际日志重建，不重放或修复日志；半行暂忽略，损坏完整行明确报错。
- src/run/content-manifest.ts、src/archive/store.ts：业务从 Event、schemaDraft、Submission/context、Memory files、Attempt 身份生成去重清单；四类内容按清单跨 Store 复制覆盖、校验后保存既有 .archive.json，最后移动 Run status，再删源。切换后 redo 只验证目标和清理旧端，不反向覆盖。归档列表以状态存在为准，恢复清理失败不残留有效归档条目。ChangeSet 原归档行为不扩张。
- src/archive/worker-guard.ts：修改两端前保守检查已有 Worker PID，只有 ESRCH 放行；存在、EPERM 和其他不确定错误提示重试。不终止进程，不新增强身份字段或进度记录。
- .gitkeep：按 Human 确认，新快照、旧补齐清单排除普通 Git 占位文件，Project 源文件不动。切换后旧端 Memory 占位可清理，其他未知文件仍保留并报错。不新增 Store fallback contentType 或公共 API。

## 改动文件

实现新增：src/project/run-data.ts、src/memory/run-provider.ts、src/archive/worker-guard.ts、src/run/content-manifest.ts、scripts/backfill-run-memory-manifest.mjs。实现修改文件见上节，另有 src/prompts/models.ts、registry.ts、run.ts 与 en/zh-CN 的 run/current-step.hbs、schema-overview.hbs。

测试新增：test/archive-run-data.test.ts、archive-worker-guard.test.ts、run-data-access.test.ts、run-memory-backfill.test.ts、helpers/run-data.ts。测试修改：test/archive-store.test.ts、run-changeset.test.ts、run-command.test.ts、package-release.test.ts。

说明同步：src/skills/memsphere/SKILL.md；reserved-memory/system-memory 与 .memsphere/memory 中同名六份 Memory：concepts/memsphere-run.yaml、memsphere-procedure.yaml；schemas/memsphere-procedure-schema.yaml、memsphere-schema-schema.yaml；statements/memsphere-memory-access-rules.yaml、memsphere-yaml-syntax-rules.yaml。没有新增 Memory identity，manifest 不变。需求记录、实施方案各轮材料、开发计划、决策记录及本文验收后归档至 changes/archive/completed/20260929-artifact-datastore/。

.vscode/ 和根目录 review-summary.md 是既有非本轮内容，不纳入交付。未 stage 或 commit。src/data/api 未修改，基础 Store 接口保持 820530e。

## 行为与兼容边界

正式文件布局、字节、现有配置不变；中间 drafts 目录是已确认例外。旧 Run 有 Memory 快照但缺清单时，须显式运行独立工具；不支持旧半成品 drafts 恢复，不批量删除它们。.gitkeep 是 Human 明确的可丢弃例外，不扩大到其他文件。

Run status 和 .archive.json 仍为原生状态 JSON；不新增进度文件、资源总清单、存在标志或跨 Store 事务。业务负责清单、搬运和一致性。Worker PID 复用可能保守误拦，按已批准规则稍后重试。原生状态 rename 跨卷失败不自动转为双状态协议。

## 已执行验证与残余项

当前全量 npm test -- --test-reporter=spec：709 项，708 通过、0 失败、1 Windows 专属跳过。typecheck、build、git diff --check、已安装 memsphere validate 均通过。受影响内容/补齐/归档/Run ChangeSet 18 项通过；归档可选性与 redo/PID 40 项通过。完整命令和浏览器回归包含在全量套件。

新构建 CLI validate --memory-root .memsphere/memory 通过；隔离临时 Home/Managed Project 的创建和新构建 CLI validate 通过。直接在真实 Home 执行新构建 CLI validate 因 operator_token、view_packages、view_theme、view_composition 等较新字段失败；已核对 globalConfigSchema 与 820530e 完全相同，不是本轮变更，未修改真实配置，不将隔离校验伪装成真实 Home 通过。

Windows/macOS、云后端未实际运行；无新前端交互，未另做 playwright-cli 人工操作。普通日志读取仍聚合当前字节，长日志性能不在本轮优化范围。尚需独立 Review 和 Human 验收；如 Reviewer 找到需要改变已确认方案的问题，先向 Human 决策。

Memory ChangeSet：change-20260930-092656432z-e44618d2，validation passed，content digest 9fc3756490040e59a3e3b4199b55472db245c1b68cc6672dfc197fa6cadb0164；View：http://0.0.0.0:30000/projects/memsphere/changes/change-20260930-092656432z-e44618d2 。普通 validate 不替代此变更级结果。
