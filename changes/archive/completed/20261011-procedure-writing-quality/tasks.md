# 开发计划

基于已通过的 implementation-plan.md 第二轮，按 M1–M10、V1–V4 执行。

- [x] M1：完善统一 Statement 的四字段职责、语义去重、最小作用域与正反例。
- [x] M2–M5：整理撰写流程自身的全局规则，接入读取、撰写和评审步骤。
- [x] M6–M8：同步 Concept、实体 Schema、语法规则引用与 skill 入口，保持一个完整规范来源。
- [x] M9–M10：同步五份安装副本，检查 manifest 和 Reserved Store 自举测试。
- [x] V1：固定复杂撰写业务任务及评分标准。
- [x] V2：制作合法问题样本、十个考点与正确保留项，冻结验收输入。
- [x] V3：实现局部 prepare/run helper、当前临时 Project、Bubblewrap 隔离、探针、原始日志和 smoke 检查。
- [x] V4：真实启动 A/B 两个独立子 Agent，保存全部尝试并逐项评分；两项都通过才声明有效。
- [x] 运行适用测试、全量回归、typecheck/build、Store 和最终 ChangeSet 校验，记录实际证据。
- [x] 实现成果评审、产品负责人交付评审及需求归档均完成；按 Run 继续 commit 和 Human PR 决策。

## 采用规范

已采用 statements/memsphere-procedure-writing-rules，作为 M1–M8 的职责、去重与作用域规则来源（实施中按方案完善），补齐研发 Agent 的规范追溯建议。其他采用项为 memsphere-repository-requirement-rules、memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-delivery-rules、memsphere-yaml-syntax-rules 及相关实体 Schema。

## 顺序与边界

先完成生产规范与入口，再准备固定验收任务和考点；隔离 smoke 和负向探针通过后才能执行真实 Agent 验收。失败保留证据，不放宽预期。实际修订检查只作后续建议，不新增为第三个验收门槛。不改解析器、Runtime、DSL 或 UI。

## 实现评审修改

- [x] 移除 YAML 语法规则与 Procedure 实体 Schema 的撰写规范引用，并同步安装副本。
- [x] 中文名调整为“流程记忆撰写规范”，canonical name 保持不变。
- [x] 按字段职责、语义去重、约束作用域组织规则与对应正反例，根部仅保留规范概览。
- [x] 核对章节重组前后全部 10 条强制规则的实际投影保持一致。
- [x] 最终版本重新完成独立真实 A/B 验收、全量回归；第二轮评审材料已准备，随后上报。

## 实现评审第三轮修改

- [x] 启动策略测试移入 evals，手动执行，不纳入常规 CI。
- [x] 001 撰写要求和评分合并为一份复杂 Procedure，内部完成验证。
- [x] 002 review 样本和评分合并为一份复杂 Procedure，保留全部 10 个考点。
- [x] 重新完成单流程版本真实 A/B 验收；第三轮实现材料准备完毕后上报。

## 第三轮 Agent 证据意见修正

- [x] 接纳研发/架构意见，Runner 要求修改。
- [x] 恢复 A 原冻结独立业务 task，评分不变。
- [x] 生产规范新增通用业务完整性检查，保留原 10 条规则并同步安装。
- [x] 完整冻结后整轮重新执行新 A/B，均 10/10；所有历史记录保留。
- [x] 新生产内容变更级校验、Store、build/typecheck、相关测试及全量 141 文件通过；第四轮评审材料已准备。
