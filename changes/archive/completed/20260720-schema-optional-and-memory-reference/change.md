---
id: 20260720-schema-optional-and-memory-reference
type: feature
created: 2026-07-20
completed_at: 2026-07-20
run_id: run-20260720-070943z-c923118e
---

# Schema 可选字段与 Memory 引用语法

## 需求

### 背景

当前 Schema 的 `fields` 默认全部必填，导致 Memory Schema 无法忠实表达可省略字段，只能把字段结构退化为文字断言。Concept 等 Memory 也无法通过结构化语法引用独立的 Schema 或 Statement，只能复制内嵌实体或在文本中提及名称，既重复又无法可靠解析。

这两个问题共同阻碍了 Memory 的结构化定义：Schema 需要准确表达字段是否可省略，Memory 则需要复用独立定义。本需求将二者作为一个能力闭环建设。

### Schema 可选字段

在 `fields` 中的具名 `!schema` 字段节点上支持 `optional: true`：

```yaml
fields:
  - !schema
    name: extends
    optional: true
    type: array
    element_types:
      - !schema
        type: string
```

- `optional` 未声明或为 `false` 时，字段仍为必填，保持既有 Schema 的语义。
- 字符串简写字段仍为必填；需要声明可选性时必须使用具名 `!schema` 字段节点。
- 可选字段缺失时 Validator 放行；字段存在时仍完整校验其类型、format、嵌套字段和重复结构。
- JSON/YAML object、Markdown outline、Markdown table 均须具有明确且一致的可选字段行为。
- Schema Run 必须能够显式跳过当前可选字段，省略对应产物内容并记录跳过事件；必填字段不得跳过。
- Parser、AST、序列化、导航、CLI、View、Review 和 Run 快照必须保留并展示字段可选性。

### Memory 引用

为 `defines` 增加结构化外部 Memory 引用，首期建议采用以下语法：

```yaml
defines:
  - !ref
    target: schemas/memsphere-concept-schema
```

- `target` 使用 Memory Catalog 可解析的稳定逻辑引用，也可接受能够唯一解析的 Memory 名称。
- 首期仅允许在 `defines` 中引用 Statement 或 Schema；引用内容与内嵌的 `!statement`、`!schema` 一样共同定义当前 Memory。
- `memsphere validate` 必须拒绝不存在、解析歧义、目标类型不允许以及循环依赖的引用，并返回引用所在路径和明确原因。
- `memsphere memory read` 和 View 必须明确展示引用及其目标，但默认不得递归内联全部目标内容；Agent 可按引用继续读取目标 Memory。
- Parser、AST、序列化、导航、Review 和相关快照必须保留引用身份，不得把引用误显示为普通名称或静态文本。
- 现有内嵌 `defines` 继续有效；`Artifact.schema`、`!call.target`、Concept `extends` 等专用引用不在本需求中统一或替换。

### 应用范围

- 使用 `optional` 重写 Concept、Statement、Schema、Procedure 四种 Memory Schema，字段结构由 Schema 自身表达，不再主要依赖文字断言模拟可选性。
- Concept 通过外部引用关联对应的独立 Schema，避免重复内嵌 Schema。
- 同步更新 YAML 语法记忆、Skill 中必要的冗余说明、系统记忆清单和自举评测，使 Agent 能发现并应用两项语法。

### 关联需求

- `20260712-memsphere-type-system`：当前 `fields` 全部必填，是可选字段能力的直接来源。
- `20260715-memory-cli-access`：Memory Catalog 和逻辑引用可作为引用解析基础。
- `20260716-artifact-contract-v2`、`20260717-schema-repeat`、`20260716-report-artifact-validation-feedback`：涉及递归 Artifact 校验、Schema Run 和 report 校验反馈。
- `20260716-reserved-memory-self-bootstrap`：需要可导航的 Memory 依赖关系和 Concept 到对应 Schema 的明确引用。

### 不做事项

- 不在本需求中实现 `oneOf`、`enum`、`additionalProperties` 等完整 JSON Schema 能力。
- 不支持远程引用、跨 Memory Store 引用或任意节点级引用。
- 不替换已有专用引用语法。
- 不默认递归展开引用内容，避免输出和上下文无界膨胀。

## 验收标准

1. 既有 Schema 未声明 `optional` 时解析、序列化、校验和 Run 行为不变，原有必填字段仍然必填。
2. JSON/YAML、Markdown outline 和 Markdown table 产物缺失可选字段时通过校验；可选字段存在但类型、层级或子结构错误时失败，并返回稳定字段路径。
3. Schema Run 能显式跳过可选字段并正确组装 Artifact；跳过必填字段失败；事件、快照和 CLI/View 能识别该跳过决定。
4. `optional` 经解析和序列化往返后不丢失，并能在 `memory read`、导航、View 和 Review 中被正确展示。
5. `defines` 中的合法引用能够通过 Catalog 解析到 Statement 或 Schema，并能被 Agent 继续读取和应用。
6. 不存在、歧义、类型不允许及循环引用均不能通过 `memsphere validate`，错误包含引用位置、目标和原因。
7. `memory read` 与 View 展示引用目标但不默认递归内联；既有内嵌 `defines` 和专用引用行为不变。
8. 四种 Memory Schema 使用 `optional` 表达真实可选字段，Concept 使用外部引用关联独立 Schema，全部通过 Memory 校验。
9. 单元测试、类型检查和现有回归测试通过；新增覆盖 optional、引用解析、错误诊断、Schema Run 跳过及自举应用的测试。

## 技术与测试方案

- 在既有 Schema AST、Parser、Serializer、Validator、Run、导航和 View 链路中增加 `optional`，不建立平行结构。
- 在 Memory AST 中增加 `!ref`，由 Memory Catalog 和引用校验器统一解析并检查目标类型、缺失、歧义与循环依赖。
- 使用单元测试覆盖可选字段校验与跳过、引用解析与错误诊断、CLI 读取、导航、View 和 Run 行为，并执行完整回归测试。

## 开发任务

- [x] 实现 Schema 可选字段的解析、序列化、校验、Run 跳过、导航和 View 展示。
- [x] 实现 `defines` 中的 Memory 引用及其解析、校验、读取和展示。
- [x] 重建四种 Memory Schema，并让 Concept 通过外部引用关联对应 Schema。
- [x] 更新 YAML 语法记忆、Skill、系统记忆安装清单和自动化测试。

## 验收结果

- Schema `optional` 已覆盖 JSON/YAML object、Markdown outline、Markdown table、Run 跳过、序列化、导航和 View；未声明时仍保持必填语义。
- `defines` 中的 `!ref` 已接入 Catalog 解析与 Memory 校验，不存在、类型不允许和循环引用等错误均有自动化覆盖；读取和 View 不会默认递归展开目标。
- 四种 Memory Schema 已使用 `optional` 表达可选字段，Concept 已通过 `!ref` 关联独立 Schema，并通过系统记忆安装与校验。
- 主要实现提交为 `7ac4db3`，系统记忆重建提交为 `10cf972`。
- 2026-07-20 验收通过：`npm test` 225 passed、0 failed；`npm run typecheck` 与 `memsphere validate` 均通过。
