# 流程记忆依赖图语法设计

本文整理以 Action 和依赖关系定义 Procedure 的图编排语法。Procedure 通过 `mode` 区分原有的 `flow` 模式和新的 `graph` 模式，两种模式并行保留。下文除模式说明外，均描述 `graph` 模式：Action 描述生产工作、产物和评审要求；依赖关系决定何时执行；聚合 Action 收集具体产物的引用。

运行语法：`memsphere-20261027-stable`。新建 graph Procedure 必须填写该版本；旧 `memsphere-20260721-stable` 按原 flow 语义保留。完整示例可通过 `run start --file` 执行。

2026-10-27 共同探索调整：不提供启动时结构化业务参数或 Run 级 `input`。入口 Action 收集或读取业务材料并形成 Artifact，后续通过依赖传递。运行时和 CLI 的整合方案见 `changes/active/20261026-procedure-graph/implementation-plan.md`；以下说明 graph 的语法和执行语义。

本版包括顺序、固定并行、条件分支、循环、汇合和产物聚合。不包括 `forEach`、Send、动态批次、`wait: batch`、`defer`、子图、跨图跳转，以及新增的全局业务 State。

## 定义与执行

| 对象 | 含义 |
| --- | --- |
| Procedure | 流程定义；flow 模式使用过程控制，graph 模式使用允许有环的生产定义图 |
| Action | 图中的生产定义；多次执行仍然是同一个定义 |
| Dependency | 某个 Action 的一条入边或一组共同等待的入边 |
| Run | 图的一次运行，保存调度与执行状态 |
| Step | 某个 Action 的一次执行实例 |
| Artifact | 一次生产得到的具体产物；已提交后不可修改 |

同一个 Action 在循环中执行十次，会创建十个 Step。同一个 Step 因评审要求修改，可以产生多份先后提交的 Artifact，最终采用其中一份。草稿更新保持 Artifact ID，已提交产物的修改创建新的 ID。

Action 的生产定义图可以有环；具体 Artifact 的依赖图仍然是 DAG。循环不会把新结果写回旧的已提交 Artifact。

## Procedure

根节点使用 `!procedure`。`mode: graph` 时通过 `actions` 声明 Action，数组顺序只用于阅读和展示，不决定执行顺序；`mode: flow` 时继续使用原来的 `flow` 过程结构。

| 字段 | 要求 | 含义 |
| --- | --- | --- |
| `syntax` | 正式语法发布时确定 | 新版语法标识；本文示例省略 |
| `mode` | 可选，默认 `flow` | 编排方式，只允许 `flow` 或 `graph` |
| `name` / `names` | 二选一 | 沿用流程记忆的规范名称与别名规则 |
| `defines` | 必填 | 非空自然语言说明数组，描述流程用途 |
| `goals` | 可选 | 非空字符串数组，描述目标 |
| `asserts` | 可选 | 整个运行必须遵守的约束 |
| `actions` | graph 模式必填 | 非空新版 `!action` 数组；flow 模式不允许 |
| `flow` | flow 模式沿用原有要求 | 原有过程控制结构；graph 模式不允许 |

### 编排模式与默认规则

| mode | 编排结构 | Action 与产物契约 |
| --- | --- | --- |
| `flow` | 使用 `flow`、`!if`、`!while` 等原有过程控制语法 | 沿用对应 syntax 版本的旧 Action 与产物定义 |
| `graph` | 使用 `actions` 与 `dependencies`，通过条件和回边表达分支、循环 | 使用本文的 description、model、payload 与 collect 等定义 |

- 省略 `mode` 等价于 `mode: flow`，旧记忆无需为了选择模式而批量修改。
- 图编排必须显式声明 `mode: graph`；不能根据出现了 `actions` 就自动切换模式。
- 同一份 Procedure 不允许同时声明 `flow` 和 `actions`，也不能在一个模式中混入另一个模式的节点语法；字段冲突应报错，不静默忽略。
- `mode` 只属于 Procedure 根节点，不加到 Concept、Statement、Schema 或嵌套 Action 上。
- `syntax` 表达语法版本，`mode` 表达编排方式。支持新语法的同一个 syntax 版本可以同时支持 flow 和 graph；增加 mode 不代表旧解析器或旧 syntax 版本已经认识新字段。
- Run 按创建时保存的记忆快照解析有效 mode；快照没有 mode 时按 flow 处理。后续修改来源记忆的 mode，不改变已有 Run 的执行方式。

