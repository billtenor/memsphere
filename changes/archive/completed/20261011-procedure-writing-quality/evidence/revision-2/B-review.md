# release-candidate 独立 review

结论：**需要修改后再验收**。当前 Project Store 的静态校验通过，但字段职责、规则作用域、方案修订契约及验证返回值仍有可行动问题；不能据此认定业务流程可正确执行。本次只审查流程记忆及其引用，没有执行或修订业务流程。

## 审查范围与依据

- 当前隔离 Project：`writing-evaluation`，CLI 返回 Revision `4daa099e026f849c503b7d356e89c7814eb0286a`；未访问其他 Project。
- 主候选：`memories/procedures/release-candidate.yaml`，逻辑引用 `procedures/repair-release-candidate`。
- 完整引用闭包：`memories/procedures/repair-validation.yaml`（`procedures/repair-validation`）和 `memories/statements/repair-evidence-rules.yaml`（`statements/repair-evidence-rules`）。候选中的 inline Schema 也逐个审查。
- 通过 Memsphere 入口发现并读取当前规范：完整读取 `statements/memsphere-procedure-writing-rules`（包括正反例）、`concepts/memsphere-procedure`、`concepts/memsphere-schema`、`schemas/memsphere-procedure-schema` 和 `schemas/memsphere-schema-schema`；读取 YAML 规范中 Procedure、Action、Artifact、If、While、Call 的相关节点及根/祖先上下文。
- 检查了候选文件与 `.memsphere/memory` 对应的三份安装副本，逐字节一致。以下行号均指用户指定的 `memories/` 文件，不使用 CLI 序列化后重新排列的行号。
- 业务判断以 Human 本次提供的单修复工单背景为准；以下修正方向不增加重试次数上限、额外审批者或其他未提供的业务政策。

## 可行动问题

### 1. 高风险缓解要求被扩大到全部步骤

**位置：** `release-candidate.yaml:8`，根 `Procedure.asserts`：“每个步骤都必须提供高风险缓解意见”；对照第 23–35 行高风险 `!if`。

**原因：** 该全局规则还覆盖低风险分支、条件判断、审批及验证子流程，与“仅风险高时由 Human 补充缓解意见”的业务范围不一致。条件 Artifact 是 boolean，也不能承担缓解意见文本。

**修正方向：** 去掉“每个步骤”这一错误全局范围，保留高风险判断和 `then` 中 `actor: human` 的缓解意见步骤。若缓解意见需要补充内容验收规范，只在该 Human Action 声明；必要动作已经由 `action` 表达，无须再重复一遍。准备高风险方案时应明确使用已经取得的缓解意见。

### 2. 最终报告“遗留问题为空”的依据要求误放全局

**位置：** `release-candidate.yaml:7`，根 `Procedure.asserts`；对应第 126 行交付报告 Schema 的“遗留问题”。

**原因：** 此规则只约束最终报告中的一个字段，不约束取证、Human 缓解意见或子流程。放在全局扩大了验收范围，也没有在负责该内容的字段上声明。

**修正方向：** 将“遗留问题”展开为具名 `!schema` 字段，在其 `asserts` 保留“为空时必须说明依据”。不能直接删除这一业务语义，也不能降为建议。

### 3. 风险与证据的关联要求误放全局

**位置：** `release-candidate.yaml:9`，根 `Procedure.asserts`；对应第 50 行方案 Schema 的“风险解释”。

**原因：** “风险解释的每项风险必须关联证据”是字段专属内容规范，不是所有条件、分支和子流程都必须产出的内容。字段存在本身不能表达逐项证据关联。

**修正方向：** 将“风险解释”展开为具名 Schema 字段，把每项风险关联证据的要求放入该字段的 `asserts`；所有承担完整方案的修订产物也应沿用该约束。不要因字段名已存在而删除关联证据的语义。

### 4. 全步骤证据要求超出共享 Statement 的业务作用域

**位置：** `release-candidate.yaml:10`：“所有步骤都必须列出证据引用”；第 40–41、116–117 行的 `!ref`；`repair-evidence-rules.yaml:4–6`。

**原因：** Human 要求方案和最终报告引用证据，Statement 也明确这两个产物的共享用途。全局条目却要求缓解意见、审批 boolean、循环 boolean 等都列引用，扩大了业务要求，并与方案、报告上现有引用产生语义重复。

