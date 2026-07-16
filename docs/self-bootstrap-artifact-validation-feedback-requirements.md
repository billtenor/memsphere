# Self-bootstrap Artifact 验证与纠错反馈 Harness 需求

状态：Proposed

日期：2026-07-16

## 背景

使用 Codex `gpt-5.4` 运行 `self-bootstrap/001-create-bookkeeping-entry` 时，子 Agent 已经完成了大部分关键行为：

- 通过 memsphere CLI 发现并读取了“基于 Memory 完成任务流程”。
- 启动并逐步执行了 Procedure Run。
- 发现并完整读取了“记账”Memory。
- 正确理解了日期、类型、金额、分类、备注和保存路径。
- 创建了 `artifacts/bookkeeping.md`。
- 将 Run 推进到 `done`。

但最终文件实际内容是键值列表：

```markdown
- 日期: 2026-07-15
- 类型: 支出
- 金额: 32.50
- 分类: 餐饮
- 备注: 和同事一起吃午餐，我支付了 32.50 元。
```

“记账”Memory 中的匿名 Schema 明确声明 `format: outline`。按照 Schema Memory 的定义，outline 要求字段名称成为 Markdown 标题，项目符号、键值列表、粗体标签或表格不能替代标题结构。因此该文件不满足 Memory 约束。

更关键的是，子 Agent 在 Procedure 的复核步骤中还得出了错误结论：

```text
Schema format 正确：文件采用 Markdown outline 列表。
```

当前 Run harness 接受了这份复核结果和最终 Artifact 上报，并允许 Run 进入 `done`。只有子 Agent 完全结束后，父 Agent 才根据 `evaluation.md` 独立检查出错误。此时评分可以判定失败，却已经失去把具体错误反馈给同一个子 Agent 并让其修正的机会。

这个问题不能只归因于模型缺少上下文。Schema Memory 已经定义了 outline 的准确语义，但模型仍可能误读、自检失误或偶发地产出错误格式。只补充提示词或继续增加 Memory 文本无法替代独立的 Artifact 验证闭环。

## 核心问题

当前 self-bootstrap 执行链缺少以下能力：

1. harness 不会独立读取和检查子 Agent 创建的最终 Artifact。
2. `memsphere run report` 能控制步骤和记录产物，但不会证明文件内容满足目标 Memory 的 Schema 与断言。
3. Procedure 中的“复核”仍由同一个模型完成，不能作为独立验收证据。
4. 子 Agent runner 采用一次性执行方式；父级发现错误后，没有标准机制向原上下文发送纠错反馈。
5. 现有评分只能在执行结束后给出 `pass` 或 `fail`，不能把一次可修复错误转化为同一轮任务中的修正机会。

## 设计原则

### Memory 是约束边界，不是答案模板

harness 只检查任务和已应用 Memory 明确规定的要求。只要 Artifact 满足这些要求，Agent 可以自由组织措辞、补充合理信息、提出质疑或采用不同但等价的实现。

harness 不得因为以下原因拒绝 Artifact：

- 与参考答案的措辞、标题深度或非语义细节不同。
- 没有复述评分者希望看到、但任务与 Memory 没有要求的提示语。
- Agent 做出了未违反 Memory 的额外解释或提醒。
- Agent 没有按照某种唯一工作方式执行，但最终行为和产物符合约束。

### 只验证可追溯的要求

每条自动检查都必须能够追溯到以下至少一种来源：

- 用户任务中的明确要求。
- 目标 Memory 的文本定义。
- 匿名或外部 Statement 的 asserts。
- 匿名或外部 Schema 的 fields、format 和 asserts。
- Procedure 当前步骤的 Artifact 契约或 Action asserts。
- 测试组的隔离与安全规则。

不得把参考答案偏好、当前日期推断、常识性假设或评分者个人习惯变成隐藏约束。

### 错误应优先被修复，而不是立即计为失败

Artifact 首次验证失败时，只要错误可以通过修改当前工作区产物修复，harness 应把具体错误反馈给同一个子 Agent，并允许有限次数的重新提交。只有超过重试上限、出现不可修复错误或违反隔离规则时，才形成最终失败或无效结论。

## 目标

1. 在 self-bootstrap case 中独立验证最终 Artifact 是否满足任务和 Memory 约束。
2. 将验证错误转换为准确、最小且不泄露参考答案的纠错反馈。
3. 让同一个子 Agent 在保留原工作区和执行上下文的情况下修正 Artifact。
4. 验证通过后才把本次 case 判定为 `pass`；Run 自身显示 `done` 不等同于 eval 已通过。
5. 记录每次提交、验证结果、反馈和修正结果，形成可审计证据。
6. 为 Codex、TraeX 和未来其他 Agent 提供一致的验证语义，Agent runner 只负责各自的会话启动与续接。

