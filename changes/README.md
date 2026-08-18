# Changes

每个需求使用一个目录和一份 `change.md`。新需求放在 `active/<YYYYMMDD-slug>/change.md`。

Active 状态只有三种：

- `todo`：尚未开发。
- `doing`：正在开发。
- `accepting`：开发完成，正在测试或等待验收。

验收标准全部通过、项目回归测试完成并由提需方确认后，将整个目录移动到 `archive/completed/`。取消的需求移动到 `archive/cancelled/<YYYY>/`，并在文档中记录原因。

Project 根目录下的 `runs/` 保存详细流程产物；`change.md` 保存需要长期追踪的需求、方案、任务和验收摘要，并可通过 `run_id` 关联对应 Run。

最小文档头：

```yaml
---
id: 20260720-example
status: todo
type: feature
created: 2026-07-20
run_id:
---
```

正文至少包括需求、验收标准、技术与测试方案、开发任务和验收结果。完成归档后可移除 `status`，增加 `completed_at`。