在 graph 模式中，不使用 `flow`、`!if`、`!while`、`then`、`elseif`、`else` 和 `do` 编排。`!call` 不在 graph 模式本版范围内；flow 模式的既有能力继续保留。

## Action

每个 Action 使用 `!action`。普通 Action 声明 `artifact`，聚合 Action 声明 `collect`，两者必须且只能填写一个。

| 字段 | 要求 | 含义 |
| --- | --- | --- |
| `id` | 必填 | 当前 Procedure 内唯一的非空标识，供依赖和聚合引用；`START` 为保留值 |
| `description` | 必填 | 自然语言描述工作；替代旧版的 `action` 字段 |
| `dependencies` | 必填 | 非空 `!dependency` 数组；入口也显式声明 |
| `actor` | 普通 Action 可选 | `agent` 或 `human`，默认 `agent` |
| `asserts` | 可选 | 生产过程必须遵守的要求 |
| `suggests` | 可选 | 对生产过程的建议 |
| `artifact` | 普通 Action 必填 | 要生产的产物及其要求 |
| `collect` | 聚合 Action 必填 | 要收集产物的 Action ID 数组，非空且不重复 |

`asserts`、`suggests` 沿用自然语言规则及现有 Statement `!ref` 引用方式。Action 层约束生产过程，`artifact` 层约束产物，不重复填写同一条要求。

聚合由运行时执行，不填写 `actor`，也不发起独立产物评审。`description` 用于说明聚合用途；要收集哪些产物由 `collect` 决定，不从自然语言中推断。

### 普通 Action 示例

```yaml
!action
id: analyze
description: 分析输入资料，识别主要问题并形成结论。
actor: agent

dependencies:
  - !dependency
    from: prepare

asserts:
  - 只能依据提供的资料进行分析。
suggests:
  - 优先调查影响最大的问题。

artifact:
  name: 分析报告
  asserts:
    - 每项结论必须说明依据。
  suggests:
    - 先给出结论，再展开依据。
  model:
    definedBy: json-schema/draft-07.json
    definition: '{"type":"string","minLength":1}'
  payload:
    contentType: text/markdown
  review:
    - 领域专家
```

## 产物要求

`artifact` 是要求声明，不是运行时的 Artifact 记录。使用普通 YAML mapping，不再使用旧的 `type + format + schema` 契约，也不要求额外的 `!artifact` 标签。

| 字段 | 要求 | 含义 |
| --- | --- | --- |
| `name` | 必填 | 产物名称 |
| `asserts` | 可选 | 产物必须满足的自然语言要求 |
| `suggests` | 可选 | 对产物的建议 |
| `model` | 必填 | 产物模型要求 |
| `model.definedBy` | 必填 | 解释模型定义的元模型 ID |
| `model.definition` | 必填 | 模型定义的 JSON 文本，是字符串而不是 YAML 对象 |
| `payload` | 必填 | 产物内容的表达要求 |
| `payload.contentType` | 必填 | 产物内容的 MIME 类型，决定解码方式 |
| `review` | 可选 | 非空且不重复的 Review Slot 名称数组 |

Slot 表达评审视角，具体参与者、权限、是否跳过及决策规则由 Run 的配置决定。自然语言要求交给生产者和评审者理解，模型约束由相应模型运行时校验。

声明中没有正文，因此没有 `payload.content`。模型定义中的 `type` 是元模型自身的语法，不是恢复旧版 `artifact.type` 字段。

运行时的正文保存于 Artifact 的 `content` 或 `contentRef`。Artifact 的 ID、状态、实际依赖和修订记录不写进 Action 定义。本轮 graph 的模型用于校验正文，接纳后保存到 context_control Artifact Store；不提供向业务 Store 写入的绑定或 `--write-options`。Step 的 `artifactStore` 仍属于既有 flow/模型 Artifact 机制，graph 不设置该字段。

