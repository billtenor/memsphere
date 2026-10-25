# 上下文控制：自由探索、轻量 Review 与首版界面设计

状态：本轮自由探索、轻量 Review、标签、依赖选择及真实 Store 界面已实现并通过验收。本文记录本版用户动线和 CLI；当前工作区使用 `node dist/cli.js`，安装本版后使用 `memsphere`。前端原型作为设计参考保留，见 [原型与需求对照](context-control-prototype.md)。

本文的操作主体是 Agent。Human 可以在交互中提出意见，由 Agent 代为记录。模型包为 `memsphere.context_control`，显示名称为「上下文控制」，模型 ID 前缀为 `memsphere/context_control/`。

## 1. 范围与基本规则

| 项目 | 本版约定 |
| --- | --- |
| 自由探索 | Agent 自行决定下一步工作；不要求提前定义 Procedure 或 Action 图 |
| Run | 包含整次探索及产物依赖图；自由探索不填写根流程 memoryRef |
| 新模型持久化 | 自由探索的 Run、Step、Artifact、External、Review 全部通过已定义模型对应的 Store 读写；首版使用 JSON 文件后端 |
| Step | create 声明产物目标时系统创建对应 Step；Agent 传产物 ID，不操作 Step。无前置读取的直接 report 仍可自动创建两者 |
| 普通产出 | 上报完整产物，成功后直接是 submitted；不要求配置产物业务 Model 或质量校验规则 |
| 修改 | 已提交内容不覆盖，重新上报生成新 Artifact；revisedFrom 指向旧产物 |
| 草稿 | artifact create 产生无正文的 draft 目标，report --target 一次提交完整成果并转为 submitted；不提供普通 report --draft 或局部正文上报。Schema 渐进撰写仍是独立动线 |
| 轻量 Review | 针对产物记录问题和修改要求；无需配置 Reviewer、开启正式轮次、投票或等待结算 |
| 读取记录 | 读取命令携带 --for 目标产物 ID 时，记录归目标的生产 Step；纯浏览不记账。辅助记账失败不影响正文读取，不自动认定依赖 |
| 标签 | 每份 Artifact 自动包含 default；标签只在所属 Run 内生效 |
| 依赖 | 最终保存具体 Artifact / External ID；按标签选择只是本次上报的快捷方式 |
| 交付 | 明确选择最终 Artifact，由其依赖闭包确定交付视图；其他分支留作历史 |
| 首版前端 | 本轮必须提供依赖图及点击节点后的浮窗：桌面左内容、右 Review，窄屏在同一浮窗切换查看；生产仍以 CLI 为入口 |

不配置业务校验，不代表接受非法引用：产物身份、内容入口、所属 Run、已提交状态和依赖图完整性仍需满足基本存储约束。本文不新增 Memory YAML syntax 关键字；图编排是另一份设计，见 [流程记忆依赖图语法设计](procedure-graph-syntax.md)。

### 1.1 新旧模块与存储边界

自由探索使用已经明确字段和含义的上下文控制模型。旧流程执行仍采用原有模块及非模型的本地文件持久化；命令形式接近，不表示底层继续共用旧的运行状态文件。

| 层面 | 本版要求 |
| --- | --- |
| 新领域模块 | 后端独立承载上下文控制领域及应用服务，直接使用新模型字段和生命周期；前端仍属于既有 Run 模块 |
| 模型 Store | Run、Step、Artifact、External、Review 各按对应模型读写，不把旧 RunState 换个文件名继续保存 |
| JSON 文件后端 | JSON 文件只是 Store 实现，优先复用现有 JSON ValueStore Factory；不由领域服务拼路径、扫描目录或直接读写状态文件 |
| 远端替换 | 领域逻辑只依赖模型和 Store 接口；后续可替换为远端实现，不改变产物依赖或 Run/Step 语义 |
| CLI | 自由探索进入新模块，既有流程进入旧模块；读取和查询明确识别两类运行，不要求两者数据同构 |
| 状态字段 | 直接使用既定 memoryRef、frames、各 Config、Step.artifact 等字段；不重新引入旧状态命名和包装 |
| 渐进迁移 | 为旧执行器未来调用新服务保留适配边界；本轮不实现历史运行自动迁移、双写或旧流程整体切换 |