## 非目标

- 不要求自动理解任意自然语言断言并证明其真假。
- 不把 `evaluation.md` 或参考答案直接发送给子 Agent。
- 不要求 Artifact 与参考产物逐字一致。
- 不禁止 Agent 在 Memory 约束范围内进行合理推断、补充和质疑。
- 不在第一阶段把所有验证能力直接集成进 `memsphere run report`。
- 不用正则表达式临时拼凑完整 Markdown 语义解析器。

## 建议执行闭环

```text
启动干净子 Agent
        |
执行任务并创建 Artifact
        |
收集最终回复、工作区、Run 和事件日志
        |
独立 Artifact validator
        |
   +----+----+
   |         |
 pass   correctable fail
   |         |
记录通过   生成最小错误反馈
             |
       续接同一子 Agent
             |
       修正并重新验证
             |
       超过上限才判 fail
```

隔离违规、读取参考答案或 Memory 被修改等污染问题不可通过重试消除，应直接判定为 `invalid`。

## 需求一：独立 Artifact Validator

### 通用检查

harness 至少应支持以下确定性检查：

- 目标文件是否存在于规定路径。
- 文件是否可读且不是空文件。
- 文件类型与 Artifact 或 Memory 要求一致。
- Schema fields 是否完整出现。
- Schema format 是否正确实现。
- 可以确定性判断的 Statement 或 Schema asserts 是否成立。
- 不应出现的额外实例文件是否被创建。
- Memory Store 在执行前后的文件清单和内容哈希是否一致。

### Markdown outline 检查

当 Schema `format: outline` 时：

- 使用 Markdown parser 解析文档结构。
- 要求 Schema fields 对应的字段名称实际成为 Markdown heading 节点。
- 根据嵌套 Schema 检查必要的标题层级关系。
- 项目符号、键值列表、粗体标签或表格中的同名文本不能冒充 heading。
- 不限制顶层标题文案和具体标题深度，除非 Memory 明确要求。
- 不限制字段正文使用段落或列表，只要字段本身以标题表达且内容满足约束。

### Markdown table 检查

当 Schema `format: table` 时：

- 使用支持 GFM table 的 Markdown parser。
- 第一层 fields 必须成为表格列。
- 列名、必填列和每个元素独占一行等规则来自 Schema 与 Statement。
- 单元格的等价表达可以不同，不要求与参考答案逐字一致。

### 自定义语义检查

不能由通用结构 validator 判断、但对 case 必不可少的确定性规则，可以由 case 提供专用检查器。例如数值、日期、枚举值或明确的字段映射。

专用检查器必须满足：

- 检查项可追溯到任务或 Memory。
- 不读取或改变子 Agent 工作区之外的非验收数据。
- 输出结构化错误，不直接输出完整参考答案。
- 不检查无关措辞、风格或实现偏好。

## 需求二：标准化验证结果

validator 应输出机器可读结果，建议采用以下结构：

```yaml
status: failed
correctable: true
errors:
  - code: schema.format.outline.expected_heading
    artifact: artifacts/bookkeeping.md
    field: 日期
    message: 字段“日期”当前是列表项，但 format: outline 要求它成为 Markdown 标题。
```

每条错误至少包含：

- 稳定错误码。
- 对应 Artifact 路径。
- 违反的要求或字段。
- 实际问题的简短描述。
- 是否可以通过修改当前 Artifact 修复。

错误结果应保留到本次 run 目录，不能只存在于控制台输出。

## 需求三：向同一子 Agent 反馈并重试

验证失败且可修复时，harness 应向原子 Agent 发送类似以下反馈：

```text
Artifact validation failed. 请根据以下错误修正当前工作区产物，然后重新检查并提交：

- artifacts/bookkeeping.md 中“日期、类型、金额、分类、备注”目前是列表项；目标 Schema 的 format 为 outline，这些字段必须使用 Markdown 标题。

不要修改任何 Memory。
```

反馈规则：

- 只发送 validator 已确认的错误。
- 不发送 `evaluation.md`、参考产物或未违反要求的内容。
- 不替 Agent 直接生成完整正确答案。
- 保留原工作区、原会话上下文和已经读取的 Memory。
- 修正后重新运行同一组 validator。
- 默认允许有限次数重试，建议初始值为 2 次；最终值由实际成本和稳定性测试决定。
- 每次尝试都记录输入反馈、文件差异、验证结果和 token 使用。