## Dependency

每条依赖使用 `!dependency`，定义在目标 Action 的 `dependencies` 中。目标就是当前 Action，不另写 `to`，也不维护独立的 edges 列表。

| 字段 | 要求 | 含义 |
| --- | --- | --- |
| `from` | 必填 | 一个 Action ID，或非空且不重复的 Action ID 数组；入口使用 `START` |
| `when` | 可选 | JSONata 表达式；结果必须为 boolean，省略表示无附加条件 |

### 单个前序

```yaml
dependencies:
  - !dependency
    from: A
```

A 的某次 Step 完成后，为这条依赖提供一次完成信号和对应产物。有评审时，完成指产物已按本次评审规则被接纳；提交、保存草稿或单个 Reviewer 投票本身不构成完成信号。

### 多条依赖独立触发

```yaml
dependencies:
  - !dependency
    from: A
  - !dependency
    from: B
```

每条依赖独立判断，各自满足就各创建一个 Step。A、B 都完成时触发两次，不因为同时完成而合并。这是本设计选择的规则，与 LangGraph 普通边按 superstep 合并触发不同。

重复读取、刷新或恢复运行不能重复消费同一个完成信号。循环中产生新的 Step 完成信号，则可以再次触发。

### 多个前序共同完成

```yaml
dependencies:
  - !dependency
    from: [A, B]
```

这是一个汇合：记录 A、B 是否已提供完成信号，全部满足后评估一次 `when`。条件为 true 时创建一个 Step，为 false 时本次不触发；完成信号被消费后重置汇合记录，等待下一次。表达式求值错误是执行错误，不当作 false 静默跳过。

汇合沿用 LangGraph 的节点完成标记思路，不是按次数配对的队列。在一次等待期间 A 完成两次、B 完成一次，只形成一次汇合，不自动保留额外的 A 作为下一轮配额。同一来源多次完成时，本次汇合使用求值前该来源最近的完成产物；求值时固定具体引用。

汇合不推断业务轮次。需要逐轮配对时，应通过图结构保证本轮汇合后才进入下一轮；交错批次的关联不在本版范围内。

### 入口与结束

```yaml
dependencies:
  - !dependency
    from: START
```

`START` 在 Run 创建后提供一次入口信号，不是一个真实 Action，也不生产 Artifact。本版不提供启动时结构化业务参数，入口 Action 自行收集、读取或向 Human 询问材料并产出 Artifact。仅有 START 来源的条件上下文没有上游产物，不提供 Run 级 `input`。

没有显式 `END`。没有后继的 Action 完成，表示该执行路径结束；所有后继条件均不满足时，该路径也结束。Run 正常结束需要所有已启动工作、评审和触发判断处理完，没有待执行任务，也没有尚未满足的部分汇合。

从未激活的条件分支不属于待执行任务。已经收到部分完成信号、却永远等不到其他来源的汇合属于无法继续，不能自动按成功结束。Run 如何表示该诊断不在本语法中新增状态枚举。

路径结束不等于选择最终交付物。最终交付通过 Run 的推导成果及 `outputOverrides` 人工增删表达，并在结束时确认，不在这里恢复 `artifact.final` 或 `isFinal`。

## 条件表达式

`when` 完全采用 JSONata，不自定义比较、逻辑、过滤或函数语法。推荐用 YAML 单引号包住表达式。

```yaml
dependencies:
  - !dependency
    from: [A, B]
    when: 'artifacts.A.approved = true and artifacts.B.score >= 80'
```

运行时准备 JSON 兼容的值作为表达式输入：

```json
{
  "artifacts": {
    "A": { "approved": true },
    "B": { "score": 90 }
  }
}
```

普通来源的键是 Action ID，值是本次依赖所绑定的产物内容。只暴露当前依赖的直接材料，以及聚合来源展开的成员，不隐式查询全 Run 的最新产物，也不注入 Run 级初始 `input`。

包含连字符的 Action ID 使用 JSONata 的反引号字段语法：

```yaml
when: 'artifacts.`analyze-materials`.approved = true'
```

