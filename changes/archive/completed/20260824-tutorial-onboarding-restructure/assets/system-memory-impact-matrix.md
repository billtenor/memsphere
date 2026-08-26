# System Memory 产品定位影响矩阵

审计基线：`reserved-memory/manifest.json` version 3 当前安装清单，以及本需求新增的 `memsphere-personalized-software`。README 是产品定位事实基线；“无需修改”表示已完整检查该 Memory 不承载产品身份或课程定位，不表示跳过审计。

| Memory | 结论 | 理由 |
| --- | --- | --- |
| `concepts/memsphere-personalized-software.yaml` | 新增 | 独立承载个性化软件、Prompt/Skill/Memsphere 边界、四类资产及两种算力；版本实现边界由 framework 和教学流程说明。 |
| `concepts/memsphere-memory.yaml` | 修改 | 需要说明 Memory 是 Agent 进入个性化软件的入口，也是当前版本首先实现的语义资产，而非完整 Memsphere。 |
| `concepts/memsphere-framework.yaml` | 修改 | 当前首句把 Memsphere 完整定义为 Memory 框架；需改为 Agent 之上的个性化软件运行环境，并引用新 Concept。 |
| `concepts/memsphere-concept.yaml` | 修改 | 需要补充 Concept 在个性化软件语义资产中的职责，保持类型定义不变。 |
| `concepts/memsphere-statement.yaml` | 修改 | 需要补充 Statement 在个性化软件语义资产中的职责，保持规则语义不变。 |
| `concepts/memsphere-procedure.yaml` | 修改 | 需要补充 Procedure 在个性化软件运行中的职责，保持 Run 与 Artifact 契约不变。 |
| `concepts/memsphere-schema.yaml` | 修改 | 需要补充 Schema 在个性化软件可验证交付中的职责，保持结构契约不变。 |
| `schemas/memsphere-concept-schema.yaml` | 无需修改 | 纯 Concept 实体结构，不定义 Memsphere 产品身份或资产愿景。 |
| `schemas/memsphere-statement-schema.yaml` | 无需修改 | 纯 Statement 实体结构，不定义 Memsphere 产品身份或资产愿景。 |
| `schemas/memsphere-procedure-schema.yaml` | 无需修改 | 纯 Procedure 实体结构，本轮不改变 Procedure DSL。 |
| `schemas/memsphere-schema-schema.yaml` | 无需修改 | 纯 Schema 实体结构，本轮不改变 Schema DSL。 |
| `statements/memsphere-memory-access-rules.yaml` | 无需修改 | 只约束 Memory 的发现与读取，现有规则适用于新版定位且没有完整产品定义。 |
| `statements/memsphere-yaml-syntax-rules.yaml` | 无需修改 | 只定义稳定 YAML 语法；本轮不新增关键字或改变语法。 |
| `procedures/memsphere-general-task-execution.yaml` | 无需修改 | 通用兜底执行契约没有产品定位叙事，继续适用于当前版本。 |
| `procedures/memsphere-procedure-construction.yaml` | 无需修改 | 只负责从实践提取 Procedure，不承担 Memsphere 完整产品定义。 |
| `procedures/memsphere-changeset-comment-processing.yaml` | 无需修改 | 只负责 ChangeSet Comment 生命周期，不承担产品身份或入门课程语义。 |
| `procedures/memsphere-usage-issue-reporting.yaml` | 无需修改 | 只负责使用体验问题的取证、安全分流、脱敏、Human 授权和 GitHub Issue 提交，不定义 Memsphere 产品身份或软件资产愿景。 |
| `procedures/memsphere-tutorial-chapter-01.yaml` | 修改 | 旧流程是过长的 Memory 功能目录，需按新版 README 重建首次使用闭环。 |
| `procedures/memsphere-tutorial-chapter-02.yaml` | 无需修改（当前迭代） | 当前内容不把 Memsphere 定义为纯 Memory 框架；完整课程重构已由 Human 明确安排在第一章验收后的下一独立迭代，本轮不做临时半重构。 |

## 同步项

- 所有修改或新增的 bundled System Memory 同步到 `.memsphere/memory` 对应路径。
- 新增 Concept 加入 `reserved-memory/manifest.json`。
- 产品入口摘要同步到 `src/skills/memsphere/SKILL.md`。
- 测试必须验证 manifest 全量安装、源与工程副本一致、核心定位一致和第一章教学契约。
