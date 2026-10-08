# 模型数据 Artifact

普通流程步骤可把完整模型值作为产物提交，并在接受后自动写入业务 Store：

```yaml
- !action
  action: 生成处理结果。
  artifact: !artifact
    name: 处理结果
    type: object
    format: json
    store: processing-results
    model: business/processing-result.json
    review: [产品负责人]
```

`store` 必须是当前 Run 所属 Project 已配置的 filesystem JSON ValueStore。`model` 可省略，从 Store 绑定推导；显式指定必须一致。不能同时声明 `schema`。对象和数组使用 JSON/YAML；字符串、数字和布尔值可使用 JSON/YAML 或 plain。标量的 type 必须符合既有显式声明规则，plain 字符串保留完整文本。条件 Artifact 不支持业务写入。

Run 启动时检查全部可达目标并冻结绑定及模型指纹。提交和接受写入前发现目标或模型变化会明确失败，恢复原绑定及定义后可重试。显示名称和标签不参与模型指纹。

每次步骤执行使用持久化 UUID。业务 ID 自动由 Run ID 和该执行 UUID 组成；失败重试或审核修改复用，循环下一轮和重复 Call 使用新 UUID。无需声明操作类型；可在上报时选择显式数据 ID。

## 稳定业务 ID

```bash
memsphere run report --run <run-id> --artifact-file result.json --data-id task-123
```

`--data-id` 仅支持绑定 Store 的普通模型 Artifact；对应 Run API 为可选 `dataId`。不同步骤、循环及 Run 可向同一 Store 的同一 ID 提交完整值。省略时保持上述自动 ID 行为。

ID 必须非空白、符合 filesystem JSON ValueStore 的可移植文件名规则；会同时检查 ID 与 `<id>.json`，包括 NFC、保留名、危险字符和 255 字节/字符限制。不修剪、不编码 ID。非法 ID 或非模型产物误用在目标冻结/业务写入前拒绝。

首个通过格式和模型校验的候选在评审或业务写入前冻结目标 ID。后续失败重试和评审修订省略参数时继承冻结 ID，显式传相同 ID 可重交，传不同 ID 则拒绝；默认生成的目标也不能在修订时改成显式目标。格式或模型校验失败尚未选定目标，可纠正值后选择其他 ID。循环及 Call 的新执行不继承上一执行的目标。

候选 `modelTarget`、评审材料和上报回执记录所选 ID，接受后的 `modelData` 回执记录写入 ID 和 revision。接受时核对 Submission 冻结目标，不更换 Store、模型、执行身份或 ID。业务 ID 与步骤/Submission 身份独立，旧 Submission 未含目标字段时按原默认生成规则接受。

首版没有 expected-revision 或 CAS。写入在记录锁内进行无条件整条原子 upsert，最后一次成功写入覆盖当前记录（包括移除本次未提交的可选字段），不合并字段。并发使用相同 ID 的 Run 可以覆盖彼此的更新；评审批准也不锁定业务记录的旧 revision。写入后 Run 保存失败仍以同 ID redo，允许 revision 增长。

## 两份持久化内容

当前版本仍保留完整不可变 Artifact 快照；业务 Store 接受后另存同一模型值。快照用于审核、历史查看和追溯，业务 Store 保存可更新的当前值。读取历史 Artifact 不读取业务 Store 当前值，也不把 revision 当作历史版本读取能力。

有 Review 时，候选只保存快照；要求修改时重交产生新的不可变 Submission。通过后执行整条 upsert，再保存 Run 推进状态。没有 Review 时，合法产物接受并写入后推进。写入失败不推进；业务数据成功而 Run 保存失败时，以同一数据 ID redo，允许 revision 增长。后续业务更新不改变快照。取消、删除或归档 Run 不联动删除业务数据，恢复不重复写入。

Run 的接受事件保存 Store、模型指纹、执行身份、业务 ID、digest 和可用 revision，不在业务模型值中添加框架字段。

通用数据 CLI 同样提供完整值 upsert：

```bash
memsphere data upsert record-id --store processing-results --value-file result.json
memsphere data upsert record-id --store processing-results --value-file result.json --dry-run --output json
```

upsert 在记录锁内创建或整条替换，不合并旧字段；不支持原始 DataStore、payload、patch 或 expected-revision。
