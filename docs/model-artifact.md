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

每次步骤执行使用持久化 UUID。业务 ID 自动由 Run ID 和该执行 UUID 组成；失败重试或审核修改复用，循环下一轮和重复 Call 使用新 UUID。无需声明操作类型或数据 ID。

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
