# PRD：graph 产物支持 Memsphere Schema

状态：已确认的本轮需求契约。下文“当前”描述迭代启动前的基线；交付实现及验证结果见同一 Run 的开发与测试摘要。

## 1. 当前问题与目标

**当前 mode=graph 不支持用 Memsphere Schema 记忆约束产出结构，结构模型只支持 JSON Schema。** raw 可以承载整体内容，但不描述内部结构。

**本次目标：graph 的 Artifact 可以使用 Memsphere Schema，提交时按其要求检查字段、章节与表格，并将内容要求用于评审。**

例如：给“分析报告”产物指定一份 Schema，要求包含结论、依据、风险三个章节。执行者看到要求后提交报告；缺少风险章节时收到提示，补齐后继续评审。

## 2. 本次范围

| 能力 | 用户行为与结果 |
| --- | --- |
| 指定 Schema | 引用已有 Schema 记忆，或直接内联定义 |
| 查看要求 | 执行时查看实际要求，产物详情中也可查看当时使用的要求 |
| 渐进式撰写 | 按字段或章节逐步填写，中间结果持续保存到同一份 Artifact 草稿 |
| 提交与校验 | 撰写完成后提交完整产物，按 Schema 检查结构，指出具体问题 |
| 内容评审 | 按 Schema 字段或章节渐进检查内容要求，最后检查整体 |
| 历史追溯 | Run 启动时固定要求，修改原记忆不改变已有 Run |

本次聚焦 graph 产物。Schema 编辑沿用已有记忆编辑入口。通用业务数据存储、字段或章节的反射读取和编辑，不纳入本次交付。

## 3. 给产物指定 Schema

**沿用 model，definedBy 指定标准；definition 与 ref 并列且必须二选一。**

引用已有 Schema：

```yaml
artifact:
  name: 分析报告
  model:
    definedBy: memsphere/schema.json
    ref: schemas/analysis-report
  payload:
    contentType: text/markdown
```

内联定义：

```yaml
artifact:
  name: 分析报告
  model:
    definedBy: memsphere/schema.json
    definition: |
      !schema
      syntax: memsphere-20261027-stable
      type: object
      format:
        layout: outline
      fields:
        - 结论
        - 依据
        - 风险
  payload:
    contentType: text/markdown
```

以上是本次交付支持的写法。

规则：

- ref 使用 Schema Memory 的逻辑引用，不是文件路径。
- definition 直接保存 Schema 定义，不在其中用根 !ref 代替引用。
- definition 与 ref 同时填写或均未填写，明确报错。
- 内联定义显式声明 syntax；引用记忆使用记忆自身的语法版本。
- 引用不存在、指向非 Schema、存在循环引用或定义非法时，在 Run 执行产物任务前报错。
- 内联 Schema 内部的 Schema/规则引用同样需要解析、检查并固定，不能静默忽略。

## 4. 结构与格式

**Schema 描述结构；payload 决定整个产物的序列化格式；字段可以补充局部格式和布局要求。**

| 位置 | 含义 |
| --- | --- |
| type / fields / item / items | 值类型、字段和数组成员要求 |
| payload.contentType | 整体格式，例如 JSON、YAML、Markdown |
| 字段的 format.name | 局部内容格式 |
| 字段的 format.layout | 局部布局，例如 outline、table |
| 根 Schema 的 format.layout | 整体内容的布局，不替代 payload 的格式声明 |

例如：整个报告是 Markdown，“依据”字段要求使用表格：

```yaml
!schema
name: 依据
type: array
format:
  name: markdown
  layout: table
```

未指定局部格式时，按外层表达规则处理；遇到无法表达的结构时明确报错。根布局继续使用 format.layout；根格式不能覆盖 payload.contentType。

本次保留现有 Schema 的字段、类型、可选字段、数组单一/联合成员契约、Markdown 大纲与表格、Repeat 等结构能力及其适用限制。不通过格式配置扩大原有结构能力。

## 5. 渐进式撰写与草稿

**graph 中带 Memsphere Schema 的产物，沿用原有按字段或章节渐进式撰写的体验。草稿就是撰写过程的中间态。**

- 执行者按 Schema 逐项填写，能看到当前位置与撰写进度，中断后可继续。
- 中间结果保存为 draft Artifact；同一轮撰写持续修改同一个 Artifact ID，不因每次保存创建新的 Artifact 或修订版本。
- 各字段、章节的中间结果写入这份草稿，不把每次保存分别作为独立交付产物。
- 渐进式撰写完成后，检查完整内容并提交；提交通过后不再是草稿，进入正常评审或后续流程。提交校验失败时保留草稿供继续修改。
- 提交后如需修改，创建新的修订草稿，不将原提交退回草稿；原提交及其评审记录保留。新一轮撰写仍持续修改该新草稿，完成后提交。
- 按需增加 continue 撰写命令，绑定当前 Run、Step 与撰写位置；具体命令名和参数由技术设计确定。