**修正方向：** 移除全局“所有步骤”要求，保留方案和最终报告各自 Action 的 `!ref`。取证 Artifact 的“证据引用”字段、验证结果自己的“证据”字段继续保留；方案修订相关步骤按问题 9 继承引用规则。Statement 的规则应通过适用位置引用，不应整体提升为 Procedure 全局。

### 5. 取证动作混入机器契约，并重复要求 YAML

**位置：** `release-candidate.yaml:13–22`，取证 Action。

**原因：** 第 13 行动作同时描述格式及字段清单；第 15 行再次要求 YAML。第 18–22 行 Artifact/Schema 已声明 `object`、`yaml` 及三个必填字段，重复声明没有增加业务语义。

**修正方向：** `action` 保留收集、整理当前工单证据的动作和必要输入；格式与字段继续由 Artifact/Schema 声明。删除动作中的格式/字段清单以及第 15 行重复规则，保留工单、影响对象和证据引用三个字段。

### 6. 方案动作混入字段验收要求与排序建议

**位置：** `release-candidate.yaml:37`：“准备修复方案，风险解释必须标明未确认假设，建议按影响程度排序”；第 50 行风险解释字段。

**原因：** 强制标记未确认假设和非强制排序建议都不是当前步骤动作。其中强制程度不同，且都专属于风险解释字段。

**修正方向：** `action` 仅描述基于工单证据及适用的 Human 缓解意见准备方案。将“未确认假设必须标明”写入风险解释字段的 `Schema.asserts`，将“按影响程度排序”写入该字段的 `Schema.suggests`，与问题 3 的逐项证据关联一起保留。不能通过精简删掉假设标记，或把排序建议改为硬性要求。

### 7. 方案字段清单和 Markdown 建议重复机器契约

**位置：** `release-candidate.yaml:39`：“方案必须包含修复动作、风险解释和验证计划”；第 43 行：“方案建议采用 Markdown 格式”；第 46–50 行 Artifact/Schema。

**原因：** 三个必填字段已经声明，Markdown outline 也是机器契约。再次建议采用 Markdown 不增加独立建议，且容易让人误以为格式可以选择。

**修正方向：** 删除第 39 行字段重复要求和第 43 行格式建议，保留 Artifact 的类型、格式、布局、三个字段以及 `repair-evidence-rules` 引用；独立的风险语义与排序建议按问题 3、6 保留。

### 8. 最终报告混合条目必须拆分，不能整条删除

**位置：** `release-candidate.yaml:115`：“报告必须包含结论，结论必须解释修复对账结果”；第 119、126 行。

**原因：** “包含结论”已经由必填字段表达，但“解释修复对账结果”是机器结构未表达的必要业务语义，且专属于结论字段。

**修正方向：** 删除重复的字段存在要求，将解释修复对账结果的强制语义放入具名“结论”字段的 `Schema.asserts`。现有“结论优先使用简短句子”应保留为该字段的 `Schema.suggests`，不可变成硬性长度限制或以简短为由省略对账解释。最终报告的证据引用规则和 `final: true` 继续保留。

### 9. 修订及改进方案没有沿用完整方案契约，也未明确下一轮采用哪个已批准版本

**位置：** `release-candidate.yaml:65–69`（已修订方案）、94–98（原因与改进方案）、107–111（调整后的改进方案），对照第 36–50 行原方案契约、第 53、80、101 行审批/演练动作。

**原因：** 原方案是带三个必填字段的 Markdown object，并应用证据规则。三种修订/改进产物却只声明 Markdown，默认是 string，没有结构、证据引用或风险字段内容约束。Action 和 Statement 引用的作用域不会自动扩展到这些其他 Action。即使首次方案满足要求，后续被批准并演练的方案也可能失去验证计划、风险证据等内容。多个不同名称的产物并存，“当前方案”“已批准方案”没有明确指向最新被批准的完整版本。

**修正方向：** 让后续将被批准和用于演练的方案继续采用完整方案契约，并在适用的修订/改进 Action 引用证据规则；可复用 Schema，或在这些位置声明等价契约。改进分析可以保留失败原因，但不能以只交付局部修改意见代替下一轮所需的完整方案。审批和演练动作明确使用最近一次形成并经 Human 批准的版本；首轮使用原方案或其最新修订版，失败后使用最新批准的改进版。保持“每次修改后再批准”的顺序，不建议取消审批循环。

### 10. 改进审批循环缺少可供修订使用的 Human 意见

