---
id: 20261020-external-schema-reference-prefix
status: accepting
type: bug
created: 2026-10-20
run_id: run-20261020-073925z-58cadbfc
---

# 需求

Artifact 使用合法的外部 Schema 完整引用 `schemas/<canonical-name>` 时，Catalog 启动路径重复拼接 `schemas/`，导致 Run 在冻结 Schema 时启动失败。修复运行时引用适配，不修改合法已发布 Memory。

范围：顶层外部 Schema 查找及相关回归；不做 Run 数据迁移、引用语法扩展或全量 ChangeSet 启动模拟。重复需求与强关联需求：未找到本问题的重复记录。

# 验收标准

- Catalog 与 filesystem 路径均能使用顶层完整 `!ref` 启动并执行 Schema。
- 旧式裸 canonical name、内联和嵌套 Schema 保持正常。
- 启动后源 Schema 改动不改变既有 Run 的冻结内容。
- Schema 缺失时错误保留原始名称/引用，且不创建 Run。
- 受影响测试、typecheck、build、全量 npm test 与 memsphere validate 通过。
- 产品、研发、测试 Agent 按流程完成对应评审；修复 PR 的最新 head 全部适用 CI 通过后交由 Human 合入。

# 技术与测试方案

snapshotExternalSchemas 对完整 `schemas/` 引用原样 lookup，仅为裸名称补前缀；保留 schema.name 和持久化格式。原测试仅覆盖能识别前缀的 filesystem 分支，新增真实 DefaultMemoryCatalog 的同契约测试及缺失引用四组合。完整引用测试修改顶层和嵌套源定义后继续运行到 done，验证冻结稳定性。

现有 Memory / Skill 已声明合法 schemas/... 引用与解析冻结。本次恢复既有契约，不新增字段、命令或能力，不产生 Memory 差异或空 ChangeSet。

# 开发任务

- [x] 定位重复前缀与测试入口缺口。
- [x] 完成产品对 bug 理解、研发与测试对修复方案的 Agent 评审。
- [x] 修正 Catalog 查找输入。
- [x] 扩展完整引用、裸名称、内联、嵌套及缺失引用测试。
- [x] 完成本轮完整验证与验证摘要评审。
- [ ] 创建修复 commit / PR，并跟进全部适用 CI。
- [ ] Human 合入确认及本地分支清理。

# 验收结果

本轮当前代码验证：

- `node --import tsx --test test/run-store.test.ts test/run-command.test.ts test/project-memory-provider.test.ts test/run-start-cli.test.ts`：96 通过、1 Windows 专用项跳过。
- `npm run typecheck`：通过。
- `npm test`：150/150 文件成功，1268 通过、2 Windows 专用项跳过、0 失败，372.03 秒；包含 pretest 构建。
- `npm run build`：独立执行通过。
- `memsphere validate`：当前 Project Store 校验通过，无 Memory 差异，不创建空 ChangeSet。
- `git diff --check`：通过。

直接 bug 回归为 Run Store 的完整引用 Catalog 用例；run-start-cli 的原有跳过评审测试只算 CLI 冒烟。未重跑用户 memorybase 已发布流程，不宣称其所有业务流程均已验证；跨平台结果以后续 PR CI 为准。产品、研发、测试 Agent 均已通过最终验证摘要（review-20261020-075529z-91c71a51，第一轮）；PR、Human 合入及本地分支清理尚未完成。详细产物保存在关联 Run。
