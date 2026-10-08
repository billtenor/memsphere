> 此文件记录 ee71c65 的旧入口实现/评审材料。发布前已按 Human 确认改为 `--write-options` 内联 JSON；最终实现与验证以 options-delivery-report.md 和 options-review-evidence.json 为准，以下测试结果及旧 ChangeSet 不是调整后验证证据。

# 敏捷需求开发交付报告

需求：https://github.com/billtenor/memsphere/issues/95 。Run：run-20261008-064617z-ca3c75d4；交付分支 codex/issue-95-model-artifact-data-id。

## 交付内容

模型 Artifact 支持可选 `memsphere run report --data-id <id>` / reportRun.dataId，可跨步骤、循环和 Run 整条更新同一业务对象。省略保留默认 Run/执行 UUID 身份。首个合法候选在任何评审或业务写入前保存目标，修订与失败重试继承，变更目标明确拒绝。

Submission 保存不可变模型目标，评审材料和 Agent/CLI 展示暴露 ID，接受核对目标及原有 Store/模型指纹，接受回执记录 ID、执行身份、digest 和 revision；历史快照与业务当前值独立。非法/非模型/Schema 误用在写入前拒绝，不推进；旧缺新增可选字段的评审记录按默认规则处理，无需迁移。

交付包括实现、测试、中英文文档、六份 System Memory 源及项目副本、Skill 说明和 changes 需求/评审/验证记录。本轮没有新增 YAML syntax 关键字，没有扩大到 CAS 或事务。

## 验证结果

- 最终 npm test：141/141 文件、1164 项测试、零失败（289.01 秒）；构建、typecheck、memsphere validate、diff check 均通过。
- 模型 Artifact 34 项通过，原失败规则集成与模型文件合计35项通过；相邻 Run/Review/Prompt/Reserved Store 105 项通过。覆盖实际 CLI 参数与回执、跨 Run 完整替换、候选冻结、写入及保存失败重试、旧记录和错误边界。
- 首轮完整回归发现本轮非模型 ACP 契约读取 Submission 的失败，已限定模型路径、保留既有断言并重跑全部测试，未遗留问题。证据见 verification-report.md 与 verification-evidence.json。
- 六份 System Memory 源和项目副本逐字节一致；Artifact Review Concept 及第三章/评审体验教程已检查，普通 Markdown 教学产物无需调整，依据见方案。

## 验收结论

需求契约已由产品 Agent 评审通过；最终实施方案已由研发、测试、架构 Agent 第三轮通过。实现与验证材料第一轮三者全部通过，review-20261008-072557z-4c823b76 / round-20261008-072557z-5f07b0fa，Runner 已接受，零阻塞/风险/建议 Comment。
研发亲自复跑34项模型测试及 typecheck/build/Store validate；测试亲自复跑34项模型和105项相邻测试及 typecheck；架构亲自复跑35项模型/规则集成及 typecheck，核对 Memory 源副本。各摘要明确区分独立验证与引用全量证据。

契约验收标准已有充分证据，当前迭代实现与技术验收完成。产品 Agent 交付验收已通过（review-20261008-073129z-f1b9c469 / round-20261008-073129z-a48e0fd9），Runner 已接受；change.md 更新并归档，随后创建仅包含本轮内容的 Git commit。产品亲自通过34项模型测试、typecheck并核对源副本；其额外全量尝试未返回完整结果，未被计入完整回归证据。GitHub PR 由流程后续 Human 判断步骤决定，尚未创建或推送。

## 向前兼容

结论：不需要向前兼容。无适用 stable Tag，不建立历史兼容责任。Issue 所需默认行为和旧记录处理作为当前回归要求已验证。

## 后续范围与残留问题

没有未解决阻塞问题。首版为无条件整条原子 upsert，最后成功写入覆盖，同 ID 并发更新可能互相覆盖，不合并旧字段；expected-revision/CAS 与 DSL ID 插值/提取留待后续。实际环境为 Linux/Node22，未额外宣称 Windows/macOS 实机验证。

## Memory 交付证据

ChangeSet：change-20261008-071155715z-ff7c51a9；校验 passed；digest 02720c9f5e02f2706d1ed57d93cad1e6eed29641d234ed2fbf0618e7061ac01e。
CLI 返回的 View 入口：http://0.0.0.0:30000/projects/memsphere/changes/change-20261008-071155715z-ff7c51a9 。