| 用途 | JSONata 表达式 |
| --- | --- |
| boolean 产物 | `artifacts.check = true` |
| 字段比较 | `artifacts.A.score >= 80` |
| 逻辑组合 | `artifacts.A.approved and artifacts.B.ready` |
| 检查可选字段 | `$exists(artifacts.A.reason)` |
| 检查是否有明确未通过的成员 | `$count(artifacts.analyze[approved = false]) > 0` |

读取流程是：读取 `content` 或解析 `contentRef` → 按 `payload.contentType` 解码 → 按 `model` 校验 → 提供给 JSONata。传入的是内容值，不是 model 定义或序列化后的 JSON 字符串。

JSON 对象可访问字段；Markdown、普通文本仍是字符串。其他格式必须有明确的解码能力并能转为 JSON 兼容值；未支持的格式不能假定可读取字段。

引用读取、解码、模型校验或表达式执行失败都报告错误，不丢弃材料。字段缺失、null、逻辑运算等内部语义遵循 JSONata；我们只要求最终结果为 boolean，不再额外改变语言规则。`approved = false` 只筛选明确为 false 的成员，不等于覆盖所有不完整或非法成员，字段完整性由产物模型负责。

## 聚合 Action

聚合使用 `collect` 替代 `artifact`。`collect` 引用同一 Procedure 中的普通产物 Action，本版不支持递归收集聚合 Action。

```yaml
!action
id: gather
description: 收集本次运行中全部分析产物。
dependencies:
  - !dependency
    from: check
    when: 'artifacts.check.hasMore = false'
collect:
  - analyze
```

收集范围是当前 Run 内，截至这次聚合执行时，各来源 Action 所有已完成 Step 实际采用的已提交产物。草稿、尚未完成评审的候选，以及同一个 Step 被替代的提交不进入集合。

按 Step 创建顺序排列，同一来源产物去重；没有结果时保留空数组。聚合结果保存为具体 ID 数组，完成后固定，不随未来生产增长。它属于本次聚合 Step 的执行结果，不创建新的 Artifact；具体持久化字段在执行器实现时确定。

```json
{
  "analyze": ["artifact-analysis-01", "artifact-analysis-02"]
}
```

聚合不等待未来的产物，也不判断循环是否结束。作者必须通过依赖图保证聚合被触发时所需生产已经完成。例如严格串行的“判断 → 分析 → 判断”循环，退出判断发生时分析已完成，且不再创建下一轮。

再次执行聚合，会重新收集当前 Run 截至当时的全部结果；它不自动排除上次已收集成员，不暗含“本批”或“本轮”的范围。

### 下游读取聚合结果

下游依赖聚合 Action 的完成信号：

```yaml
dependencies:
  - !dependency
    from: gather
    when: '$count(artifacts.analyze) > 0'
```

求值时按原始 Action ID 展开内容，不增加 `gather` 或 `aggregate` 包装层：

```json
{
  "artifacts": {
    "analyze": [
      { "approved": true, "score": 90 },
      { "approved": false, "score": 60 }
    ]
  }
}
```

普通来源对应单份内容，聚合展开的来源始终对应数组，包括只有一份或零份的情况。集合成员读取失败时不能只删除失败成员再求值。

若同一条依赖同时引入普通 A 和聚合中的 A，或两个聚合都展开同名来源，必须报告上下文键冲突，不能静默覆盖；本版不增加别名或自动合并规则。

下游普通 Artifact 的实际依赖关联到被使用的具体 Artifact ID，不指向一个不存在的“聚合 Artifact”。调度来源仍可追溯到聚合 Step。条件使用的判断材料也需要在执行记录中可追溯。

## 完整示例

以下流程逐份分析资料，退出循环后收集全部分析结果，再生成总结。Action ID 使用英文短名，产物名称与工作描述使用中文。

| Action ID | 工作 |
| --- | --- |
| `prepare` | 收集或读取待分析资料，产出固定资料列表 |
| `check` | 判断是否还有待分析资料 |
| `analyze` | 分析一份资料 |
| `gather` | 收集全部已完成的分析产物引用 |
| `summarize` | 根据聚合后的分析结果生成总结 |

