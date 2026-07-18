# Procedure Boolean 控制约束

## 规则

boolean 是 Artifact 的业务 `type`，不是 format。它只允许用于 `!if` 和 `!while` 的 condition Action：

```yaml
- !if
  condition: !action
    action: 判断是否继续。
    artifact: !artifact
      name: 是否继续
      type: boolean
  then:
    - !action
      action: 记录结果。
      artifact: !artifact
        name: 结果
        type: string
```

普通 flow Action 使用 `type: boolean` 必须在 Memory parse/validate 阶段失败。If/While condition 使用非 boolean type 也必须失败。

boolean 省略 format，编译后显式保存 `{ name: "plain", options: {} }`。report 接受 `true/false` 以及现有兼容词，decoder 将其规范化为真实 boolean；RunEvent 保存 boolean 值，控制流只消费解码后的值。

旧写法 `format: boolean` 属于 Artifact Contract v1，只能通过迁移器读取：

```bash
memsphere migrate artifact-contract-v2 --check
```

验收测试应覆盖普通 Action 拒绝、If/While 接受、非 boolean condition 拒绝、RunEvent 类型和值以及分支/循环行为。
