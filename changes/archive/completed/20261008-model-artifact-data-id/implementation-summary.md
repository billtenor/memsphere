> 此文件记录 ee71c65 的旧入口实现/评审材料。发布前已按 Human 确认改为 `--write-options` 内联 JSON；最终实现与验证以 options-delivery-report.md 和 options-review-evidence.json 为准，以下测试结果及旧 ChangeSet 不是调整后验证证据。

# 功能实现摘要

Run：run-20261008-064617z-ca3c75d4，需求 #95。

## 实现与需求映射

新增 `run report --data-id` / reportRun.dataId，省略默认自动生成；非法 ID 在步骤身份分配与目标冻结前拒绝。RunStep.modelDataId 在首个合法候选后、任何评审/业务写入前持久化；修订及重试沿用、不同 ID 拒绝。cloneStep 清除执行目标；多步骤/Run 可共享业务 ID。

候选 modelTarget 保存 Store、模型指纹、执行 UUID、业务 ID；Review 接受从不可变 Submission 读取并核对目标。无 Review 的写入及 Review 接受传所选 dataId 到既有原子整条 upsert。候选、Agent/CLI artifact show、ACP contract、Run Prompt 和回执显示 ID；接受 modelData 保留实际 revision。旧 pending Review 缺新增字段按默认生成规则处理。

关键代码：src/run/store.ts reportRunUnlocked / acceptArtifactReviewSubmission / cloneStep / buildRunEventArtifact；src/project/model-artifact.ts validateModelArtifactDataId / processModelArtifact；CLI 参数与 commands/run 转发；acp/review-session 与 commands/run 的展示映射；Prompt 类型/schema/中英文模板。

## 规范与同步

采用 memsphere-repository-development-rules 的避免过度设计、System Memory 同步与 syntax 准入，以及测试规范。无新增 YAML 关键字，无 CAS、patch 或事务协议。同步六份 System Memory 源和本项目副本，Skill 与中英文文档一致。检查 Artifact Review Concept、第三章及评审体验教程：通用评审关系及普通 Markdown 教学产物不涉及业务 ID，本轮无需修改，证据见方案。

## 修改文件

- .memsphere/memory/concepts/memsphere-framework.yaml
- .memsphere/memory/concepts/memsphere-procedure.yaml
- .memsphere/memory/concepts/memsphere-run.yaml
- .memsphere/memory/schemas/memsphere-procedure-schema.yaml
- .memsphere/memory/schemas/memsphere-schema-schema.yaml
- .memsphere/memory/statements/memsphere-yaml-syntax-rules.yaml
- docs/model-artifact.en.md
- docs/model-artifact.md
- reserved-memory/system-memory/concepts/memsphere-framework.yaml
- reserved-memory/system-memory/concepts/memsphere-procedure.yaml
- reserved-memory/system-memory/concepts/memsphere-run.yaml
- reserved-memory/system-memory/schemas/memsphere-procedure-schema.yaml
- reserved-memory/system-memory/schemas/memsphere-schema-schema.yaml
- reserved-memory/system-memory/statements/memsphere-yaml-syntax-rules.yaml
- src/acp/review-contract.ts
- src/acp/review-session.ts
- src/cli.ts
- src/commands/run.ts
- src/project/model-artifact.ts
- src/prompts/models.ts
- src/prompts/registry.ts
- src/prompts/run.ts
- src/prompts/templates/en/acp-review/partials/contract.hbs
- src/prompts/templates/en/run/current-step.hbs
- src/prompts/templates/en/run/report-receipt.hbs
- src/prompts/templates/zh-CN/acp-review/partials/contract.hbs
- src/prompts/templates/zh-CN/run/current-step.hbs
- src/prompts/templates/zh-CN/run/report-receipt.hbs
- src/run/store.ts
- src/skills/memsphere/SKILL.md
- test/run-model-artifact.test.ts

需求文档位于 changes/archive/completed/20261008-model-artifact-data-id（change、契约、方案、Task List、修订摘要及 review-config）。

## 行为、回归及风险

无 stable checkpoint，不建立向前兼容责任；按 Issue 要求保留默认行为和旧记录可读/接受作为回归。新增字段可选，不改变 contractVersion。无条件整条替换，最后成功写入覆盖，可能覆盖同 ID 的并发更新；文档明确，无 expected-revision。历史快照不读取业务当前值。

## 已执行验证

- npm run build：通过（包含最新 CLI/API 与模板；后续 full npm test 重建最终文档/Memory/Skill）。
- npm run typecheck：通过。
- node --import tsx --test --test-reporter=spec test/run-model-artifact.test.ts：34 项通过，包含真实 CLI 边界。
- node --import tsx --test --test-concurrency=2 test/run-store.test.ts test/run-command.test.ts test/review-store.test.ts test/prompt-renderer.test.ts test/reserved-store.test.ts：105 项通过。
- memsphere validate：通过；git diff --check：通过。
- Memory ChangeSet：change-20261008-071155715z-ff7c51a9，校验通过，digest 02720c9f5e02f2706d1ed57d93cad1e6eed29641d234ed2fbf0618e7061ac01e。
- View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261008-071155715z-ff7c51a9 。

初次测试的失败为新测试构造问题（故障 Run 文件未恢复就检查目标、空分支不合法），均已修正且 34 项通过；受限沙盒真实 CLI 输出不完整，通过宿主运行验证真实结果。没有未解决功能失败。

## 未验证项

全量 npm test 与最终 build/Memory 校验在下一验证步骤执行，当前未宣称完整交付。