“无需配置产物 Model”指普通内容不要求业务质量契约，五个领域实体本身仍须遵守对应模型及其 Store 契约。轻量 Review 和读取记录需要的最小模型适配应在实施方案逐项明确，不借此重新扩张全部领域模型。

## 2. 用户动线与对应操作

表中省略 `memsphere run` 前缀。除 start 外携带 `--run R`；字母是命令返回的真实 ID 的代号。

| 场景 | Agent 操作 / 命令 | 达成目的 |
| --- | --- | --- |
| 开始探索 | `start --name "任务名称"` | 创建 Run |
| 查看现状或浏览历史 | `show`、`artifact show --artifact A`、`external show --external E` | 了解已有内容；不创建、切换生产任务，不记到其他 Step |
| 决定生产方案 B，需要先读材料 | `artifact create --name "方案" --tag design` | 得到草稿目标 B；系统同时创建生产 Step，尚无正文 |
| 为 B 阅读产物 | `artifact show --artifact A --for B` | 返回 A 正文，尽力记到 B 的生产 Step，提示候选依据 |
| 为 B 导出工作文件 | `artifact show --artifact A --for B --out a.md` | 排他写入纯正文，记账失败不影响文件 |
| 录入和阅读外部输入 | `external add --source "用户说明" --content "必须离线可用"`，再 `external show --external E --for B` | 固定来源和内容，并将本次阅读归到 B 的 Step |
| 编写和测试 | 使用自己的编辑、测试工具 | 同一目标持续工作，不逐次上报尝试，不额外传 Step ID |
| B 已完整 | `report --target B --artifact-file plan.md --depends-on artifact:A --depends-on external:E` | 同一 B 从 draft 变 submitted，Step 完成；读取记录仅作提示 |
| 简单成果已完成，不需要预先收集阅读 | `report --name "结论" --artifact "完整结论"` | 保留直接提交便利入口，系统自动创建 Step 和 submitted Artifact |
| 检查刚提交的 B | `artifact show --artifact B` | 单纯查看，不隐式开始下一个 Step |
| 已提交成果有问题 | `review create --artifact B --reviewer human --comment "修改要求一" --comment "修改要求二"` | 轻量记录问题；Agent 自己发现的问题使用 reviewer agent |
| 开始修改 B 或回到历史 B 重做 | `artifact create --revised-from B` | 得到新的草稿 B_NEW 和新的 Step，保留 B |
| 阅读后修订 | `artifact show --artifact B --for B_NEW`；`review list --artifact B`；修改后 `report --target B_NEW --artifact-file new.md` | B_NEW 提交时默认继承 B 的具体依赖，不改旧内容 |
| 判断回退影响 | `artifact impact --artifact A` | 查询依赖旧 A 的下游，不执行自动重放 |
| 基于 A_NEW 重做旧 B | create 修订 B 得到 B_NEW，读取旧 B、新 A_NEW 时都加 `--for B_NEW`，再 report 指定新依赖 | 可以复用旧成果，建立新分支；没有独立 rewind 命令 |
| 分类及批量选择依赖 | `artifact tag --artifact A --tag research`；report 使用 `--depends-on tag:research` | 本次解析成已提交产物的具体 ID，后续标签变化不追随 |
| 中断后继续 | `status` / `show` 找回草稿目标 ID，继续读取或 `report --target B` | 复用已创建的目标与 Step，不重复 create |
| Human 查看进度 | 在现有 Run 详情查看图并点击产物 | 草稿显示未提交，已提交产物可看正文和评论 |
| 交付或取消 | `finish --artifact C`，或用户决定取消后 `abandon --reason "原因"` | 固定交付闭包或保留废弃历史；草稿不能作为交付根 |

## 3. 命令清单

同一条命令可以用于多个场景；修改、回退和重走都复用读取与 report。

