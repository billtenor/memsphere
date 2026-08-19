# Schema Contract v2 非兼容升级步骤

## 变更范围

Schema Contract v2 为 Schema 增加可选 `type` 与 `format`，删除 `element_types`，并将旧版字符串 `items` 升级为 `item/items` Schema 契约。Schema type 不继承：有 fields 时缺省为 `object`，无 fields 时缺省为 `string`；array、number、boolean 必须显式声明。Schema format 省略时继承父 Schema，根 Schema 继承所属 Artifact。

字符串字段简写始终表示 `string` 叶子，并继承父级 format。Markdown layout 仅由兼容的结构节点继承，标量字段会移除 outline/table。array Schema 使用 `item` 约束唯一元素结构，或使用 `items` 表达至少两个候选组成的联合元素约束；array 不再直接声明 `fields`。没有 `item/items` 时只校验数组容器，不校验成员类型。

## 升级前检查

1. 停止修改目标 Project 的 Memory Store，并用 `memsphere project show` 确认目标 Project。
2. 运行只读检查：

```bash
memsphere migrate schema-contract-v2 --check
```

3. 逐项处理 manifest 中的 blocker：
   - `migration.schema.array_context_required`：先为 Schema 或所属 Artifact 明确合法的 array type/format。
   - `migration.schema.member_type_required`：旧 `element_types/items` 必须至少包含一个成员类型。
   - `migration.schema.member_type_unsupported`：旧成员名称不是可迁移的 Artifact value type，需要人工改写为 `!schema` 候选。
   - `migration.schema.fields_without_object_member`：旧数组同时声明 fields，但成员候选中没有 object/Schema，需人工确定字段属于哪个对象候选。
4. 检查所有 type 推断和 format 继承是否符合预期。根 array Schema 及任何数组子节点必须显式写 `type: array`；format 可以继承，但切换为 Markdown table 时必须显式声明 `layout: table`。旧 `array + fields` 应迁移为 `array + item(type: object, fields: ...)`。

## 写入与回滚

确认 check 为 `ready` 后执行：

```bash
memsphere migrate schema-contract-v2 --write
```

`--write` 只用于 Embedded Store。Managed Store 必须通过 ChangeSet 提交迁移结果，不能直接修改正式工作树。

命令会在 `.memsphere/migrations/schema-contract-v2/<timestamp>/` 下生成完整 staging、变更文件 backup 和 manifest，先验证 staging，再原子替换真实文件并复验 Memory Root。写入失败时自动从 backup 恢复已替换文件。

如需人工回滚，停止写入后按 manifest 的 `backupRoot` 将对应文件恢复到目标 Project Memory Store，随后运行 `memsphere validate`。

## 升级后验证

```bash
memsphere validate
memsphere migrate schema-contract-v2 --check
```

第二次 check 应为 `ready` 且所有文件 `changed: false`。随后至少验证一个 JSON/YAML 递归对象、一个 Markdown outline 内嵌 table，以及一次失败 report 不产生 Run event 或受管 Artifact 文件。

历史 Run 与 Review snapshot 不改写。View 对其中遗留的 `element_types` 仅作“旧版元素类型（只读）”标注。
