# 开发计划

- [x] 复核前序候选目录、原位展开与 ChangeSet 跳转修复。
- [x] 临时 snapshot summary 不写长期索引；候选和基线各自共享一次性 RuleLookup。
- [x] 无效引用只隔离自身，保留同字段有效成员并使用既有去重投影。
- [x] 增加混合引用和同时修改引用方/目标的版本隔离回归。
- [x] 执行受影响测试、typecheck、build、npm test、Store 校验及 playwright-cli 操作，保存本 Run 证据。
- [x] 上报实现摘要、初始验证、完整实现评审材料；由研发/测试/架构独立审查。
- [x] 产品负责人切换 Human，仅在最后交付报告进行需求验收。
- [ ] 验收后更新状态/归档、commit、PR、跟进适用 CI；由 Human 操作最终合入。