| 命令 | 输入 / 选择方式 | 返回或作用 |
| --- | --- | --- |
| `start` | `--name`；自由探索不指定流程记忆 | Run ID |
| `status` | `--run` | 运行状态及继续工作所需线索 |
| `show` | 可选 `--root <artifactId>` | 概览、已提交依赖图和草稿目标；root 只接受已完整提交产物 |
| `artifact create` | 新目标用 --name；修订用 --revised-from；可带 --name、重复 --tag | draft 目标 ID，系统关联 Step；不接收正文或依赖 |
| `report` | 可选 --target；正文或结构化文件、依赖、标签；直接修订可用 --revised-from | 提交目标 ID、状态和标签；有 target 时保持原 ID |
| `artifact show` | --artifact 源 ID，可选 --out、--for 目标 ID | 返回源正文；--for 决定记录归属，不改变被读对象 |
| `artifact impact` | `--artifact` | 直接、间接依赖该产物的下游列表 |
| `artifact tag` | `--artifact`、可重复的 `--tag` | 为已有产物添加标签；不改变 ID |
| `external add` | 来源加直接文本，或结构化文件 | External ID |
| `external show` | --external 源 ID，可选 --out、--for 目标 ID | 返回外部资料正文；可排他导出文件，指定目标时尽力记录到其 Step |
| `review create` | 产物 ID、意见来源、评论 | Review ID 和每条评论的 ID |
| `review list` | `--artifact` | 该产物的轻量 Review 列表 |
| `review show` | `--review` | 一份 Review 的具体意见 |
| `finish` | 一个或多个 `--artifact` | 固定最终交付选择，结束 Run |
| `abandon` | 可选 `--reason`，由用户决定取消 | 废弃 Run |

需要结构化返回时使用 `--output json`。读取原文到文件的 `--out` 与命令回执分开：文件保存正文，不混入 JSON 回执或读取提示。首版默认拒绝覆盖已有文件，保留原文件，不新增强制覆盖开关。

## 4. 输入与引用语义

### 4.1 声明目标与提交

`artifact create` 不接收内容。新目标必须有 --name；--revised-from 必须指向同 Run 已提交的产物，名称省略时继承。系统返回稳定目标 ID，保存 status=draft、default 加显式 tags、空 dependencies 和系统创建的 stepId。修订关系在 create 时确定；提交前不把继承的依赖冒充已固定的成果关系。一个目标对应一个生产 Step，整个 Run 可以同时有多个目标。

`report --target B` 只能提交同 Run 的 draft B；填入完整内容并把同一 ID 转为 submitted。名称、revisedFrom 来自 create，target 模式拒绝另传这两个字段，包括结构化输入中的同名字段；tags 与 create 时的集合取并集。依赖在提交时确定，省略时按下表规则求值。submitted 目标拒绝再次 report；修改须创建新目标，不转回 draft。

不指定 --target 的 report 保留原有快捷语义：完整输入校验后，自动建立 Step 和 Artifact 并提交。`--artifact` 已表示正文，因此不复用为目标 ID。

以下是 report 的输入：

| 参数 | 含义 |
| --- | --- |
| `--target B` | 提交已声明的草稿目标 B；与 --name、--revised-from 互斥 |
| `--name` | 直接 report 的新产物名称；直接修订时省略可沿用原名称 |
| `--artifact "正文"` | 直接上报文本，包括修改后的文本 |
| `--artifact-file path` | 从文件读取正文，包括修改后的文件 |
| `--content-type` | 指定正文 MIME 类型，例如 text/markdown；快捷入口不要求 Agent 手写产物 Model |
| `--file artifact.json` | 受限提交输入，允许 name、content 或 contentRef、dependencies、tags、revisedFrom、revisedSummary；拒绝 id、stepId、status 及未知字段 |
| `--revised-from A` | 表示修订已提交产物 A；生成新 ID，保留原产物 |
| `--depends-on artifact:A` | 依赖具体产物，可重复 |
| `--depends-on external:E` | 依赖固定的外部资料，可重复 |
| `--depends-on tag:research` | 展开当前 Run 中 research 标签下已提交的产物，可与其他依赖参数组合 |
| `--tag research` | 给本次产物添加自定义标签，可重复；系统自动补上 default |

正文直接输入、正文文件和完整结构化文件是不同输入入口，应选用一种；同时提供多个入口时拒绝。结构化文件的 dependencies 与命令行依赖选择也不能混用。结构化入口继续复用 `content.model + content.payload` 或 `contentRef`，不再另建 type / format / layout 契约。文本快捷入口由系统完成必要的装箱，不要求 Agent 预先配置业务 Model。

