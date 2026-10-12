已保存候选 YAML：

- [主流程](.memsphere/memory/procedures/emergency-data-repair-delivery.yaml)
- [独立验证子流程](.memsphere/memory/procedures/repair-reconciliation-verification.yaml)
- [共用方案 Schema](.memsphere/memory/schemas/repair-plan.yaml)

主流程通过真实 `!call` 获取验证结果，控制审批与演练循环，最终产物为交付报告。

ChangeSet `change-20261012-050814103z-c5716cdf`：合法性校验通过，已完成语义审查。[View 候选入口](/projects/writing-evaluation/changes/change-20261012-050814103z-c5716cdf)。

撰写 Run `run-20261012-050649z-f91af4b5` 已停在待 Human 验收处。未执行业务流程、未提交 Git、未发布。