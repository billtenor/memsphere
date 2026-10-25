> 历史材料：以下保留原轮次内容；当前契约以[修订需求](requirements-revised.md)及[实施方案](implementation-plan.md)为准，完整根持久化、增量维护和旧接口描述已被取代。

# 实施与验证方案第1轮修改记录

## Human修改意见（已正式提交）

1. Run.outputArtifactIds统一当前成果和最终根，替换finalArtifactIds，同步说明与示例。
2. 成功report增量移出实际Artifact依赖及revisedFrom旧版，再加入新产物；手动移出不因全图重算恢复。
3. outputs list查询，outputs update支持重复--add／--remove和一次替换；只有update接入Continue。
4. 默认图从成果根展开，空集合不回退全图，保留历史及浮窗行为，无需另加聚焦按钮。

## Agent意见与处理

- 研发、架构、测试提出当前需求基线及范围确认记录不清楚：采纳澄清要求。独立修订需求已先行冻结，补充已有Human明确确认来源，保留原flow[1]和正式票；不将本轮技术投票解释为未来补取需求授权。Procedure未要求重放已结束Action，因此不另造需求通过票。
- 测试指出跨Store部分写入验证不具体：采纳。在实施方案新增启动、终止、outputs／Step写入中断的故障点和text／JSON／查询／redo断言。

## 已完成与未完成

仓库Run模型定义、字段说明及示例已调整并通过Runtime校验；真实Store及页面未切换，随实施适配。新一轮提交覆盖本记录和完整修订需求；不把设计阶段校验写成实现验收。