Agent adapter 如果不支持续接原会话，应明确报告 harness 能力缺失，不能静默启动一个全新 Agent 并把它当作同一次自我修正。

## 需求四：Run 状态与 Eval 状态分离

`memsphere Run done` 只表示 Procedure 已按照当前上报推进到结束，不证明外部文件已经通过 self-bootstrap eval。

第一阶段允许在 Run `done` 后由 eval harness 检查和要求修正工作区文件，但最终 eval 结论必须等待 Artifact validator 通过。

后续可以评估把可确定验证的 Artifact Schema gate 集成到 `memsphere run report`：上报不合格时直接拒绝当前步骤并返回错误。但这是产品 Run 语义的扩大，不作为第一阶段交付前提。

human 输入尚未提供时，Run 可以保持等待或未完成。此类情况应根据 Procedure 的 actor 和当前步骤判断，不得仅因 Run 不是 `done` 就判失败。

## 需求五：Case 验证契约

每个 case 应同时保留两类验收信息：

- `evaluation.md`：供 human 或父 Agent 理解背景、允许差异、失败条件和参考结果。
- 可执行验证契约：供 harness 做确定性检查并生成结构化错误。

可执行契约可以是声明式配置、复用 validator 的参数或 case 专用检查器。具体承载形式在实现设计阶段确定，但必须避免把 `evaluation.md` 的自然语言临时解析成不稳定规则。

case 建设阶段应审查每条检查是否来自任务或 Memory，防止出现以下过度评分：

- 要求补充请求必须复述 Memory 中的所有约束。
- 因 human 尚未回复而把正常暂停判为失败。
- 把 Memory 没有限制的合理发挥判为失败。
- 用与主要验收目标无关的歧义干扰 case。

## 001 Case 的预期验证

001 至少应执行以下检查：

1. `artifacts/bookkeeping.md` 存在且可读。
2. 日期、类型、金额、分类和备注五个字段都以 Markdown 标题表达。
3. 日期是 `2026-07-15`。
4. 类型表达支出。
5. 金额数值等于 `32.50` 且大于零。
6. 分类表达餐饮。
7. 备注描述午餐支付内容且非空。
8. 没有修改任何 Memory。

首次产出键值列表时，validator 应至少返回 `schema.format.outline.expected_heading`，子 Agent 修正为标题结构后可以通过；不应因为备注措辞与参考答案不同而继续拒绝。

## 证据与报告

每次 case 运行应额外保留：

- validator 版本或哈希。
- 每次验证的结构化结果。
- 向子 Agent 发送的纠错反馈。
- 每次修正前后的 Artifact diff。
- 最终通过所需尝试次数。
- 无法修复时的最终失败原因。
- Run 状态和 Eval 状态。

最终报告应区分：

- 首次通过。
- 经反馈修正后通过。
- 超过重试上限后失败。
- 环境或 adapter 不支持纠错闭环。
- 验收过程受到污染而无效。

## 验收标准

1. 使用 001 当前失败产物进行测试时，validator 能稳定识别五个字段不是 Markdown 标题。
2. validator 返回字段级结构化错误，不泄露完整参考产物。
3. harness 能把错误发送给同一个子 Agent，而不是新建无上下文 Agent。
4. 子 Agent 修正为合法 outline 后，第二次验证通过。
5. 最终报告显示首次失败、反馈内容、修正 diff 和最终通过。
6. 一个满足全部 Memory 约束但措辞不同的 Artifact 可以通过。
7. 002 这类等待 human 补充信息的行为不会因为未复述所有约束或 Run 暂停而失败。
8. 006 这类 Memory 选择 case 不会检查 Memory 未声明的额外限制。
9. Memory 被修改或子 Agent 读取参考答案时仍直接判定为 `invalid`，不能通过重试洗掉污染。
10. Codex runner 至少完成一次真实的“首次失败、反馈、修正、通过”端到端验收。

## 实现依赖与待决问题

- Codex 和 TraeX 分别如何续接原子 Agent 会话，需要由 Agent adapter 明确实现。
- Markdown parser 与 GFM table 支持应复用现有依赖还是引入新依赖，需要结合 CLI 和 View 的解析能力统一选择。
- 可执行验证契约采用声明式文件还是 case 专用脚本，需要在实现设计中确定。
- 通用 validator 如何获得本次实际选择的目标 Memory，需要避免依赖模型生成的自然语言摘要。
- Artifact 验证应长期停留在 eval harness，还是逐步下沉为通用 `memsphere run report` gate，需要另行评估产品语义和成本。
- 默认重试次数、超时和 token 预算需要通过实际运行数据确定。