结构化输入不是完整 Artifact 领域记录。id、stepId 和 status 由系统生成，调用方传入这些字段（包括 status=draft）或未知字段均拒绝。content/contentRef 二选一；同一字段同时由结构化文件和命令行参数提供时拒绝。输入验证失败不创建新的目标、不提交已有草稿、不完成 Step，已有目标和读取记录保留。

create 和直接 report 都由系统生成 ID；带 --target 的 report 使用 create 已返回的 ID。A、A_NEW 等只是文档代号。提交完成后 Step 完成；再次修订创建新 Step，不修改旧 Step 的完成结果。

两次直接 report 即使内容相同也是两个成果，不自动按内容去重；同一 --target 只产生一份提交结果。普通重复 report 按已有规则拒绝，内部 redo 则复用已保存 Artifact ID 和 Step ID 补齐操作，不创建新的成果。命令超时、结果不明确时，应先查询 status/show，不能自动重发并假定一定返回原成果。失败写入不能被报告为完整提交，完成可见性和恢复机制由新模块方案保证。

返回示意如下，具体 ID 不应由 Agent 猜测：

```json
{
  "runId": "run-001",
  "stepId": "step-001",
  "artifactId": "artifact-001",
  "artifactStatus": "submitted",
  "stepStatus": "done",
  "tags": ["default", "research"]
}
```

### 4.2 依赖继承与替换

| 上报方式 | 最终依赖 |
| --- | --- |
| 新产物，未声明依赖 | 空数组 |
| 修订产物，未声明依赖 | 继承 revisedFrom 产物已经固定的具体依赖 ID；target 模式从目标保存的 revisedFrom 确定来源 |
| 显式传入一个或多个依赖参数 | 解析后作为完整依赖集合，替换继承值，不隐式追加 |
| 多个 ID、标签选择结果重叠 | 按材料类型与 ID 去重 |
| 结构化文件明确填写 `dependencies: []` | 清空依赖，与省略字段并继承相区别 |

显式替换时，Agent 要包含仍然需要的其他依赖。例如原依赖是 A 和 E，修改后要依赖 A_NEW 和 E，就需要同时传入 `artifact:A_NEW`、`external:E`。

`revisedFrom` 表示修订来源，不自动变成 dependencies。旧成果可读取和复用；若旧产物本身也成为新结果的实质性依据，再显式声明依赖。

Artifact 只能依赖同一 Run 的已提交 Artifact 或已固定的 External。不能自依赖，依赖图不能形成环。这里是引用完整性要求，不是对产物质量进行正式校验。

### 4.3 标签与按标签选择依赖

| 规则 | 含义 |
| --- | --- |
| 存储 | Artifact 增加 `tags: string[]`，同一标签不重复 |
| 默认标签 | 每份 Artifact 自动包含 default；自定义标签与 default 并存 |
| 作用范围 | 由 Artifact.stepId 找到 Run；同名标签在不同 Run 中互不影响 |
| 打标签 | 上报时使用 `--tag`；已有产物使用 `artifact tag` 添加标签 |
| 已提交产物 | 标签是可更新的分类信息；调整标签不改变已固定的内容、依赖和修订来源 |
| 解析时机 | 本次 report 成功保存前，解析当时已有的匹配产物；不包含本次即将创建的产物自身 |
| 可依赖的状态 | 只展开 submitted 产物；无正文目标草稿及 Schema 中间草稿都不能作为普通依赖加入 |
| 保存结果 | dependencies 只保存 `{kind: "artifact", id: "..."}`，不保存 tag 引用 |
| 后续变化 | 后来新建或打上相同标签的产物，不会自动加入已有产物的依赖 |
| 历史修订 | 一个标签下同时有旧产物和修订产物时，两者都匹配；不隐含「仅最新版本」过滤 |
| default | `tag:default` 选择当前 Run 当时已有的全部已提交 Artifact，包括历史分支；不是自动选择最终有效图 |

例：report 时 research 标签下有 A、B，则保存依赖 `[A, B]`。后来 C 加入 research，原依赖仍然是 `[A, B]`。若需要包含 C，必须显式生产并上报新的产物。

