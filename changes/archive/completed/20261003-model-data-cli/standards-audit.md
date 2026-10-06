# 统一标准审查记录

日期：2026-10-04（Asia/Shanghai）。
Run：`run-20261003-090655z-f1e492f6`。
范围：requirements.md 全部章节、A1–A24、对应模型/数据入口及当前实际模型；第五轮后增加所有 list 的分页核对及 A25。本记录形成于第四轮讨论，已随第五轮需求稿提交初稿，后续补充单独标明；属于需求审查，不是实现验收。

## 用户要求

> 定好了标准，所有人都必须满足，不满足就改，又没有向前兼容的要求

> 把所有的标准，都全部扫一遍，不允许再出现，存量允许 xxx，但增量就不允许 xxx 的情况再出现

结论：要求适用于全部实际模型、Store、数据及受支持入口。未发现需要保留的时间例外；发现的不一致全部纳入修正。第七轮讨论中 Human 另明确本轮不扩展 Runtime，超出当前支持范围直接报错即可；这项规则同样适用于全部新旧内容，不要求改写所有定义使其可用。

## 全篇审查结果

| 标准 | 发现的问题或遗漏 | 工作稿修正 |
| --- | --- | --- |
| 模型 ID | 系统无后缀历史规则、运行时旧 ID 别名，以及已有 Project 修正步骤不明确 | 所有模型和元模型均使用 `.json`；仓库资源和代码同步，已有 Project 复用 initialize 显式修正，补齐冲突与恢复规则；不保留旧 ID 访问别名或通用迁移命令 |
| 跨模型引用 | 保留已导入模型可浏览、只禁新建；初始化不修已有引用 | 所有实际定义一并清理，已有、导入、市场、原型均不得保留跨模型引用；A19/A20/A24 验收 |
| Runtime 支持 | 新建必须可运行，市场和已有高级定义却只需 definition 校验；此前又过度要求将全部定义改到可用 | 保留当前能力范围；可用模型须通过对应 Runtime，不支持的新旧定义均明确拒绝，不强制改写或扩展能力 |
| 登记修改 | 只改名称/标签可跳过定义及 Runtime 检查 | update 检查修改后的完整模型，登记操作不是准入豁免 |
| 可用性与读取 | available 只表示文件可读，已有不合规模型仍作为正常结果返回 | available 表示全部检查通过；定义非法、Runtime 不支持、文件无法读取分别说明，列表标 unavailable、正常读取失败；分项诊断不赋予可用资格 |
| 导入、安装、恢复 | 新入口限制未覆盖现有市场导入和维护 restore；旧恢复甚至要求保留外部引用 | 所有发布和使用入口执行同一标准；移除恢复 06→07 的旧成功条件，不重新发布不合规定义 |
| Store 配置与目录 | 只明确新建/重登记检查，已有绑定可能跳过 | 相同 Factory/kind、字段、模型、目录及协议规则用于全部 Store；未知字段或 Factory 不回退、不忽略 |
| 写入协调 | “相关受支持入口”未明确包含旧 CLI/View/宿主入口 | 所有能写相同记录的受支持入口采用同一协调；有条件和无条件写都参加，不按入口年代区分 |
| 兼容与验收 | 一面写不兼容，一面保留不合规旧样例和历史字节相等承诺 | 撤掉兼容层和存量豁免；ID、跨模型引用、配置和协议问题全部修正；Runtime 不支持以新旧一致拒绝验收，不能等同于 Schema 格式非法 |
| 列表分页（第五轮后的补充） | model list 和 data store list 原设计漏分页，现有 project/memory/archive list 也没有分页 | 全部 list 统一 limit/cursor/items/nextCursor，覆盖 Memory 子节点和 Reviewer 入口；详见 list-pagination-audit.md 及 A25 |

