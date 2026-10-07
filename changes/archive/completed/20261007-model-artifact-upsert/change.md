---
id: 20261007-model-artifact-upsert
completed_at: 2026-10-07
type: feature
created: 2026-10-07
run_id: run-20261007-122734z-503afa2c
---

# 需求
流程的普通 Action 可产出模型数据 Artifact，目标模型由业务 store 推导；report 保留完整不可变快照，接受后另行将同一模型值原子整条 upsert 到业务 Store，成功才推进。自动生成执行实例与业务数据 ID，同次重试复用，不要求流程声明 create/update 或数据 ID。

完整需求见 requirement-contract.md；完整实施方案见 implementation-plan.md。Human 已正式通过需求契约及第二轮实施方案。新增 store/model 两个 YAML 关键字、首版 JSON ValueStore 范围、目标变化拒绝及标量模型表示已确认。

## 向前兼容
结论：不需要向前兼容。仓库没有名称包含 stable 的稳定 Tag checkpoint；保留无模型 Artifact 与旧 Run 的已有解释和运行，不补写历史业务记录。

## 范围与关联需求
第一版一步一条、JSON ValueStore、完整值替换、不可变 Artifact 快照、目标指纹检查与来源记录。批量记录、跨 Run 业务键、字段合并及历史版本共享存储不在本轮范围。
没有发现重复 active 需求。相关已完成能力：20261003-model-data-cli、20260929-artifact-datastore、20261006-app-composition。

# 验收标准
合法模型产物保存快照及业务数据；非法或目标变化不写且不推进；Review 未通过不写；循环/Call/不同 Run 的 ID 独立，重试复用；写入失败和 Run 保存失败后可重试；业务值后续修改不影响历史快照；业务生命周期独立于 Run；通过规定测试和 Memory ChangeSet 校验。

# 技术与测试方案
采用 implementation-plan.md；以既有 Run→Project→Record 锁、Runtime 和存储接口实现，复用已有原子发布。模拟 writeRun 失败验证 redo。受影响模块、CLI、Review、Memory、归档和全量检查按方案实际执行。

# 开发任务
原子 upsert 与 CLI；Artifact DSL；Run 目标冻结及执行身份；接受时写入与快照；Memory/Skill/文档同步；测试、独立 Agent 评审与 Human 验收。

# 验收结果
实现完成；本轮 npm test 全量回归 141 个文件、0 失败。新增模型 Run 用例 23/23、data-command 13/13 通过，typecheck 通过。研发、测试、架构 Agent 与 Human 实现验收全部通过，Runner 已接纳（review-20261007-140543z-a18a771a，Round 1）。Agent 各自审查工作区并复跑核心受影响测试；全量回归结果为本轮 Runner 实际执行证据。产品 Agent 与 Human 交付验收通过，Runner 已接纳（review-20261007-142944z-9d3d369e，Round 1）。产品 Agent 独立复跑全量 141 文件、构建、类型检查与模型 Run 测试通过。Human 手动上报示例 Run run-20261007-143411z-e1bbb569 已完成；业务数据 revision 1，值为 {"item":"机械键盘","quantity":2,"note":"我手动提交的"}，与完整 Artifact 快照一致。需求已完成实现、测试和验收，按交付规范归档。

Memory ChangeSet：change-20261007-135611678z-81ddf10f，校验通过，digest 8a3d8a67762fd0ffbf045503f16463b9f3888a2378faf243fa73941407a91f76。View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261007-135611678z-81ddf10f。