修订时省略依赖参数，继承的是旧产物的具体依赖 ID，不会重新计算旧产物当时曾使用过的标签。自定义标签不自动继承，系统自动添加 default，其他标签由本次参数明确指定；已有产物追加标签采用集合并集。标签移除不在本版范围内。

标签没有匹配到已提交产物时，report 明确失败，不创建可见的已提交产物、不完成 Step，也不修改其他已有记录。只允许为运行中的 Run 添加标签；done/abandoned 的 Run 整体只读。

### 4.4 外部资料与轻量 Review

| 操作 | 直接输入 | 文件输入 |
| --- | --- | --- |
| 外部资料 | `external add --source "来源说明" --content "资料正文"` | `external add --file external.json`，使用现有 External 的来源与内容结构 |
| 轻量意见 | `review create --artifact A --reviewer agent --comment "问题描述"` | 将评论替换为 `--comment-file issue.md` |
| Human 意见 | 使用 `--reviewer human` | 同样支持评论文件 |

`--reviewer` 表达 Runner 声明的意见来源类别是 Agent 还是 Human，不是经过认证的具体个人身份。Agent 可代录 Human 在实际交互中提出的意见，不要求配置正式 Reviewer；展示时明确这是来源声明，不将其表示为 Human 亲自签署或正式授权，也不授予正式评审或代理投票权限。

`--comment` 可连续传多次：同一条命令创建一份 Review，每个参数保存为独立评论，按参数顺序排列，各自生成 comment ID。文件入口的正文作为一条评论，不自动按段落拆分。首版直接评论与评论文件二选一，同时提供则明确拒绝。

轻量 Review 关联被评论的已提交 Artifact，记录问题与修改要求。它不创建正式评审轮次、不发起投票、不阻塞产出或自动改变 Step 的状态。这里不额外要求 Runner 填写 resolutions 或提交处理总结。

## 5. 读取记录与依赖提示

| 情况 | 记录与返回行为 |
| --- | --- |
| artifact / external show 不带 --for | 纯浏览；不自动创建或选择 Step，不写 Run 读取记录 |
| show 携带 --for B，B 是同 Run 正在生产的草稿 | 先返回源正文，再尽力记录到 B 对应 Step.reads |
| --for 不存在、跨 Run、已提交或 Step/Run 已结束 | 不记账，告警说明目标不可记账；正文读取成功仍返回成功，不创建替代 Step |
| 正文解析、contentRef 校验或文件输出失败 | 读取正常报错，不把正文错误当记账失败忽略 |
| 记账存储冲突、失败或超时 | 正文/文件保留、命令成功；告警到 stderr 或 JSON warnings，不混入正文 |
| report --target B | 从 B 的 Step 读取候选摘要，只提示本次未覆盖的材料，不阻断 report |

`Step.reads` 为 map，键使用 `artifact:<id>` 或 `external:<id>`，值为 `{readAt}`。它属于生产目标的 Step，与材料自己的来源 Step 无关；Run 不汇总保存。按来源类型和 ID 去重，重复读取更新最近时间；目标提交后不再改写。记账有有限等待和取消，冲突至多重新读取合并一次，仍失败则告警后放弃。

读过不等于依赖。候选不自动加入 dependencies，不要求 --confirm-dependencies，不因 report 清空其他 Step 的记录，也不按“上一次 report 之后”推测生产边界。通过编辑器、浏览器等渠道阅读的资料仍由 Agent 自行声明。

持久化层保证 CAS：读取返回 revision，更新传 expectedRevision；版本检查和写入原子完成，冲突不覆盖。它不是要求 Agent 管理的参数。CAS 只保证单记录，跨记录用业务层的 Run 短锁编排；异常采用同一 ID 的幂等 redo，不要求多模型事务。

## 6. 使用示例

以下代码展示目标接口。文件内容由 Agent 使用自己的工具准备；`R`、`A`、`B`、`A_NEW` 等须替换为上一步真实返回的 ID，不能原样当作已有数据执行。

### 6.1 从零开始：直接产出与文件产出

