# 实现与验证成果验收材料

## 评审对象

当前 Workspace 全部本迭代生产引导、安装同步、局部验收工具和证据改动，以及前序功能实现摘要和初始验证报告。请以本 Run 已确认的需求契约第二轮、方案第二轮和开发计划为基准独立评审，不仅检查本汇总。

## 直接检查入口

- `reserved-memory/system-memory/statements/memsphere-procedure-writing-rules.yaml`：四字段职责、语义去重、作用域和例子。
- `reserved-memory/system-memory/procedures/memsphere-procedure-construction.yaml`：全局规则下沉、规范读取、写作和评审入口。
- `src/skills/memsphere/SKILL.md`、Procedure Concept/Schema、YAML Action 章节、manifest 及五份 `.memsphere/memory` 副本：引用与安装一致性。
- `evals/procedure-writing-quality/`：固定业务任务、问题样本、Runner 评分、prepare/run helpers、文件系统隔离、代理继承和原始日志收集。
- `test/reserved-store.test.ts`、`test/eval-procedure-writing-quality.test.ts`：安装契约与新启动策略回归。

## 真实行为验收与原始证据

本 change 的 `behavior-verification.md` 解释全部逐项判断；`evidence/frozen-inputs.json` 是启动前的任务、考点、候选版本及全部基线文件摘要。试验后复核基线未被修改。

A 实际输出：`evidence/A-output/*.yaml`，Parent 判定 10/10 通过；主流程有三处 while、两处 if 和真正 call，独立子流程有结构化通过条件，不是简单线性例子。

B 首次 review：`evidence/B-review.md`。10 个预埋点由 7 条具体意见全部覆盖，另有 5 条有效补充问题，正确保留项无误报；详细映射见 `evidence/behavior-grading.json`。额外问题未被补写为新的预设答案。

`evidence/A-attempt-1/`、`B-attempt-1/` 保留首轮模型连接环境失败，未产生行为产物；`A-attempt-2/`、`B-attempt-2/` 保留实际成功子 Agent 的原始 JSON 事件、stderr、最终回答、模型配置及隔离证据。没有通过定向纠错提示使同一 Agent 重计首次成功。隔离正负探针、网络和 CLI smoke 见同目录及 `*-final-isolation-probes.json`。

## 当前验证结论

- 64 项相关 Memory/安装测试通过，3 项新增启动策略测试通过。
- 最终全量 142 个文件零失败，1169 用例通过；1 个既有 Windows 专用用例在 Linux 跳过。原始日志见 `evidence/full-tests.log`，统计见 `regression-summary.json`。
- 最终 typecheck、build、Store、源/副本一致性和引用检查通过；A 实际候选及 B 样本也各自从正确隔离仓库重新校验通过。
- 最终 Memory ChangeSet：`change-20261012-040452784z-0c41dc69`，passed，摘要 `c543a2144c82757759cb11d388f0c04af65152c044205ff19dc655f68a8f5cee`。
- View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-040452784z-0c41dc69 。

## 已知边界与请重点核查项

结论限定于本次冻结案例和 gpt-6.1-sol medium。没有运行批量历史治理、其他模型/跨平台评测或被编写的业务流程。实际修订验收只作后续建议，仍以 Human 确认的 A/B 两项作为本轮门槛。

B 的临时内部审查记录 Run 因禁止提权停在 run report，但实际 review 文件完整交付；未声明内部 Run 已完成，也未以其生命周期状态作为行为通过依据。生产敏捷 Run 正常推进。

请亲自检查：规则是否仍重复或作用域过宽；入口是否真的完整读取例子；评分是否遗漏/误判；隔离是否可绕过读取考点；代理修复与现有 HOME/CODEX_HOME 身份是否正确保留；证据是否支持实际执行和全部考点命中。最终摘要区分亲自检查、亲自复跑及仅引用的证据。临时 node_modules 依赖链接仅供本次本地测试，不作为提交内容。