示例中 prepare 收集到资料甲、资料乙，提交 `{"remaining":["资料甲","资料乙"]}`。Run 启动命令不携带结构化业务参数；准备好的资料和后续剩余资料都通过不可变 Artifact 传递，不建立可变全局 State。

```yaml
!procedure
syntax: memsphere-20261027-stable
mode: graph
names:
  - analyze-materials
defines:
  - 逐份分析输入资料，在全部完成后形成总结。
goals:
  - 每份资料都有可追溯的分析结果。
  - 总结覆盖全部已完成的分析结果。

actions:
  - !action
    id: prepare
    description: 收集或读取本次待分析资料，按原顺序填写 remaining；没有资料时填写空数组。
    actor: agent
    dependencies:
      - !dependency
        from: START
    artifact:
      name: 待分析资料
      model:
        definedBy: json-schema/draft-07.json
        definition: |
          {
            "type": "object",
            "properties": {
              "remaining": {
                "type": "array",
                "items": { "type": "string" }
              }
            },
            "required": ["remaining"],
            "additionalProperties": false
          }
      payload:
        contentType: application/json

  - !action
    id: check
    description: |
      从本次 prepare 或 analyze 上游产物的 remaining 读取剩余资料。
      原样返回 remaining，并按其是否为空填写 hasMore。
    actor: agent
    dependencies:
      - !dependency
        from: prepare
      - !dependency
        from: analyze
    artifact:
      name: 剩余资料检查
      asserts:
        - hasMore 必须与 remaining 是否非空一致。
      model:
        definedBy: json-schema/draft-07.json
        definition: |
          {
            "type": "object",
            "properties": {
              "hasMore": { "type": "boolean" },
              "remaining": {
                "type": "array",
                "items": { "type": "string" }
              }
            },
            "required": ["hasMore", "remaining"],
            "additionalProperties": false
          }
      payload:
        contentType: application/json

  - !action
    id: analyze
    description: |
      分析检查产物 remaining 中的第一份资料。
      把原资料写入 material，把结论写入 finding，
      将其他尚未处理的资料按原顺序保存为 remaining。
    actor: agent
    dependencies:
      - !dependency
        from: check
        when: 'artifacts.check.hasMore = true'
    artifact:
      name: 单份资料分析
      asserts:
        - 结论必须以 material 为依据。
        - remaining 必须准确保留其余待处理资料。
      model:
        definedBy: json-schema/draft-07.json
        definition: |
          {
            "type": "object",
            "properties": {
              "material": { "type": "string" },
              "finding": { "type": "string" },
              "remaining": {
                "type": "array",
                "items": { "type": "string" }
              }
            },
            "required": ["material", "finding", "remaining"],
            "additionalProperties": false
          }
      payload:
        contentType: application/json
      review:
        - 领域专家

  - !action
    id: gather
    description: 收集本次运行中全部已完成的单份资料分析产物。
    dependencies:
      - !dependency
        from: check
        when: 'artifacts.check.hasMore = false'
    collect:
      - analyze

  - !action
    id: summarize
    description: |
      综合 artifacts.analyze 中每份产物的 material 和 finding，生成总结。
      没有分析产物时，明确说明本次没有需要分析的资料。
    actor: agent
    dependencies:
      - !dependency
        from: gather
    artifact:
      name: 分析总结
      model:
        definedBy: json-schema/draft-07.json
        definition: '{"type":"string"}'
      payload:
        contentType: text/markdown
```

执行关系：

```text
START → prepare → check
                    ├─ hasMore 为 true  → analyze → check
                    └─ hasMore 为 false → gather  → summarize
```

两份资料对应两次 analyze 执行。只有每次分析完成并通过所需评审，才会继续 check。最后一次 check 退出时，不存在尚未结束的分析分支，gather 可以固定完整集合。prepare 提交空资料数组时，不执行 analyze，gather 返回 `{"analyze":[]}`，总结仍能执行。

该例不承诺任意并行图都能用退出判断证明集合完整；若另有路径还会生产 analyze，必须另行建立正确的完成依赖，不能靠 collect 猜测。