```bash
memsphere run start --name "研究缓存方案" --output json

# 将返回的 Run ID 记为 R；本次返回的 Artifact ID 记为 A。
memsphere run report --run R \
  --name "部署要求" \
  --artifact "服务需要支持多实例部署。" \
  --tag requirements --output json

# 先声明方案目标，返回 B；系统建立 Step，尚无正文。
memsphere run artifact create --run R --name "缓存方案" --tag design --output json
memsphere run artifact show --run R --artifact A --for B --out requirements.md

# Agent 编写 design.md 后提交，B 的 ID 不变。
memsphere run report --run R --target B \
  --artifact-file design.md --content-type text/markdown \
  --depends-on artifact:A --output json
```

Agent 只声明产物，不创建 Step。B 声明时为无正文 draft，report 提交完整内容；读取刚提交的 B 不会自动开启下一项生产。

### 6.2 引用一句外部输入

```bash
# 返回 External ID E。
memsphere run external add --run R \
  --source "本次讨论中用户补充的约束" \
  --content "服务需要在断网时继续提供查询。" --output json

memsphere run artifact create --run R --name "离线查询分析" --output json
# 将目标 ID 记为 ANALYSIS。
memsphere run external show --run R --external E --for ANALYSIS
memsphere run artifact show --run R --artifact A --for ANALYSIS
memsphere run report --run R --target ANALYSIS \
  --artifact "缓存需要保留可离线读取的快照。" \
  --depends-on artifact:A --depends-on external:E
```

短资料直接传字符串；需要完整内容结构或内容引用时，再使用文件入口。

### 6.3 Human 提出多条要求，Agent 修改当前产物

```bash
memsphere run review create --run R --artifact B \
  --reviewer human \
  --comment "说明多实例之间如何保持缓存一致。" \
  --comment "补充缓存服务故障后的恢复路径。" --output json

memsphere run artifact create --run R --revised-from B --tag design --output json
# 返回新草稿 B_NEW。
memsphere run artifact show --run R --artifact B --for B_NEW --out design-old.md
memsphere run review list --run R --artifact B

# Agent 编辑 design-revised.md 后提交同一个 B_NEW。
# 未传依赖参数，继承 B 的具体依赖；标签在本次显式指定。
memsphere run report --run R --target B_NEW \
  --artifact-file design-revised.md --content-type text/markdown \
  --tag design --output json
```

两条评论属于同一份 Review，各自有 ID。Human 不需要先登记为正式 Reviewer。原 B 和 Review 继续保留，B_NEW.revisedFrom 指向 B。

### 6.4 测试失败：区分生产过程与已提交成果

| 情况 | 操作 |
| --- | --- |
| 代码尚未上报，测试失败 | 继续编辑和运行测试；无需为每次失败创建 Review |
| 代码成果已经提交为 A，后来发现失败 | 对 A 留下轻量 Review，然后修订上报 |
| 同一个问题反复修改、测试 | 围绕原意见处理，不因每次测试失败新增 Review |

```bash
memsphere run review create --run R --artifact A \
  --reviewer agent \
  --comment "并发测试失败：两个请求同时更新时出现数据覆盖，需要修复。"

# Agent 在本地修复并验证后提交新的完整成果。
memsphere run report --run R \
  --revised-from A \
  --artifact "已加入并发写入保护，并完成并发场景验证。"
```

真实代码成果可使用结构化文件中的 contentRef 表达固定内容引用。上例用文本演示交互，不另建 codeRef；代码引用的存储协议不在本文新增设计。

### 6.5 回到上游修改，再重走下游

假设已有 `A → B → C`，A 是需求，B 是方案，C 是实现说明。

```bash
memsphere run review create --run R --artifact A \
  --reviewer human --comment "部署环境改为多机，需要重新考虑本地状态。"

memsphere run artifact create --run R --revised-from A --output json
# 返回 A_NEW，以下读取归其 Step。
memsphere run artifact show --run R --artifact A --for A_NEW --out requirements-old.md
memsphere run review list --run R --artifact A

# Agent 修改后提交 A_NEW。
memsphere run report --run R --target A_NEW \
  --artifact-file requirements-new.md --content-type text/markdown

# 查看谁依赖旧 A，判断哪些产物需要重做。
memsphere run artifact impact --run R --artifact A

memsphere run artifact create --run R --revised-from B --output json
# 返回 B_NEW，可读旧 B 和新 A_NEW。
memsphere run artifact show --run R --artifact B --for B_NEW --out design-old.md
memsphere run artifact show --run R --artifact A_NEW --for B_NEW

# 读取旧 B 和新 A_NEW，调整后提交 B_NEW。
memsphere run report --run R --target B_NEW \
  --artifact-file design-new.md --content-type text/markdown \
  --depends-on artifact:A_NEW

memsphere run artifact create --run R --revised-from C --output json
# 返回 C_NEW。
memsphere run artifact show --run R --artifact C --for C_NEW --out implementation-old.md
memsphere run artifact show --run R --artifact B_NEW --for C_NEW

# 同样处理 C，提交 C_NEW。
memsphere run report --run R --target C_NEW \
  --artifact-file implementation-new.md --content-type text/markdown \
  --depends-on artifact:B_NEW
```

