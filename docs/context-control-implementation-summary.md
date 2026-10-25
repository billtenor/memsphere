# 上下文控制：功能实现摘要

Run：run-20261022-130223z-496d73ae。

基线：原第4版需求 + 实施方案第4轮固定附录A（AC24–AC27）。补充已由 Human 明确确认并投通过，确认记录为 round-20261024-111321z-5cbf4ff3 / assignment-20261024-111321z-d6960ebe，Runner 已通过；开发计划已上报。本摘要不改写旧需求或历史 Submission。

## 已实现行为

| 范围 | 实现与需求映射 |
| --- | --- |
| 分层存储 | JSON ValueStore 的完整相对 ID、叶文件原子替换、完整键记录锁和删除版本高水位；通用 data 服务与非空目录重新登记兼容旧扁平记录。AC12/13/24 |
| 模型发行与装配 | reserved-models/context-control 的五定义与清单随 npm 发行，初始化使用项目模型/业务 Store 服务；已登记模型只接受既定基线的受控适配；旧查询不初始化。AC12/13/24 |
| 生产 | 新 context_control 应用服务与五模型 Store；CLI 无 Procedure 启动，create 声明空目标并自动关联 Step，--for 归集阅读，--target 同 ID 完整提交；直接 report 保留便利入口。AC1/2/25 |
| 依赖与修订 | 具体 Artifact/External ID、当次 tag 展开、默认 default、不可变已提交成果、依赖继承/替换/清空、上游修订和下游重做、多根交付闭包。AC4/6–9/14 |
| 轻量评论 | 无轮次/投票的 Review，human/agent 来源、重复 --comment、评论文件及独立评论 ID。旧正式 Review 保持原执行器。AC5/10 |
| 并发与恢复 | Store 单记录 CAS，业务 Run 短锁；Artifact 优先保存，下一写操作按原 ID redo 补齐 Step，已完成直接沿用；无目标的新请求不承诺重试去重。AC15/16/27 |
| 阅读 | 正文/排他输出文件优先，Step.reads 尽力记账，不自动成为依赖；contentRef 经 Store/Runtime 读取并核对 sha256。AC3/4/26 |
| Run 界面 | 既有 Run 列表和详情中的真实图展示，无新模块；历史折叠和切图、同一浮窗内版本切换、正文/评论、安全 Markdown、badge、顶部标题、窄屏以及不可预览内容下载。AC17–23 |

## 主要代码路径与 diff

- src/data/extensions/filesystem-json-valuestore 通过既有 resolveFileParent 实现层级键；仅记录锁/版本键接受完整相对路径，其他单文件名校验保留。
- src/context_control/service.ts 只依赖 ValueStore、Run 锁能力和内容读取端口；src/project/context-control.ts 负责五模型/Store 装配、真实后端与锁适配，没有通用跨模型事务接口。
- src/commands/context-control.ts 和原 run 命令入口按实际存储来源选择新旧服务；发现两来源 ID 冲突或新 Store 故障不静默回退。
- src/commands/view.ts 提供新旧列表合并、真实模型详情和产物内容 API；modules/org.memsphere.run/adapter/view/context-control.ts 在原 Run Module 内实现图与浮窗。
- 新图的视图选择和版本分组均计算得到，不新增 Run.selection 或持久化版本计数；contextRevision 只是 API 计算出的刷新指纹。

## 采用规范与语义资产

采用 memsphere-repository-development-rules、testing-rules、requirement-rules、delivery-rules。无新 YAML syntax 关键字；不包含另一份 procedure-graph-syntax 草案。按计划同步 Run、Procedure、框架、Artifact Review、Procedure/Schema Schema、YAML 规则七份 System Memory 源与当前工作区副本，并同步 Skill。

Memory ChangeSet：change-20261024-113723145z-e05840bf；valid=true；最终checkpoint=15b2bf478a08534c275edb3772c2d3f7747b3385d69af72099b13abfd784139e。此前上报版本的开发中checkpoint由初始验证报告中的最终校验结果替代。
View：http://localhost:30000/projects/memsphere/changes/change-20261024-113723145z-e05840bf

通用任务执行和 Procedure 提取流程未修改：本轮未改变其步骤或审批要求，自由探索命令说明由 Run 概念与 Skill 承载。现有教程的旧流程语义保留。没有新建/删除/重命名 System Memory，因此 manifest 不变。

## 验证状态