另澄清第四轮产品 Agent 提出的条件写问题：update/delete 传 expected-revision 才检查调用方版本，省略为无条件操作；edit 总是保护本次命令的读改写窗口。A9 分别验证，不再承诺省略版本也能保护调用方更早的读取。该规则对所有记录和入口一致，不改变 Store 的版本能力范围。此处命令名已随第五轮后的工作稿更新为 edit，输入仍为 JSON Patch。

## 实际内容盘点

以下为源码和定义的只读静态核对，没有运行 Runtime 编译测试，也没有修改真实项目内容。

| 范围 | 发现 | 本轮实施必须处理 |
| --- | --- | --- |
| reserved-models 的 5 个系统模型 | 没有跨模型 Schema 引用；模型及元模型身份仍有无后缀形式 | ID、登记和代码绑定统一；按 JSON Schema 或 raw 对应 Runtime 检查 |
| 市场 8 个示例 | 04 包含当前 Runtime 不支持的 format/contentEncoding/contentMediaType；05 包含联合、条件、布尔子模式等不支持写法；06.externalStatus 引用 07 | 04/05 保留定义与约束，验证其明确报不支持，不强制改写；含不支持定义的整包导入在写入前拒绝；06 内联 string 与 pending/paid/cancelled 枚举，同步全部副本、说明及测试 |
| 可运行原型 | prototypes/model-registration/models.json 中 06 的 schema 和 source 都保存同一外部引用 | 同步模型副本及说明，不保留独立旧演示标准 |
| 当前开发 Project | 11 个 run-domain 定义及 5 个系统定义未发现跨模型引用；其中 9 个 run-domain 定义静态发现超出当前 JSON Schema Runtime 的写法 | 9 项纳入统一拒绝验证，不能因已存在而标为可用；不要求扩展 Runtime 或改写这些定义；实际 Run 使用的 raw 模型另按其对应 Runtime 回归 |
| 其他示例和模块模型 | 静态扫描未发现额外跨模型 Schema 引用 | 仍参加最终 ID、定义和对应 Runtime 的全量检查；支持的通过，不支持的明确拒绝，不能用“未发现跨引用”代替完整检查 |

当前 Project 含有 Runtime 未支持写法的 9 个定义：

| 模型 | 静态发现 |
| --- | --- |
| agent-attempt.json | oneOf、format |
| artifact.json | oneOf、没有明确类型的 inline 内容 |
| comment.json | format |
| external.json | anyOf、oneOf、format |
| round.json | oneOf、format |
| run-event.json | oneOf、allOf、条件与 format |
| run.json | 条件/联合、propertyNames、integer/null 联合类型、format |
| step.json | oneOf、无明确类型的 inline 内容、format |
| vote.json | oneOf、allOf、条件/否定及 format |

这些定义位于 `/data00/home/liuyanjun.lyj/.local/share/memsphere/projects/memsphere/models/json-schema/draft-07/memsphere/run-domain/`。assignment.json 和 review.json 静态未发现上述问题，但尚未动态验证。

这些写法包含真实领域约束，不能通过删除条件、丢字段、丢数据或改成 raw 来绕过。按 Human 最新决定，本轮保留原约束，不扩展类型描述、字段访问/修改或编解码能力，以正确识别并明确拒绝不支持的定义验收；不再要求逐项改写到可用。实际 Run 存储原本使用 raw 模型，这些 Schema 文件与实际存储模型不能混为一谈。

## 防止重新引入

- `src/project/example-relocation.ts` 当前 restore 会发布历史定义，且存在必须恢复 06→07 的断言；须改为只发布满足当前标准的内容。
- `src/project/example-relocation-baseline.ts`、`src/project/model-registration.ts` 和相关测试保存了旧说明或基线；不得继续把不合规旧定义作为有效模型必须保留的标准。
- `test/reserved-models.test.ts` 的历史字节相等要求按 ID 与引用统一规则调整；`test/model-market.test.ts` 的“导入成功但 04/05 Runtime 失败”改为导入前明确拒绝且无部分写入，不要求扩展 Runtime 使其通过。
- 重复市场导入遇到字节冲突会拒绝，不会自动清理已导入副本；实施须直接落实 ID 和跨模型引用修正，不能声称重导入即可完成。已有不支持定义采用同样的拒绝规则，不能作为可用模型继续使用。
- 评审和归档记录不用于正常模型运行；负向测试中的非法输入只用于验证拒绝。任何恢复/导入到有效空间的内容都接受同一标准检查。

