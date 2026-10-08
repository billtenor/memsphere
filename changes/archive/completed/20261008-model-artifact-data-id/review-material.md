# 实现与验证验收材料

需求：https://github.com/billtenor/memsphere/issues/95 。Run：run-20261008-064617z-ca3c75d4；分支 codex/issue-95-model-artifact-data-id，基线 0b4ad089。

## 评审对象

请审查完整前序 Run 产物中的已确认契约、第三轮实施方案、开发计划、实现摘要和验证报告，并检查当前 Workspace 的实际 `git diff`。本材料是索引，不能代替实际实现证据。

本地需求目录：changes/archive/completed/20261008-model-artifact-data-id。文件 requirement-contract.md、implementation-plan.md、tasks.md、implementation-summary.md、verification-report.md、verification-evidence.json 提供可复核说明。前序功能摘要的“未验证全量”是其提交时状态；本轮已完成完整验证，并修正了非模型 ACP 契约读取 Submission 的回归，具体见 verification-report.md。本次最终代码限模型路径读取该元数据。

## 关键路径

- src/cli.ts / src/commands/run.ts：--data-id 参数/API 转发；artifactForDisplay 保留候选目标和接受结果。
- src/run/store.ts：非法 ID 前置拒绝；步骤 modelDataId 冻结并先保存；已有 pending Review 的旧生成 ID 保护；Submission.modelTarget；接受核对 frozen execution / Store / model fingerprint / ID；cloneStep 清除执行目标。
- src/project/model-artifact.ts：非空白+portable filename（包括 .json 后缀）校验；原有原子 upsert 使用选定 ID，不改变无条件覆盖语义。
- src/acp/review-contract.ts / review-session.ts 与 src/prompts：评审契约与材料暴露 ID；Run 中英文模板与回执显示 ID。
- test/run-model-artifact.test.ts：稳定记录整条替换、独立快照、默认/显式评审冻结、非法/非模型/控制/Schema 边界、失败重试、legacy pending Review、真实 CLI 参数与回执。
- 六份 reserved-memory/System Memory 与 .memsphere/memory 副本、中英文文档和 Skill 同步；第三章及评审体验教程、Artifact Review Concept 已检查，无需修改，依据见方案。

## 验收与实际验证

最终 npm test：141/141 files，1164 tests，零失败，289.01 秒。typecheck、build、memsphere validate、diff check 通过。详细命令与结果见前序验证报告；原始日志 /tmp/issue95-full-tests-final.log、/tmp/issue95-model-tests.log、/tmp/issue95-repair-tests.log、/tmp/issue95-affected-tests.log。

首轮全量发现一个本轮引入的非模型契约回归，已修复，保留既有断言并重新完整回归；不把历史或失败结果冒充成功。没有遗留环境阻塞。

ChangeSet：change-20261008-071155715z-ff7c51a9；passed；digest 02720c9f5e02f2706d1ed57d93cad1e6eed29641d234ed2fbf0618e7061ac01e。
CLI 返回入口：http://0.0.0.0:30000/projects/memsphere/changes/change-20261008-071155715z-ff7c51a9 。

## 重点反例与剩余限制

请主动检查不同 ID 重交、缺旧字段接受、首个合法候选目标保存顺序、业务成功但 Run 保存失败、循环/Call 身份清理、非法 ID 不推进、评审接受不得跟随可变目标。只读候选，不修改代码。

首版没有 expected-revision / CAS；同 ID 并发无条件覆盖，最后成功写入胜出，文档明确；Windows/macOS 未额外实测，Linux/Node22 实际通过。无新 YAML syntax 关键字、无 contractVersion 升级或迁移。不因这些已确认范围限制而虚报已有保护。

请区分亲自检查/复跑的证据、仅引用的结果与残余风险；可行动非阻塞意见以 risk/suggestion 记录。