| 保留的路径 | 含义 |
| --- | --- |
| `A → B → C` | 原成果及其原始依据 |
| `A_NEW → B_NEW → C_NEW` | 修改后的新路径 |

Agent 始终可以读取旧 B、旧 C。正文即使无需改变，只要要表达新的依赖，也需提交新的 Artifact。下游重做可以直接参考上游 Review，不必机械地给每个产物再建一份意见；发现独立新问题时再记录。

回退不是自动重放。Agent 决定哪些下游需要重做；系统不改写旧依赖，也不自动撤销代码仓库或数据库操作。

### 6.6 使用标签批量引用

```bash
# 已有产物可追加一个或多个标签。
memsphere run artifact tag --run R --artifact A --tag research
memsphere run artifact tag --run R --artifact B --tag research --tag design

# 将本次返回的 Artifact ID 记为 SUMMARY；若此时 research 只有 A、B，实际依赖就是 A、B。
memsphere run report --run R \
  --name "研究总结" --artifact-file summary.md --content-type text/markdown \
  --depends-on tag:research --tag summary

# 后来给 C 打上 research，不会改动 SUMMARY 的依赖。
memsphere run artifact tag --run R --artifact C --tag research

# 若要将新 C 纳入总结，须重新生产并明确重新选择标签。
memsphere run report --run R --revised-from SUMMARY \
  --artifact-file summary-new.md --content-type text/markdown \
  --depends-on tag:research --tag summary
```

还可以选择本 Run 当时已有的全部已提交产物：

```bash
memsphere run report --run R --name "探索总览" \
  --artifact-file overview.md --content-type text/markdown \
  --depends-on tag:default
```

`tag:default` 会包含历史版本和分支，适合确实需要全部成果作为依据的场景；它不等于「目前选中的交付路径」。同次上报创建的总览本身不在匹配结果中。

### 6.7 恢复工作、交付与取消

```bash
memsphere run status --run R
memsphere run show --run R
memsphere run review list --run R --artifact A

# 最终交付可以选一份或多份产物。
memsphere run show --run R --root C_NEW
memsphere run finish --run R --artifact C_NEW
```

create、report、finish、abandon 等业务写操作开始时，会先按已有 Artifact/Step 执行幂等 redo：缺 Step 则按原 stepId 补建，产物已提交而 Step 未完成则补齐；已完成直接沿用，信息不足或冲突再报错。status/show 与 View 保持只读，中间态可由下一次写操作自动补齐，无需独立修复命令。

finish 保存明确选择的 finalArtifactIds。多根交付时，交付视图为各根 dependencies 闭包的并集，按材料类型和 ID 去重，重复根 ID 也去重；revisedFrom 用于历史追溯，不自动让旧路径进入依赖图。轻量 Review 不充当交付门禁。

空选择、未知 ID、跨 Run ID 或未提交产物均失败，不部分结束 Run。已完成 Run 使用同一根集合重复 finish 返回既有结果，改选根集合则拒绝。

若用户明确取消仍在运行的任务，则使用以下操作，而非 finish：

```bash
memsphere run abandon --run R --reason "用户决定取消本次任务。"
```

## 7. 与当前模型和实现的衔接