**位置：** `release-candidate.yaml:99–111`，改进方案审批 `!while` 的 condition 和 do；对照第 59–66 行初次审批循环。

**原因：** 第 101 行 Human 条件只产出 boolean，未批准时直接让 Agent“根据 Human 意见调整”，但该循环中没有收集并记录意见的 Action。不能把否决 boolean 当成修改要求，也不能依赖未记录的对话内容。初次审批循环已显式取得意见，改进循环却缺少同类输入。

**修正方向：** 在改进审批循环的 do 中，先由 Human 提供改进方案修改意见并形成产物，再由 Agent 根据该意见调整，随后回到 Human 条件重新批准。意见已明确提供时可用其作为对应产物，不要求同义重复确认；不得让 Agent 代作 Human 决定。

### 11. 子流程返回值中的“是否通过”实际是 string，缺少 boolean 字段契约

**位置：** `repair-validation.yaml:16`，`fields: [偏差项, 证据, 是否通过]`；调用方 `release-candidate.yaml:74、85–92`。

**原因：** 字符串简写字段的默认类型是 string，“是否通过”这个名称不会推导出 boolean。当前 object/YAML 契约因此不能保证子流程返回可供条件判断使用的明确真值；文字“通过”“未通过”需要额外解释，可能造成失败分支和重试判断不一致。静态校验通过不能弥补这一业务返回契约问题。

**修正方向：** 将验证结果中的“是否通过”展开为具名 `!schema`，显式声明 `type: boolean`。它是 object 内的业务字段，不是新增普通 flow boolean Action。保留“全部影响对象完成对账且不存在未解释偏差才能通过”的有效判据，并要求调用后的失败判断与下一轮重试条件读取本次调用所返回的同一个“是否通过”值，不能读取旧轮结果或另行重新猜测。

## 必须保留的有效设计与引用结论

- 第 6 行单工单边界是真实全局规则，持续适用于证据、Human 决策、循环及验证子流程，应保留。
- 先收集证据，再判断风险，高风险进入 Human 缓解意见分支；随后准备方案并由 Human 批准，批准后才演练。这些动作和控制流不能因精简而删除。
- 演练循环首次返回 true，演练后调用既有 `repair-validation`，失败时分析并修改、再次由 Human 批准，最后依据子流程结果判断是否重试。这一控制流骨架合理，不建议删除 `!if`、`!while` 或把可复用子流程内联。
- `!call target: repair-validation` 使用存在的 canonical name，合法可解析；两个 `!ref` 使用存在的 `statements/repair-evidence-rules`，引用完整，Statement 本身没有发现需要修改的问题。
- 验证子流程“所有影响对象对账完成且没有未解释偏差”的通过标准有效；主流程需修正返回字段类型和消费结果的一致性，而非弱化通过标准。
- 方案与最终报告引用证据、风险逐项关联证据、未确认假设标记、结论解释对账、无遗留问题时说明依据均须保留。简短表达属于建议，不能作为删减必要内容的理由。

## 检查结果与交付边界

`memsphere validate --format json` 返回 `valid: true`、`issues: []`、`validationScope: project-store`、`changeSetEffect: none`。这是当前 Store 的只读结构/引用检查结果，不是 ChangeSet 校验，也不是业务运行验证；候选与安装副本一致，因此可用作本次静态检查证据。没有修改任何 Memory，没有创建空 ChangeSet、提交 Git 或发布 Memory。

当前没有独立 Memory review 专用 Procedure；已读取并选用通用任务入口，创建评审记录 Run `run-20261012-050648z-0753e03b`，没有启动 `repair-release-candidate` 或 `repair-validation`。该记录 Run 停在“对齐认知”的概念理解简述待上报位置，未完成。技能 `.agents/skills/memsphere/SKILL.md` 明确要求：“Agent 执行任何 `memsphere run report` 命令时，必须请求宿主在沙盒外执行。”当前环境的审批策略为 `never`，不能申请沙盒外执行，因而没有调用或绕过 `run report`。后续若宿主提供允许的沙盒外执行方式，应查询并继续同一 Run；本次按用户要求交付本文件后停止，不将记录 Run 宣称为完成。

审查覆盖主流程全部节点、inline Schema、验证子流程及证据 Statement，结论为需要修改后再验收，共列出 11 项可行动问题及其修正方向。本文件是完整独立 review 交付物，不包含对候选 Memory 的实际修订。