草稿不是普通已提交产物的另一种编辑模式；它专门承载渐进式撰写的中间结果。保存草稿不代表完成 Step，不触发正常提交后的流程。

### 撰写时需要复用的具体能力

- **当前项要求**：同时展示流程/Action 的适用规则、祖先 Schema 与当前字段要求、引用来源，不能只展示字段名。
- **逐项检查**：当前字段保存时检查该项适用的类型、格式和结构；不合法时停留当前项，保留已成功保存的内容。整个草稿不要求在尚未填完时通过完整产物校验。
- **可选项**：允许明确跳过当前可选字段，记录跳过结果；必填字段不能跳过。
- **Repeat**：遇到 Repeat 先选择符合 min/max 的总次数，再依次填写展开的章节组；允许范围含 0 时支持选择 0。Repeat 控制不能用 skip 替代。
- **撰写粒度**：沿用现有嵌套字段的展开规则。数组元素契约和联合契约必须参与校验，不把每种结构自动扩展为新的逐元素撰写交互。
- **完整检查与提交**：全部填写后仍需检查汇总的完整产物。可以导出本地副本、阅读和修改，再通过正常提交入口提交。填写完最后一项不能自动跳过此环节。
- **草稿汇总与查看**：持续汇总已填项，明确未填项与跳过项；CLI 与 View 均能查看当前项、完成/剩余进度、草稿内容及最近校验问题。
- **重新进入**：重复进入或恢复撰写，继续同一轮草稿，不清空内容、不创建重复草稿。

草稿仅供撰写和查看，不作为下游依赖、collect 成员或最终成果发布。草稿保存与字段推进不启动正式产物评审，也不生成字段级独立交付 Artifact。

graph 原有的 Human Action、评审授权和 Step 回溯继续生效：Human 任务等待 Human 实际完成；其他 Step 的草稿互不干扰；Step 被回溯替代后，旧撰写上下文不能继续写入，旧记录保留，新 Step 使用自己的草稿。

## 6. 查看要求与提交反馈

执行者开始任务时，应能看到已经解析的要求，包括引用带来的要求，无需自行寻找依赖。产物详情保留当时适用的结构和内容要求。

提交完整产物时：

1. 检查内容能否按声明格式解析。
2. 检查是否满足 Schema 结构要求。
3. 通过后进入流程已配置的内容评审或后续环节。

失败时指出原因及位置，例如“缺少风险章节”“依据表格缺少来源列”“第 2 个成员不符合允许的结构”。校验失败不接纳该候选、不推进步骤；执行者可修改后重新提交。

结构检查通过，只代表结构符合要求，不表示自然语言内容要求已经通过评审。未配置评审时，不得宣称内容要求已被验证。

## 7. 渐进式内容评审

**按 Schema 字段或章节逐组检查，记录每组结果，再做整体检查。**

- Schema 中的自然语言内容要求进入产物已配置的评审。
- 每组展示适用要求及对应内容，保留检查结果与意见；保留流程、Action、Artifact 和 Schema 规则的作用域与来源。
- 每组均需有处理结果，不能把尚未检查视为通过；不适用时记录原因。
- 最后检查跨字段、跨章节的一致性，以及整体问题；沿用现有开放审查和最终复核，不能只遍历规则就结束。
- 沿用现有意见增删改、节点结果修正、最终投票和修订轮次机制；意见与投票始终绑定当时的提交版本。
- 能查看哪些组已检查、哪些仍待检查，避免规则较多时遗漏。

本次不因指定 Schema 自动新增评审人员或改变已有评审授权。

## 8. 存储与历史

**Schema 继续作为 Memory 保存，不另建一份独立维护的定义。**

- 引用的 Schema 存在 Memory 中。
- 内联 Schema 随 Procedure 保存。
- Run 启动时固定两种定义及其依赖、格式和规则，历史产物与评审使用固定版本。
- 后续修改 Schema 或其引用内容，不改变已启动 Run。
- 查看历史产物时，可以识别当时引用的 Schema 来源与实际要求。

旧 Run 和历史快照不自动迁移。现有 JSON Schema、raw 以及原有 flow 的使用行为保持兼容。