# Syntax 关键字变更

本节列出新版流程语法的变更清单。它不表示当前稳定语法已经支持这些字段，也不授权顺带实现本版范围之外的语法。

| 关键字或标签 | 允许位置 | 值结构与含义 |
| --- | --- | --- |
| `mode` | `!procedure` 根节点 | `flow` 或 `graph`；省略默认 flow，仅显式 graph 使用图编排 |
| `actions` | `mode: graph` 的 `!procedure` | 新版 `!action` 数组，与 flow 互斥；不移除 flow 模式 |
| `id` | `!action` | 唯一非空字符串，供依赖与聚合引用 |
| `description` | `!action` | 非空工作说明，替代 action 字段 |
| `dependencies` | `!action` | 非空 `!dependency` 数组，声明触发规则 |
| `!dependency` | dependencies 的每一项 | 由 from 和可选 when 组成的 mapping |
| `from` | `!dependency` | 单个 Action ID 或非空 ID 数组；START 为入口保留值 |
| `when` | `!dependency` | JSONata 表达式字符串，最终结果为 boolean |
| `collect` | 聚合 `!action` | 非空且不重复的普通 Action ID 数组；与 artifact 互斥 |
| `model` | artifact | 由 definedBy、definition 组成的模型要求对象；替代旧模型引用字段形态 |
| `definedBy` | artifact.model | 元模型 ID 字符串 |
| `definition` | artifact.model | 模型定义的 JSON 文本字符串 |
| `payload` | artifact | 内容表达要求对象；定义阶段不含正文 |
| `contentType` | artifact.payload | MIME 类型字符串 |
| `asserts` / `suggests` | 新增允许在 artifact 中 | 沿用规则数组结构；此处约束产物，Action 层约束过程 |

除 mode 外，上表的新增或调整均作用于 graph 模式，flow 模式保留对应 syntax 版本的既有规则。`!procedure`、`!action`、`actor`、`review`、流程名称、目标和规则引用沿用既有概念。graph 模式的 `artifact` 调整为普通 mapping；旧的 `!artifact` 标签不作为 graph 模式要求。`START` 与求值上下文中的 `artifacts` 是约定的值或数据名称，不是新的 YAML 标签。

本版不采用 `triggers`、独立 `edges`、`inputs`、`select`、`aggregate` 包装层、`defer`、`forEach` 或 `wait` 字段。条件使用 JSONata，不能混入先前讨论过的 JavaScript 风格 `==`、`&&`、`||`。

## 实现边界

graph 使用独立模型 Store 执行；省略 mode 的旧流程继续按 flow 执行，不强制迁移。新 syntax 为 memsphere-20261027-stable，显式迁移仅更新版本标识。Run.frames 的 type: graph 保存调度、汇合与恢复记录，Step 保存固定输入、状态和正式采用的产物；旧 flow 实现与存储继续保留。

Artifact 模型定义及实际内容不可混淆；普通 Action 对应的产物要求可以映射到 Step 的 artifactSpec，review 对应 reviewSlots。图语法中的 dependencies 表达执行触发和材料来源，运行时 Artifact.dependencies 保存实际使用的具体材料 ID，两者不直接复制字段值。

本版不引入业务全局 State，但 Run 必须持久保存任务、依赖消费与汇合状态，支持恢复时不重复触发。这里是调度实现责任，不需要作者增加配置。

## 参考

- [LangGraph 汇合边](https://reference.langchain.com/python/langgraph/graph/state/StateGraph/add_edge)：等待指定来源全部完成。
- [LangGraph 汇合标记实现](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/channels/named_barrier_value.py)：按来源记录完成信号，消费后重置。
- [JSONata 表达式](https://docs.jsonata.org/expressions)：条件表达式的语法与运算。
- [JSONata 过滤](https://docs.jsonata.org/predicate)：集合成员筛选。
- [JSONata 数组函数](https://docs.jsonata.org/array-functions)：计数等操作。
- [JSONata Node.js 接入](https://docs.jsonata.org/using-nodejs)：复用表达式解析与执行实现。
