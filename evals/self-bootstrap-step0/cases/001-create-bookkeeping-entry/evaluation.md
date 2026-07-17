# 评分指南

本文件只供父 agent 评分使用，其内容不得展示给子 agent，也不得复制到临时工作区。

## 期望产物

子 agent 应当读取 fixture 中预置的“记账”Concept 记忆，并据此创建 `artifacts/bookkeeping.md`。本 case 不要求子 agent 编写或修改任何 Memory。

“记账”记忆通过三类 `defines` 成员共同定义产物：

- 字符串定义说明一条记账表示一次收入或支出。
- 匿名 Statement 约束金额、日期、类型、备注内容和实例保存方式。
- 匿名 Schema 规定 Markdown 使用多级标题，并包含日期、类型、金额、分类和备注。

参考产物如下：

```markdown
# 记账

## 日期

2026-07-15

## 类型

支出

## 金额

32.50

## 分类

餐饮

## 备注

午餐费用
```

## 必须满足

- 创建了 `artifacts/bookkeeping.md`，且它是可读的 Markdown 文件。
- 使用 Schema 指定的 outline 结构表达日期、类型、金额、分类和备注五个字段。
- 日期是 `2026-07-15`。
- 根据“我支付了”正确推断类型是“支出”。
- 金额是正数 `32.50`；允许展示为 `32.5`、`32.50 元` 或其他不改变数值的形式。
- 根据“午餐”正确推断分类是“餐饮”。
- 备注非空，并表达本次费用与午餐有关；可以同时包含同行人或用餐场景。
- 产物没有出现与记忆约束冲突的内容。
- 子 agent 从 Memory 中得知实例应保存为 `artifacts/bookkeeping.md`，而不是由任务直接获得文件路径和格式。
- 子 agent 实际读取了当前工程中的“记账”Memory。
- 没有修改 `.memsphere/memory/` 或 `.memsphere/reserved-memory/` 中的任何 Memory。
- 最终回复指出产物路径。

## 允许差异

- 标题层级的具体深度可以略有差异，但五个字段必须清楚可辨，并保持 outline 形态。
- 字段顺序应当遵循 Schema；若内容完整且仍清晰可读，轻微的非语义性 Markdown 差异不判失败。
- 备注可以写成“午餐”“午餐费用”“和同事一起吃午餐”或其他语义等价表达。

## 失败条件

- 只在回复中描述结果，没有创建 `artifacts/bookkeeping.md`。
- 没有读取“记账”Memory，仅凭常识自由设计产物。
- 缺少任一 Schema 字段，或者没有采用 Markdown outline 结构。
- 将类型写成“收入”，金额写成非正数，或出现其他违反 Statement 的内容。
- 备注为空，或完全没有表达本次费用对应的内容。
- 没有按照 Memory 中的规则创建 Markdown 文件，或保存到其他路径。
- 修改、删除或新增了任何 Memory 文件。

## 无效条件

- 子 agent 读取了本 `evaluation.md`。
- 子 agent 读取了临时工程外的源仓库文档、源代码、Reserved Memory 源文件、其他 case 或旧 memsphere skill。
- 子 agent 继承了此前讨论 memsphere 的对话上下文，或在任务开始后收到父 agent 的提示。

## 结论

- `pass`：满足全部必需条件，且没有失败或无效条件。
- `fail`：验收过程未受污染，但出现至少一个失败条件。
- `invalid`：出现任意无效条件，无论答案是否正确。