## 9. 验收标准

| 场景 | 预期结果 |
| --- | --- |
| 引用或内联同等 Schema | 遵循相同的结构规则 |
| definition/ref 同时存在或均缺失 | 明确拒绝并提示修正 |
| 引用缺失、类型错误、循环或非法定义 | 执行产物任务前报错 |
| JSON/YAML 字段和数组结构不符合要求 | 指出对应字段或成员问题 |
| Markdown 缺章节、表格缺列、Repeat 次数不符 | 给出可定位的问题 |
| 未指定局部格式 | 使用外层表达规则；无法表达则报错 |
| 连续保存撰写中间结果 | 更新同一个 draft Artifact，不新增 Artifact 版本，不推进 Step |
| 中断后继续撰写 | 恢复同一草稿及撰写进度 |
| 撰写完成并提交 | 校验通过后结束草稿态，进入正常流程 |
| 提交校验失败 | 保留草稿供修改，失败不推进 |
| 提交后要求修改 | 创建新修订草稿，保留原提交与评审记录 |
| Schema 含多组内容要求 | 逐组记录结果，最后完成整体检查 |
| 没有配置内容评审 | 仅报告已完成的结构检查 |
| Run 启动后修改原记忆 | 既有 Run 与历史产物要求不变 |
| 旧模型和流程 | JSON Schema、raw 和原有 flow 行为不退化 |
| 调用 Schema Runtime 反射能力 | 明确报不支持反射，正常产物校验不受影响 |

### 本轮补充验收

| 场景 | 预期结果 |
| --- | --- |
| 保存不合法的当前字段 | 停留当前项，已保存内容不丢失 |
| 跳过可选字段或必填字段 | 可选项记录跳过，必填项拒绝跳过 |
| 选择 Repeat 次数 | 检查上下限；合法次数展开，非法次数不推进 |
| 完成最后一项 | 进入完整检查与提交环节，不自动完成 Step |
| 导出、修改完整副本后提交 | 校验最终副本，成功后提交同一草稿；失败仍保留草稿 |
| 重复进入或恢复撰写 | 使用同一草稿及进度 |
| 查看进行中任务 | CLI 与 View 展示一致的进度、草稿和问题 |
| 草稿尚未提交 | 不供下游、collect 或最终成果使用 |
| 多个可执行 Step / Step 被回溯替代 | 撰写上下文隔离；旧上下文禁止写入 |
| 正式评审 | 保留开放审查、最终复核、意见操作和投票；中间保存不启动正式评审 |

## 10. CLI 变更审计表（产品视角）

**下表为本次交付的命令变更清单。**`R` 为 Run，`S` 为 graph Step，`F` 为文件，`T` 为当前撰写位置 token；过期 token 明确拒绝，避免旧字段内容写到下一项。

新增专门的“保存当前撰写项”入口：schema report。普通 report 继续表示提交完整产物；不让同一命令随撰写位置静默改变含义。原 flow 的 report 行为保持兼容。

| 用户操作 | 原生命令（省略 memsphere 前缀） | Continue 入口 | 变更类型及产品行为 |
| --- | --- | --- | --- |
| 进入/恢复渐进撰写 | run enter-schema --run R --step S | continue enter-schema | 扩展现有命令支持 graph Step；新增 Continue；使用冻结 Schema，不另传名称替换要求 |
| 查看进度与草稿 | run schema show --run R --step S | continue schema show | 扩展 graph；新增 Continue；展示当前项、进度、草稿 ID/内容和问题 |
| 保存当前项并进入下一项 | run schema report --run R --step S --position T --artifact-file F（或 --artifact 内容） | continue schema report --position T --artifact-file F | 新增；逐项校验并更新同一草稿，不提交完整产物 |
| 跳过当前可选项 | run skip --run R --step S --position T | continue skip --position T | 扩展 graph；新增 Continue；必填项拒绝跳过 |
| 确定重复组次数 | run repeat N --run R --step S --position T | continue repeat N --position T | 扩展 graph；新增 Continue；检查限制并展开 |
| 导出草稿供完整检查 | run artifact export --run R --step S --file F | continue artifact export --file F | 扩展 graph 草稿导出；新增 Continue；不改变状态，默认不覆盖已有文件；--force 显式覆盖；支持 --output json；不直改受管存储 |
| 最终提交完整产物 | run report --run R --step S --artifact-file F | continue report --artifact-file F | 扩展 Schema 校验与草稿提交；保留 graph 原有完整提交语义 |
| 评审要求修改后重写 | run enter-schema --run R --step S；随后正常撰写和 report | continue enter-schema；随后正常撰写和 report | 扩展；创建关联原提交的新修订草稿，同一轮重入不重复创建；沿用 revision-summary 要求 |
| 查看冻结要求 | run artifact contract show --run R --step S | 不新增 | 扩展现有输出，展示解析后的 Schema、规则与来源 |
| 查看草稿/已提交产物 | run artifact show --run R --step S | 不新增 | 扩展输出，区分草稿与提交；原提交仍可按 ID 查阅 |
| 查看/选择 graph 任务 | run status --run R；run step show/enter --run R --step S | 不新增 | 复用并补充撰写状态；选择 Step 后才绑定其撰写上下文 |
| 等待评审、Runner 投票与意见处置 | run review wait/vote/resolve/retry/submit-for-human | continue review 下对应现有入口 | 复用；不因 Schema 改变角色、权限或人工授权要求 |
| Reviewer 逐组检查、修改意见、复核和投票 | run review report/list/show/update/comment add/update/delete/submit | Reviewer 会话已有 continue report/list/show/update/comment/submit | 复用现有评审命令，扩展 Schema 材料；与 Runner 撰写会话严格区分 |
| 回溯已开始的 graph Step | run step rewind --run R --step S（支持 --dry-run） | 不新增 | 复用；补齐草稿隔离和旧上下文失效行为 |