| 项目 | 状态与后续边界 |
| --- | --- |
| 独立的新领域模块 | 自由探索使用新模块及五个模型 Store；旧流程保留旧模块和原持久化方式。本轮方案明确适配边界，不强制迁移旧模式 |
| 后端替换 | 首版 JSON 文件通过 Store Factory 接入，领域逻辑不依赖文件路径；使用非文件系统测试 Store 验证领域服务可替换后端 |
| Artifact.tags | 本次补入项目模型与示例；默认 default、Run 内作用域、标签可更新及具体 ID 依赖语义写入说明 |
| 标签自动赋值与操作 | 仍需在 CLI / 运行时实现；模型说明不会自动执行这些行为 |
| 默认标签必含约束 | 通用模型可检查数组、字符串及去重；default 必含、跨对象归属和状态转换仍需领域逻辑保证 |
| 轻量 Review | 现有模型的 roundId 和正式参与者约束需要最小适配；在实施方案中列出差异并评审，支持无轮次及未预配置来源，不重建全部领域模型 |
| 读取记录 | --for 明确归属目标 Step.reads；正文优先、记账尽力，Run 不保存读取记录 |
| 草稿 | create 只声明空目标；普通 report 只提交完整成果。Schema 局部正文撰写仍保持独立语义 |
| CLI 可用性 | 现有同名命令也不代表已经支持本文参数与自由探索语义 |
| 数据迁移与重复上报 | 旧运行不迁移；新数据自动 default。直接 report 产生新 ID，target 提交保持 ID；结果不明先查询 |
| 文档范围 | 不新增独立 rewind、artifact submit、依赖确认参数或正式评审命令；不修改现有稳定 Memory |
| 首版前端 | 在现有 Run 模块的运行详情中交付依赖图展示形态和左内容/右评审浮窗；原型固定数据必须在正式实现中替换为新模型 Store 的读取服务 |

文档中的命令示例用于说明目标接口，不代表已经实现。实施方案重点明确新模块与模型 Store 的装配、多个模型记录的完成可见性、失败恢复、读取记录的模型承载和 CLI 新旧路由；不假设远端后端提供跨 Store 事务，不要求 Agent 管理 Step、锁或 revision。需要生产前记录阅读时先声明目标；已完整的简单成果仍可直接 report。

## 8. 首版前端与原型

产物图是现有 Run 模块的另一种详情展示形态。正式实现复用现有运行入口、列表、详情及浮窗，不新增上下文控制前端模块或一级导航；新旧后端持久化仍通过对应应用服务分别读取。

当前界面要求以 [需求契约](context-control-requirement-contract.md) 的“原型确认后的界面契约”及 AC17–AC23 为准。原型演示与逐项对照见 [原型与需求对照](context-control-prototype.md)。

| 场景 | 首版界面行为 |
| --- | --- |
| 运行中查看 | 顶部展示 Run.name 和 status；图展示已提交依赖，另保留正在生产的草稿节点，草稿无已固定依赖边，不能替换默认的最新已提交版本 |
| 节点与标签 | 图上不显示 ID，保留名称和标签；ID 在浮窗查看。图和浮窗统一使用公共 badge，图上隐藏 default，浮窗显示完整标签 |
| 打开产物 | 点击节点才开浮窗，左侧正文和信息、右侧该 ID 的评论；空草稿明确显示未提交，不伪装成读取失败或已提交成果 |
| 图上选历史 | 历史默认收起；从节点的历史按钮选择版本，只切换依赖图，不自动打开浮窗。实际上下游随具体 ID 变化，无下游就不展示 |
| 浮窗内翻页 | 上一版、下一版及版本选择保持同一浮窗打开，正文、评审和背后的依赖图同步切换；关闭后保留最后查看版本的图 |
| 完成与历史 | 默认展示 finalArtifactIds 的精确依赖闭包；逐版本翻阅，不平铺全部修订；一键回到交付视图，不修改交付根或历史依赖 |
| 尺寸与窄屏 | 沿用 Run 评审浮窗区域：桌面约 90% 视口，760px 及以下铺满；窄屏切换内容/评审，图可横向查看 |
| 文案与异常 | 文案对齐模型，删除功能介绍和实现说明；暂无产物、暂无评审和读取失败分别展示，不能把无评审等同通过 |

第一版只承诺上述查看闭环，不包含图上编辑、拖拽编排、正式投票或新的生产页面。原型使用固定数据，正式实现必须替换为新模型 Store 的读取接口。
