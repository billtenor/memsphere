# 自由探索体验优化：功能实现摘要（修订版）

需求F1–F10／AC1–AC15及Human最新outputs存储简化确认已实现。全局Continue本轮只接自由探索，旧流程、Schema、正式Review、ChangeSet、ACP宿主、graph DSL及图编辑不扩展。

| 范围 | 实现 |
| --- | --- |
| F1／F2 | Home CommandState保存前文；启动自动返回ID，status找回既有记录，Continue动态帮助只列当前可用写操作，原生命令保留 |
| F3／F4 | 完整report自动关联Step，移除普通create／target／for；辅助读取窗口及Step读取归档尽力CAS，不阻断正文或核心提交 |
| F5／F6 | external add只回两个ID，正文按200 Unicode chars预览，JSON合法，--out完整排他导出 |
| F7／F8／F9 | 现有Run图展示External及完整单栏详情，双向手抓、取消清理、边及直接端点高亮；原历史、宽浮窗及窄屏保留 |
| F10 | src/context_control/outputs.ts统一成果推导；Run仅存outputOverrides人工增删；report及redo不写Run；Snapshot/API只提供计算结果；人工命令与finish单次CAS |
| 升级 | 两类已知旧Run定义及说明变更受控转换，保留原根／空集合、元数据和历史；旧中断report接续后转换差值，复用原model-operation回滚 |
| 模型及记忆 | Run模型、Artifact说明、草案示例、方案、CLI文档、System Memory来源和副本、Skill同步 |

自动成果取完整submitted产物中的末端并排除修订旧版；实际成果＝（自动成果∪人工添加）－人工移除。人工添加明确保留直到移除；隐藏不改实际依赖，旧ID隐藏不传给新修订。finish只存相对自动成果的差值；终态不可继续生产或改根。

真实技术Run已转换并上报最终方案artifact-ddbb2db6-6e80-44db-9721-20e03b64494b，默认仍为5份Artifact及3份External。真实report前后Run revision均为4，整条envelope完全一致。已有短锁仍协调生命周期，不把减少Run写入夸大为已实现无锁并发。

本轮完整验证：160文件，1337通过、2平台跳过、0失败；类型检查、完整build、Project validate及Memory变更级校验通过。checkpoint：80b41e820f7130bc993663284ef7ca05c88dd355cba9d2f7caa09b2cf79919c7。完整证据及限制见initial-validation.md；不混用上一轮独立包consumer或全量结果。

当前未commit或创建PR，docs/procedure-graph-syntax.md是此前已有文件，本轮未修改，不纳入提交。

## 适用规范与本轮文件

采用statements/memsphere-repository-requirement-rules、statements/memsphere-repository-development-rules、statements/memsphere-repository-testing-rules、statements/memsphere-repository-delivery-rules：按已确认范围、复用CAS及恢复、同步System Memory／Skill、先定向后全量、真实浏览器及最终Memory ChangeSet校验；未新增YAML syntax关键字。

以下包含未跟踪新文件，审查不能仅看git diff；docs/procedure-graph-syntax.md为此前已有文件，本轮未改，不纳入提交。

- .memsphere/memory/concepts/memsphere-framework.yaml
- .memsphere/memory/concepts/memsphere-run.yaml
- .memsphere/memory/schemas/memsphere-procedure-schema.yaml
- .memsphere/memory/schemas/memsphere-schema-schema.yaml
- .memsphere/memory/statements/memsphere-yaml-syntax-rules.yaml
- changes/archive/completed/20261025-exploration-experience/artifact-structure.md
- changes/archive/completed/20261025-exploration-experience/change.md
- changes/archive/completed/20261025-exploration-experience/command-state-design.md
- changes/archive/completed/20261025-exploration-experience/command-state.schema.json
- changes/archive/completed/20261025-exploration-experience/context-design.md
- changes/archive/completed/20261025-exploration-experience/development-plan.md
- changes/archive/completed/20261025-exploration-experience/graph-design.md
- changes/archive/completed/20261025-exploration-experience/implementation-plan.md
- changes/archive/completed/20261025-exploration-experience/requirements-confirmation.md
- changes/archive/completed/20261025-exploration-experience/requirements-revised.md
- changes/archive/completed/20261025-exploration-experience/requirements-scope-update.md
- changes/archive/completed/20261025-exploration-experience/requirements.md
- changes/archive/completed/20261025-exploration-experience/review-round1-revision.md
- changes/archive/completed/20261025-exploration-experience/review-round2-revision.md
- changes/archive/completed/20261025-exploration-experience/run.schema.json
- docs/context-control-exploration-cli.md
- docs/context-control-prototype.md
- modules/org.memsphere.run/adapter/view/context-control-styles.ts
- modules/org.memsphere.run/adapter/view/context-control.ts
- reserved-memory/system-memory/concepts/memsphere-framework.yaml
- reserved-memory/system-memory/concepts/memsphere-run.yaml
- reserved-memory/system-memory/schemas/memsphere-procedure-schema.yaml
- reserved-memory/system-memory/schemas/memsphere-schema-schema.yaml
- reserved-memory/system-memory/statements/memsphere-yaml-syntax-rules.yaml
- reserved-models/context-control/artifact.json
- reserved-models/context-control/run.json
- reserved-models/home-models/command-state.json
- reserved-models/manifest.json
- scripts/check-reserved-models.mjs
- src/cli.ts
- src/commands/cli-errors.ts
- src/commands/context-control.ts
- src/commands/continue.ts
- src/commands/project.ts
- src/commands/view.ts
- src/context_control/service.ts
- src/context_control/types.ts
- src/home/command-state-store.ts
- src/project/context-control-access.ts
- src/project/context-control-upgrade.ts
- src/project/context-control.ts
- src/project/data-service.ts
- src/project/model-operation.ts
- src/reserved/models.ts
- src/skills/memsphere/SKILL.md
- test/command-state-store.test.ts
- test/context-control-cli.test.ts
- test/context-control-outputs.test.ts
- test/context-control-upgrade.test.ts
- test/context-control-view-browser.test.ts
- test/context-control-view.test.ts
- test/context-control.test.ts
- test/fixtures/context-control-run-before-outputs.json
- test/model-operation.test.ts
- test/reserved-models.test.ts

本次新增src/context_control/outputs.ts及test/fixtures/context-control-run-stored-outputs.json，更新成果、升级及浏览器回归。