Continue 的写操作固定 Project、Run、Step 及当前撰写位置；不能传参改绑其他目标。无绑定或上下文已失效时明确报错，使用显式原生命令恢复。命令帮助应按当前阶段说明下一步操作。

Schema Memory 的 list/read/edit、Run 启动/结束、正式 Review 的既有门禁不新增命令。View 复用现有撰写进度与草稿预览体验，接入 graph 数据；本次不新增界面编辑器。

### 复用审计结论

本轮核对了 src/run/store.ts 的逐项撰写、skip/repeat、汇总与 finalization，src/commands/run.ts 的导出，src/commands/continue.ts 的路由，src/commands/review-nodes.ts 的节点评审，以及 Schema 撰写模板和 View 测试。

发现并补齐：可选项跳过、Repeat 选择、逐项校验、完整副本检查与导出、撰写要求的作用域与来源、View 进度/草稿预览、正式评审的开放审查与最终复核、graph 回溯及多 Step 上下文隔离。复用产品行为，不复制原 flow 的事件存储方式；中间结果遵循本次已确认的同一 draft Artifact 规则。

## 11. 决策记录

以下已在讨论中确认：

- 同时支持引用与内联，使用 model 下并列二选一的 ref/definition。
- 标准 ID 为 memsphere/schema.json，definition 使用完整 !schema YAML，显式声明 syntax。
- 整体格式归 payload，局部格式与布局沿用 format.name/layout；根布局沿用 format.layout。
- 未指定局部格式时按外层规则处理，无法表达则报错。
- Run 启动时固定要求；记忆、内联定义与 Run 快照分别按第 8 节保存。
- 按字段或章节渐进评审，最后做整体检查。
- 不提供 Schema Runtime 反射能力，调用时明确报错。
- graph 复用渐进式撰写体验，按需增加 continue 入口。
- 草稿专门承载渐进式撰写中间态；同一轮撰写持续修改同一 Artifact，完成后提交；提交后的修改创建新草稿。

## 12. 技术建议与边界

本节仅记录方向，不是实施方案：

- 复用现有 Schema 解析、Artifact validator、引用解析和规则冻结能力。
- 通过新的 Factory/Runtime 接入 graph；把产物校验与 reflect 调用分离。
- 将已有渐进式撰写能力接入 graph 的 Step 与 Artifact 草稿生命周期；不能仅复用完整提交校验。
- graph 语法层与模型检查层都需支持按标准解析定义，不能继续一律当作 JSON。
- 校验输入、内部值表示、接口签名、旧 format.name 写法的兼容处理，由技术设计落实，不再作为产品决策项。

需求对齐时的调研基线为 master `6a654084555b36d6ab86e50565baad5af5e69176`。本轮敏捷流程启动前已同步最新 master `a6f5b4f9f11d55270205a5eecef7992a82273214`，实施方案按该版本重新核对代码。

需求讨论 Run：`run-de5a2472-cfbb-46d1-97ba-cf186a90dc26`，保持开放。开发交付 Run：`run-00b7d966-3e29-4b1d-bb81-3f95ca3d91ca`；正式需求契约、实施方案、测试与验收记录保存在该流程中。