## 保留的非时间差异

以下是类型、权限或操作范围的差异，对新旧内容一致：DataStore 与 ValueStore 的 revision 能力；Payload 与结构化值；模型/元模型各自对应的 Runtime；系统模型通用只读权限；完整模型准入与只读分项诊断；显式条件写与无条件操作。它们不构成已有内容的豁免。

## 本轮实际完成情况

已修改需求、验收和跟踪文档，删除全部发现的时间例外，并新增 A24 全量验收。三名辅助 Agent 分别核对模型实际定义、命令规则及数据/Store 标准。代码、模型文件、真实 Project 和 Memory 尚未修改，清理实施未完成；第四轮冻结评审产物保持原样。

第七轮讨论后的补充：Human 明确不在本需求扩展 Runtime，当前文档及 A4/A20/A24 已改为支持项通过、不支持项统一拒绝，撤掉强制改写 04/05 和 9 个 run-domain 定义的要求。ID 统一和所有跨模型引用清理不变。本次只调整未提交工作稿，第七轮冻结产物及正式投票未修改，未执行实现测试。

第八轮补充：第七轮 Human 已投通过；Runner 读取产品 Agent 的两项意见后要求修订，保留 Human 原票。requirements.md 第 2 节补齐已有 Project 的 ID 修正行为，A22 增加冲突、失败、中断后恢复和重复执行验收。身份修正不改变 Store/记录 ID、目录或冻结历史，无关普通模型的 Runtime 不支持不阻止修正，也不因修正而变为可用。现有 initialize 只有部分异常回滚基础，新增中断恢复仍需实施；未将需求说明误记为已经实现。


## 2026-10-05 实施盘点

仓库内五个系统定义的登记、模型与元模型 ID 已统一 `.json`。市场 06 和可运行原型的两份对应内容已移除外部引用，保留 pending/paid/cancelled 枚举；市场 04/05 保留约束，整包导入以 MODEL_RUNTIME_UNSUPPORTED 在发布前拒绝，历史恢复不得重新发布旧跨模型定义。系统安装、完整候选校验、普通使用、登记修改与业务 Store 使用均通过相同检查。

当前开发 Project 已实际执行新版 `project models initialize` 两次。首次修改五份系统登记的 modelRef 和登记定义中的一个身份示例，保留 UUID、其余管理字段和实体地址；第二次无模型变更。实际盘点 `actual-project-audit.json` 包含 16 个模型：五个系统和 assignment/review 两个领域定义可用，其余九个以 MODEL_RUNTIME_UNSUPPORTED 明确拒绝。全部模型身份以 `.json` 结尾，诊断为空；定义检查未发现跨模型引用。修改前后核对 10,679 份 Run/Archive 历史文件，摘要全部一致。当前 Run 不用那九份 Schema 作为存储模型，真实 Run 状态及 raw 模型读取已回归成功。

全部 list 已统一分页，不保留 memories/nodes/next_cursor 响应别名；Factory/Store ID 和普通记录 ID 不因模型后缀改名。filesystem JSON ValueStore 的协调文件及删除 revision 历史保留，原始 DataStore 不新增该能力。Skill、Memory 源及开发 Project 副本同步，Memory 的最终 ChangeSet 校验结果交功能摘要记录。最终全量 1,062 项：1,061 通过、0 失败、1 项 Windows 专属跳过；typecheck/build/validate/变更级 validate 与三个发行冒烟通过。正式实现验收仍待投票，证据见 initial-validation-report.md 与 verification-results.json。
