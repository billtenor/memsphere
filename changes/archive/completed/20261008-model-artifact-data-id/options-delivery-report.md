# 发布前 write-options 调整交付报告

用户确认在 Issue #95 本次发布前，以统一写入选项入口替代尚未发布的独立 ID 参数，降低按上下文学习多个 flag 的成本。关联原 Run：run-20261008-064617z-ca3c75d4；该 Run 仍处于 Human 是否创建 PR 的决策步骤。本报告记录同一需求的补充修改，没有重写冻结 Review 或代替 Human 决策。旧 commit ee71c65 和旧评审为历史阶段证据，最终对外入口以下述内容为准。

## 最终行为

```bash
memsphere run report --run <run-id> --artifact-file result.json --write-options '{"data_id":"requirement-95"}'
```

`--write-options` 仅接受内联 JSON 对象，仅支持可选字符串 `data_id`。未知字段（包括 expected_revision）、非对象、非字符串/非法 ID、文件引用和 YAML 均拒绝。未发布的 `--data-id` 不保留别名。Run API 同步使用 `writeOptions?: { data_id?: string }`；内部持久化目标字段未变。

仅绑定业务 Store 的普通模型 Artifact 可用，包括空对象。合法上下文中 `{}` 使用默认生成目标或继承已有冻结目标；非模型、控制和 Schema 字段/收尾不接受。业务 Artifact 不嵌入这些选项，仍完整按模型校验。首次合法候选冻结目标、验收通过后写入、跨步骤/Run 相同 ID 完整替换、历史快照独立、失败重试保持目标等语义不变。无条件整条原子 upsert，最后成功写入覆盖；无 CAS 或 expected_revision。

## 修改与验证

CLI/help 与 command JSON 解析，project/model-artifact 共享严格 schema，Run API/校验路径，模型测试，以及中英文 docs、Skill、六份 System Memory 源和嵌入副本同步更新。需求契约、计划、任务追踪更新；旧实现/交付材料已标注被本报告覆盖，历史角色摘要保留。

最终模型文件根代理复跑：37/37 tests 通过，23.398 秒。新增/扩展验证涵盖真实 CLI、已移除参数拒绝、非法 JSON/类型/未知字段且无状态变更、空对象继承默认及显式冻结目标、非模型/控制/Schema 拒绝。首次新增测试 fixture 缺少格式声明，启动失败（36/37）；已修正合法 fixture 后根与研发/测试独立复跑全部通过，此失败未归为历史或环境问题。

根代理 npm run build、npm run typecheck、memsphere validate、git diff --check 通过；最终全量 npm test 141/141 文件、1167 tests（1166 passed、1 个 Windows 专属测试在 Linux 跳过）、零失败，294.73 秒，退出码 0。架构独立 parser 14项通过，六份源/嵌入副本一致；研发与测试分别独立复跑模型文件37/37，均 approve。产品最终补充交付复核已 approve（亲查源码/文档与 built CLI help/拒绝行为，未复跑模型或全量）。四角色均 approve，Runner 复核最终证据后接纳。上述为补充 Agent 角色审查，不冒充原 Run 的新冻结 Review。

## Memory 证据

ChangeSet：change-20261008-093640917z-58b657d1；passed。
Base：ee71c654ac902d40e7f5aa6cc2df16a2424185af。
Content Digest：d796c1a847acb78d1b9d7c1280459d9e0bb83a9c04493f8ea88cd68e29f6bb11。
View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261008-093640917z-58b657d1（记录 CLI 返回入口，未宣称服务可达）。旧 ChangeSet 属于旧入口阶段，不能替代当前证据。

## 限制与后续

Linux/Node 22 与真实 CLI 实测；未独立验证 Windows/macOS shell 引号使用。Repeat 无单独选项拒绝用例，源码在其控制分支前统一按无 Store 拒绝，已由测试角色确认非阻断。不引入文件/YAML解析、CAS、其他写入策略或 YAML DSL 关键字。