- npm run typecheck、npm run build、memsphere validate、上述 ChangeSet 级校验已通过。
- 新增领域、CLI 闭环、原 ID redo、跨进程层级键 CAS、图投影、真实浏览器集成均已有通过结果。整组测试最初有一处 DataStore 测试输入缺少 MIME 文件后缀，已修正并重跑相关领域文件通过。
- 已用 Human 授权的 Playwright CLI 实际验证：真实 Store 三节点、内容/评论浮窗、上一版保持同一 dialog 且无下游隐藏、下一版恢复、390×844 全屏与内容/评论切换、控制台0错误0警告。见需求目录 browser-validation.md。
- 已从实际 npm pack 产物独立安装，在全新 Home/Project 执行 project create、run start、report、status 全部成功；发行包包含五模型及独立清单。
- 新领域在无文件目录能力的内存 ValueStore 上完成创建/读取/提交/评论/交付用例。
- 第2版最终 `npm test -- --test-concurrency=4`：156文件全部通过，1315项通过、2项平台跳过、零失败，223.83秒。旧无Project上下文View兼容回归，以及首轮实施验收发现的External --out遗漏和父目录别名并发缺陷均已修复；新增29项反例和边界验证。详见初始验证报告及实现修订文档，当前等待第2轮角色评审。

## 兼容与剩余范围

保留旧流程 RunState、Schema 渐进撰写、正式评审、旧扁平 ValueStore 及原 revision 历史；不自动迁移旧 Run。改绑保护、迁移热切换、graph DSL、正式 Review 新动线、图上编辑和自动代码回放留在后续范围。首版关联查询使用完整分页扫描，不引入索引或事务日志。

## 本轮文件

- changes/archive/completed/20261024-context-control-exploration/browser-validation.md
- changes/archive/completed/20261024-context-control-exploration/change.md
- docs/context-control-development-plan.md
- docs/context-control-exploration-cli.md
- docs/context-control-implementation-plan.md
- docs/context-control-prototype.md
- docs/context-control-requirement-contract.md
- examples/view-packages/context-control-prototype/README.md
- examples/view-packages/context-control-prototype/index.js
- examples/view-packages/context-control-prototype/module.json
- examples/view-packages/context-control-prototype/preview.mjs
- examples/view-packages/context-control-prototype/prototype.css
- modules/org.memsphere.run/adapter/view/context-control-styles.ts
- modules/org.memsphere.run/adapter/view/context-control.ts
- reserved-models/context-control/artifact.json
- reserved-models/context-control/external.json
- reserved-models/context-control/manifest.json
- reserved-models/context-control/review.json
- reserved-models/context-control/run.json
- reserved-models/context-control/step.json
- src/commands/context-control.ts
- src/context_control/graph.ts
- src/context_control/model-assets.ts
- src/context_control/service.ts
- src/context_control/types.ts
- src/context_control/view.ts
- src/project/context-control.ts
- test/context-control-cli.test.ts
- test/context-control-graph.test.ts
- test/context-control-memory-store.test.ts
- test/context-control-view-browser.test.ts
- test/context-control.test.ts
- test/data-filesystem-hierarchy-process.test.ts
- .memsphere/memory/concepts/memsphere-artifact-review.yaml
- .memsphere/memory/concepts/memsphere-framework.yaml
- .memsphere/memory/concepts/memsphere-procedure.yaml
- .memsphere/memory/concepts/memsphere-run.yaml
- .memsphere/memory/schemas/memsphere-procedure-schema.yaml
- .memsphere/memory/schemas/memsphere-schema-schema.yaml
- .memsphere/memory/statements/memsphere-yaml-syntax-rules.yaml
- modules/org.memsphere.run/adapter/view/index.ts
- reserved-memory/system-memory/concepts/memsphere-artifact-review.yaml
- reserved-memory/system-memory/concepts/memsphere-framework.yaml
- reserved-memory/system-memory/concepts/memsphere-procedure.yaml
- reserved-memory/system-memory/concepts/memsphere-run.yaml
- reserved-memory/system-memory/schemas/memsphere-procedure-schema.yaml
- reserved-memory/system-memory/schemas/memsphere-schema-schema.yaml
- reserved-memory/system-memory/statements/memsphere-yaml-syntax-rules.yaml
- scripts/check-reserved-models.mjs
- src/cli.ts
- src/commands/cli-errors.ts
- src/commands/run.ts
- src/commands/view.ts
- src/data/extensions/filesystem-json-valuestore/README.md
- src/data/extensions/filesystem-json-valuestore/index.ts
- src/data/extensions/filesystem-json-valuestore/revision-state.ts
- src/data/extensions/shared/filesystem.ts
- src/project/business-stores.ts
- src/project/data-service.ts
- src/skills/memsphere/SKILL.md
- test/business-data-service.test.ts
- test/data-filesystem-json-valuestore.test.ts
- test/fixtures/filesystem-store-worker.ts
