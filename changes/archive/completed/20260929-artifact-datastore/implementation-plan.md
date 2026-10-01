# Run 附属数据接入：实施与验证方案

Run：`run-20260929-121744z-d56a5df3`。

需求契约第二轮已获 Human 和 Runner 通过。2026-09-30，Human 确认更新后的需求基线及 D1、D2、D6、D7、D8 的后续决策。第五轮研发通过，Runner 已处置重复的需求确认意见；测试提出的 Worker PID 探测边界经 Human 确认后收入 D6，本候选提交第六轮评审。历史 Submission 保持不可变，技术确认不替代实施方案 Review 投票，评审通过前不开始施工。

## 1. 已确定的技术决策

- 使用 `820530e30d51216f60b0d3c93b725e506924d263` 中已完成的数据层，不重新建设 StoreId、Manager、流式输入或可选 append。
- 文件的原位置、字节和用户配置保持不变；中间 Artifact 不再使用 drafts 专用目录，属于已确认的例外。
- 受管理内容的归档使用跨 Store 搬运，不以整个 Run 目录 rename 代替；复制、校验、切换有效位置、清理源内容；失败允许 redo，不新增搬运进度存储。
- Run 状态仍使用现有文件系统方式；内容查询、归属和搬运清单属于业务层，不要求 DataStore 理解 Run。
- 新技术选择先取得 Human 明确确认，再实施。需求评审通过不等于本文的待决提案已通过。

### 文件布局与行为的保持范围，已确认

2026-09-30，Human 再次核对“除了 draft 文件的位置发生了改变，其他的都没变”，在 Runner 解释下述边界后回复“好，刚刚那个待确定的你更新到技术方案吧，看看还有什么需要我决策的”。

- 唯一主动调整的受管理内容文件布局是中间 Artifact：取消 `artifacts/drafts/` 专用目录，使用 Artifact 的正常布局。阶段记录在 Run 业务状态中。
- 正式 Artifact、Review 冻结副本、Memory 快照、活动 JSON 快照和 JSONL 日志保留正常存储的位置、文件名、字节内容和格式；现有用户配置不变。不增加存储信封、编码层或迁移步骤。
- 已确认的交互变化仍在范围内：正式和中间 Artifact 可另存为本地副本，编辑后统一 report，不强制使用内部原路径。
- 已确认的归档实现变化仍在范围内：受管理内容经 Store 搬运，最终位置不变，支持 redo；中断时允许留待清理的副本，不承诺失败过程中的目录瞬时状态与原 rename 完全一致。
- 日志错误处理按 D2 保持原有回调和批次策略，仅修正 Human 后续确认的失败后快照一致性问题。正常流程之外若发现新回归、原方案无法实现或需要偏离上述边界，先与 Human 讨论。

### D1：模型和 Store 划分，已确认

2026-09-30，Runner 提出下表，并明确活动日志持续追加、活动快照整体替换，建议分开模型与 Store；Human 回复“好，请继续”。该回复针对模型划分，记为技术确认，不作为新的 Artifact Review 投票。

2026-09-30，Runner 提出以下四个模型 ID，Human 回复“我觉得可以。”，确认这组命名。该确认只针对模型命名，不包含尚未确认的查询、导出选择或归档 redo 方案。

| 模型 ID | 模型的业务含义 | 内容 | Store 数量 |
| --- | --- | --- | --- |
| `memsphere/run/artifact` | Artifact | 正式、中间文件产物及 Review 冻结产物 | 当前、归档各一个 |
| `memsphere/run/memory-snapshot-file` | Memory 快照文件 | Run 冻结快照中的单个文件，不是整个快照集合 | 当前、归档各一个 |
| `memsphere/run/agent-activity-log` | Agent 活动日志 | ACP JSONL | 当前、归档各一个 |
| `memsphere/run/agent-activity-snapshot` | Agent 活动快照 | 用于展示、可由日志重建的 JSON | 当前、归档各一个 |

四类均采用 raw 模型定义标准。模型 ID 只表达业务含义，不包含模型定义标准、Payload 格式或存储实现，也不区分当前与归档。八个 Store 是 Project 级实例，不按 Run 创建 Store；一类模型的当前和归档 Store 复用同一模型，以不同 StoreId 区分。模型 ID 与 StoreId 在落地时集中声明，业务显式选择 StoreId，不向 Data 增加 StoreId。

2026-09-30，Human 对“模型 ID/current”和“模型 ID/archive”的命名、根目录及 DataId 映射回复“同意这组命名与映射”。八个绑定明确如下：

| StoreId | 绑定模型 | 根目录 |
| --- | --- | --- |
| `memsphere/run/artifact/current` | `memsphere/run/artifact` | `runsRoot` |
| `memsphere/run/artifact/archive` | `memsphere/run/artifact` | `archiveRoot/runs` |
| `memsphere/run/memory-snapshot-file/current` | `memsphere/run/memory-snapshot-file` | `runsRoot` |
| `memsphere/run/memory-snapshot-file/archive` | `memsphere/run/memory-snapshot-file` | `archiveRoot/runs` |
| `memsphere/run/agent-activity-log/current` | `memsphere/run/agent-activity-log` | `runsRoot` |
| `memsphere/run/agent-activity-log/archive` | `memsphere/run/agent-activity-log` | `archiveRoot/runs` |
| `memsphere/run/agent-activity-snapshot/current` | `memsphere/run/agent-activity-snapshot` | `runsRoot` |
| `memsphere/run/agent-activity-snapshot/archive` | `memsphere/run/agent-activity-snapshot` | `archiveRoot/runs` |

DataId 保留 Run ID 和原相对文件路径。例如 `<runId>/artifacts/<file>` 在当前 Store 和归档 Store 中保持同一 ID，只由所选 Store 根目录决定物理位置。同一根目录内各类内容的归属与清单由 Run 业务层控制，不通过 Store.list 推断。

### D2：活动日志错误处理与失败后的快照一致性

2026-09-30，Human 指出日志错误处理并非本轮新问题，并确认“对，维持现状是不是就行了”。保留现有行为：捕获错误、同一记录器只通过回调报告一次，不终止 Agent 评审，不重放失败批次，不回滚可能已写字节，后续批次仍尝试追加。撤回此前“追加失败后停止该 Attempt 后续持久化”的提案，不将其作为本轮改动或待审批项。

方案第二轮发现既有一致性问题：事件在写入前进入内存 projection；批次 A 写入失败、B 成功后，B 的快照可能仍包含 A 的未落盘事件，且 sourceBytes 与磁盘大小一致，读取端会直接展示该快照。2026-09-30，Human 对“失败后，后续快照从实际落盘日志重建；不重放、不修复日志、不停止 Agent”明确回复“同意”，批准这项有限修正。失败后不再信任内存投影生成的快照，后续快照必须由实际保存的日志完整行重建；损坏完整行仍明确报错，不发布含未持久化事件的快照。不增加持久化状态或改变其余错误处理。

### D3：Artifact 另存为命令、覆盖与默认选择规则

已确认统一另存为能力和统一 report，不新增草稿专用提交。2026-09-30，Runner 单独询问命令和覆盖规则是否可以，Human 回复“我觉得的可以呀”。确认如下，不将该回复扩大为产物选择规则或整个技术方案的通过：

- 在既有 `run artifact` 命令组增加 `export`，使用 `--run`、`--step`、`--file` 选择步骤并指定本地目标。
- 默认不覆盖已有文件，显式 `--force` 才覆盖。
- 不改变 show 和 report 的原选项。

Runner 随后单独询问默认选择规则，Human 回复“可以”，确认以下规则；历史版本的显式选择不包含在本次确认中：

- 步骤正在合成、尚未正式提交时，导出当前中间产物。
- 其他情况沿用 show 的选择：优先当前 Review Submission，否则取该步骤最近一次上报的产物。

Human 随后明确“为了这次迭代的简洁性，那还是就不迭代历史功能了。不新增历史版本选择参数”。本轮 export 只提供上述默认选择，不新增历史 Submission、Round 或旧上报产物的选择参数；保留既有 Review Submission、Round、Run Event 及其文件和查看能力，不新增统一版本链或每次中间编辑的历史快照。这是本轮范围决定，不删除已有提交历史。

### D4：中间与最终 Artifact 的身份，沿用现有关系

依据已确认的“只有中间文件布局调整，正式文件与 Review 冻结副本保持原位置”，不再另外选择新身份协议。现有 `refreshSchemaDraft` 复用中间文件路径，正式上报经 `buildRunEventArtifact` 生成正式文件，Submission 和上下文具有独立路径。接入时保持这一关系：合成期间复用中间 DataId，正式文件、Submission 及修订继续按现有文件命名和独立路径规则分配 DataId，仅中间路径去掉 drafts 目录层。

不将中间 DataId 强行提升为正式 DataId，也不复用或覆盖冻结的 Submission。Run 继续用原业务关联记录表示对应关系；相关状态调整只服务已确认的中间产物操作，不新增一套身份转换或迁移机制。这是保持现有关系的实现约束，不是已通过的新设计提案；若实际代码出现无法保持的边界，再提供具体问题与 Human 讨论。

### D5：Run 附属数据清单属于 Run 状态

2026-09-30，Human 明确“run 下面各种各样文件，都有清单的问题。我认为这些清单，都应该属于 run status 数据的一部分”。按此决策统一处理四类受管理内容，不再只为 Memory 快照设计常态目录枚举查询。

- Run 状态记录 Run 拥有的 Artifact、Memory 快照文件、Agent 活动日志和活动快照的清单，包含通过模型和 DataId 定位资源所需的信息。读取、展示、归档和恢复基于这些业务记录发现资源，内容通过相应 DataStore 访问。
- 清单是 Run 的业务数据，不是独立索引文件，也不是归档进度：不记录已复制数量、搬运检查点或清理阶段。归档和恢复不能为了表达搬运进度而删除清单条目。
- Run 状态仍按现有文件系统方式持久化，本轮不为此改用 ValueStore，也不改变公共 DataStore API。原内容文件的位置、字节及四个模型划分保持不变。

Human 随后澄清“下一步再来做迁移”只指 Run 状态接入 Model／ValueStore；不推迟本轮的缺失清单补充或独立旧 Run 清单补齐工具。该澄清不授权本轮给 Run 状态完成领域建模或更换持久化方式。

Human 随后明确“好多 data_id 已经记录到 status 里去了，只需要补这次没记录的”。优先复用已有业务记录中的资源引用，只为确实缺失的信息补充字段；不新增统一 `data` 数组，也不因存在四个模型而机械增加四份顶层清单。撤回这两种重复清单方案，避免同一资源在业务记录和另一份清单中重复维护。

2026-09-30，Runner 明确提出“只在 memorySnapshot 内补 files: DataId[]，其他资源复用已有引用”，Human 回复“我觉得可以”。该字段结构已确认；不将回复扩大为补齐工具使用规则或整个实施方案通过。

```ts
// RunState 中的快照记录；该属性本身继续为可选。
memorySnapshot?: {
  path: "memory";
  files: DataId[];
};
```

保留现有 `path` 字段和文件布局。`files` 保存单文件 DataId，模型由 Memory 快照业务类型确定，不逐项重复记录。此前“不向 Run 加持久化文件清单”的建议也已撤回，不作为实施约束。

其他资源继续使用已有的定位信息，具体对应如下，不把已有文件引用和可推导的业务身份都称为代码中已经存在名为 DataId 的字段：

| 内容 | Run 状态已有信息 | 接入方式 |
| --- | --- | --- |
| 正式 Artifact | `events[].artifact.path` | 复用原引用，经业务路径映射取得 DataId，不另设 Artifact 清单 |
| Review 冻结文件 | Submission 的 `artifact.path` 及 `contextArtifacts[].artifact.path` | 复用各独立文件引用，不另设 Review 文件清单 |
| 中间 Artifact | `schemaDrafts[].path` | 复用并按已确认要求调整目录布局，不另设中间产物清单 |
| 活动日志、活动快照 | Run、Review、Round、Assignment、Attempt 的身份 | 复用确定性的业务映射定位两个资源，查询 Store 判断文件是否存在，不另建两份顶层数组或每批登记身份 |
| Memory 快照文件 | 原 `memorySnapshot.path` | 补充已确认的 `files: DataId[]` |

读取、归档和恢复由业务遍历上述记录、映射并去重得到受管理资源集合，不把这个集合再次持久化成第二份总清单。本轮由 Run 业务根据当前/归档位置和模型选择对应 Store；这不是宣称 model 在数据层唯一决定 Store，归档有效位置按已确认的 D6 切换规则判断。

### 旧 Run 清单补齐，使用独立小工具

后续 Human 确认 .gitkeep 是可丢弃的 Git 占位，不属于快照内容。新快照和补齐工具排除普通 .gitkeep；源 Project 不删除占位文件。归档/恢复完成状态切换后的旧端清理可以丢弃 Memory 目录内的普通占位文件，其他未知文件仍保留并报告。撤回为此扩展 Store 默认 contentType 的提案，不改变 API 或用户配置。详见 decision-pending-unknown-content-type.md（已确认）。

2026-09-30，Human 对首次访问时补齐的提案明确要求“这个需要是一个单独的小工具才行，别在核心代码里带上，这样未来代码太臃肿”。补齐旧记录作为独立工具执行，不接入核心正常读取、写入、展示、归档或恢复的自动回退链路。

工具利用已有业务记录及原目录识别受管理内容，只补齐并保存 Run 状态中的清单，不移动、重编码或删除原内容，不增加独立索引文件。核心运行代码只管理和使用正常的 Run 清单，不负责扫描旧目录并生成历史清单。此工具是此前“不建设迁移工具”限制的明确、局部调整，不扩展为通用历史格式迁移系统，也不恢复旧 drafts 流程。

Human 对工具使用规则回复“这个无所谓，你定就行，只要能实现功能”，授权 Runner 决定这一工具的使用细节。采用以下规则，不再作为待决项；该授权不扩大到其他技术决策或对真实历史 Run 执行写入：

- 提供独立脚本 `scripts/backfill-run-memory-manifest.mjs`，用 `--run-file` 显式指定当前或归档 Run 的状态 JSON 文件，不注册为核心命令，不在核心访问时自动调用。
- 默认只检查并展示拟补充的清单，显式 `--write` 才保存。只补缺失的 `memorySnapshot.files`，保留其他状态字段及内容文件；已有清单不覆盖，重复执行不重复追加。没有 Memory 快照的 Run 无需补充。
- 补齐前校验目标 Run 身份、快照目录及文件路径；无法安全识别时报告错误，不把目录缺失或访问失败解释为空快照。写回采用临时文件替换，不直接截断原状态文件。
- 在旧 Run 首次需要读取 Memory 快照或进行完整归档/恢复之前执行。核心相关操作遇到缺失清单时明确提示使用工具，不自动补齐、不把它视为空快照；不因此阻断不依赖该清单的 Artifact 读取。

脚本尚未实现，也未对真实 Run 执行。交付时附当前与归档 Run 的使用示例；验证检查无写入、补齐后读取、重复执行和异常目标不被修改。

### D6：redo 覆盖、切换依据与 Worker 收尾，已确认

Human 对“发现冲突则报错，保留两端”明确要求改为 redo 覆盖，并要求每个步骤重复执行时语义一致。撤回同 ID 内容不同即阻断搬运的提案：在复制阶段以源内容为准，目标缺失则创建，目标存在则整体覆盖；目标已一致时可跳过。覆盖只针对本次搬运清单中的目标资源，不改变源 Artifact 或 Review 冻结副本。真实读取、写入、校验失败仍须报告，不能把失败当作完成。

Human 对“Agent Worker 还未退出时暂不归档，提示稍后重试，避免漏掉最后一批日志”回复“可以”，确认此规则。现有代码在保存停止状态后才于 finally 中调用 `activity.close()`，Run Attempt 已有可选 `workerPid`；不能把 Attempt 的 completedAt 当成 flush 完成证明。

2026-09-30，向 Human 说明探测的是已有 Worker PID、不是 View 或 Agent CLI 的 PID，并说明保守探测边界后，Human 回复“哦哦，那可以呀，可以基于这个 pid 做检查”。归档和恢复在修改两端内容或状态之前检查已有 Worker PID：

- 用 `process.kill(pid, 0)` 探测；只有 `ESRCH` 明确表示 PID 不存在，才允许继续。探测成功、权限受限或其他无法确定的错误均阻断本次搬运，提示稍后重试，两端保持不变。
- 不发送终止信号、不新增身份字段或持久化收尾标记。PID 探测不证明进程身份；PID 复用可能保守误拦，本轮不建设强身份核验。
- 没有 workerPid 的既有记录不补造身份，保留原有处理；重复执行时重新探测，不以固定等待时间或旧探测结果推断已退出。
- 验证存活、已退出、PID 复用、权限受限及其他不确定错误、无 PID、拒绝后两端不修改、退出后重试；通过可控探测注入避免依赖真实 PID 复用或固定 sleep。

Runner 随后单独询问“源端还有 Run 状态文件，就继续按源覆盖目标；内容校验完成后，最后移动状态文件。此后重跑只清理旧端，不再反向复制。不增加进度记录”，Human 回复“可以”，确认这一切换规则。固定本次命令的搬运方向，归档与恢复对称执行；不将该确认扩大为整个方案的正式评审通过。

| Run 状态文件的位置 | 有效端及重跑动作 |
| --- | --- |
| 源端仍有有效状态文件 | 源为准，保留源内容，继续复制并覆盖目标；目标也有状态副本时不提前视为切换完成 |
| 源端状态已不存在，目标端有有效状态文件 | 目标为准，确认目标清单中的内容完整后继续清理旧端；不从旧端反向覆盖目标 |
| 两端都无法取得有效状态文件 | 缺少操作依据，报告真实缺失或损坏，不把目录存在当作已完成，不合成一份 Run |

内容保存和校验全部完成后，最后移动状态文件完成切换。普通目标目录或既有 `.archive.json` 不单独作为完成依据；归档列表不把切换前的目标目录视作有效归档。状态文件移动失败时不得清理源内容；实现仍须验证跨平台替换和跨卷失败，不能宣称跨 Store 原子事务。

重复执行按操作语义处理，不通过改变公共 DataStore API 实现：

| 步骤 | 重复执行的语义 |
| --- | --- |
| 复制 | 重读源内容，目标缺失用 create，目标存在用 update 整条替换；不使用 append，避免重跑叠加内容 |
| 校验 | 重新读取两端并检查本次复制结果；未完成或不一致时重新覆盖，存储失败则保留源并允许之后重跑 |
| 切换 | 按状态文件位置判断是否已完成；尚未切换时在内容完整后移动状态文件，已切换则不再移动回去 |
| 清理 | 仅在切换和有效端内容确认后删除旧端清单中的资源；已删除视为完成，不因缺失而失败；不从旧端反向覆盖有效端 |

输入流只能消费一次，校验和重跑均需重新 get，不能复用已消费的 Payload 流。`create` 的“存在时报错”和 `update` 的“不存在时报错”保持不变；业务在既定搬运方向上组织覆盖，不新增 upsert 接口，也不重放日志追加。

### D7：兼容基线的本轮例外，已确认

2026-09-30，`git tag --list '*stable*'` 与 `git ls-remote --tags origin '*stable*'` 均成功且无匹配结果。已向 Human 明确说明这与需求规范要求 stable Tag checkpoint 的冲突。Human 对“明确批准本轮基线例外，继续以 820530e 做回归参照，保持兼容范围，不额外创建 Tag”回复“同意”。本轮据此采用该 checkpoint 要求的明确例外，不冒称规范原要求已经满足，不修改全局规范或扩大到其他迭代。

### D8：活动记录的存在性与搬运边界，已确认

现有 `review-worker` 先记录 Attempt，再创建记录器；活动文件只在 flush 成功后出现，记录失败仅报 stderr，不使 Attempt 失败。任一 Attempt 状态都不能证明日志或快照必然成功生成。既有 Run 没有“曾保存过此活动文件”的字段，只凭 DataId 和 get 不存在，无法追溯区分从未生成与搬运前已被外部删除。

2026-09-30，Human 对以下边界回复“接受，请你继续”：

- 活动日志和活动快照允许缺失，不增加持久化存在性字段。开始搬运时按 Attempt 身份推导两类 ID，通过 Store 实际读取取得本次存在的资源；初始明确不存在可视为无记录，但 I/O、权限或其他读取故障不能伪装为不存在。
- 本次已确认存在的内容，在复制、验证到状态切换前缺失或不可读，必须报错、中断切换并保留源。集合只存在于本次操作内存中，不保存搬运进度。
- 正式 Artifact、Review 引用和 Memory files 是明确资源引用，缺失仍报错，不套用活动记录的可选规则。
- Worker 退出前不开始搬运；D6 的状态权威、redo 和切换后只清理规则不变。有效端存在的活动资源需校验后才能清理旧端；有效端初始没有活动资源而旧端仍有时，不删除旧端该资源并报告搬运不完整，不反向复制覆盖有效端。
- 不承诺识别搬运开始前已被外部删除且没有历史存在记录的活动文件；不据此增加清单、修复历史状态或扩大兼容工具职责。

## 2. 实际代码调查

| 代码入口 | 现状 | 接入要点 |
| --- | --- | --- |
| `src/run/store.ts` 的 `buildRunEventArtifact` | 按原文件名写入 Artifact，Run Event 保存相对路径和 contentType | 通过 Artifact Store 写入，保留正式路径和内容 |
| 同文件的 `buildArtifactReviewContextArtifacts` | 将前序产物复制为 Submission 下的独立文件 | 经 Store 复制，保留每次 Submission 的独立身份与不可变性 |
| 同文件的 `refreshSchemaDraft`、`reportSchemaFinalArtifact` | 在 drafts 目录合成中间文件，最终上报强制使用内部原路径 | 调整中间内容布局；另存为副本可统一上报，现有身份关系按 D4 保留 |
| 同文件的 `writeRunMemorySnapshot` | 将四类 Memory 目录复制后发布；Run 仅保存 `memorySnapshot.path` | 内容接入 Store，生成的文件清单按 D5 记录在 Run 状态 |
| `src/commands/memory.ts` 的 `createMemoryCommandCatalog` | 将 Run 的本地 memory 目录传给文件型 Provider | 需要从 Store 读取的快照 Provider，不能继续依赖本地目录取内容 |
| `src/acp/activity.ts` 的 `AgentActivityRecorder.flush` | 约 200ms 合并一个批次，串行追加 JSONL，再替换 JSON 快照 | 批次通过有限输入流接入 create/append；既有错误处理按 D2 保持不变 |
| 同文件的 `readAgentActivitySnapshot` | 用原日志大小与快照 sourceBytes 比较；必要时从完整 JSONL 行重建 | 不使用 Store 私有路径/stat；过期判断、部分行及读取成本需验证 |
| `src/acp/review-worker.ts` | 记录错误写 stderr，不因活动记录失败直接终止评审；finally 中关闭记录器 | 沿用错误回调和关闭流程，不增加终止 Agent 或停止后续记录的策略 |
| `src/archive/store.ts` | 移动整个 Run 目录，拒绝目标目录已存在；恢复也移动整个目录 | 不能沿用这些操作搬运受管理内容；原有冲突判断需与 redo 协调 |
| `src/data/extensions/filesystem-datastore/index.ts` | create/update 在输入 EOF 后发布完整文件；append 已写前缀可见，失败可留前缀 | 首批不能用一直不关闭的 create 流实现实时展示；append 不具备安全整批重试语义 |

`DefaultDataManager.getStore` 不要求先加载模型定义或 Runtime 即可创建 DataStore。Project 宿主负责提供既有配置转换出的 StoreBinding，并共享进程级 Extension Registry；不存在依靠 Run 各自装配无限多个 Store 的必要性。

## 3. 接入方式

### 3.1 活动日志

接入使用已确认的数据层接口，保留已有批次节奏，不增加长期打开的输出流接口；下面的调用映射属于既定边界内的接入，不再逐项重复审批：

日志 Payload 固定使用 `application/x-ndjson`，保留原 `<attemptId>.acp.jsonl` 文件名。两个活动日志 Store 的内部 Config 提供 `contentTypeExtensions: { "application/x-ndjson": [".acp.jsonl"] }`，当前和归档使用同一映射；其余六个 Store 沿用默认映射（JSON 快照为 application/json）。这是使用既有 Config 能力补齐装配细节，不增加用户配置入口，不修改 DataStore 公共接口或默认扩展名表，也不对日志做额外编码。所有日志 create/append 和搬运写入均使用该类型，get 按同一后缀识别。

1. 每个 Attempt 对应一个日志 DataId，一个活动快照 DataId；业务根据原有身份与相对路径定位。
2. 日志不存在时，首个非空批次使用 create；批次输入为有限流，提供 EOF，等待保存完成。日志已存在时按原有语义追加，不替换原内容；不能把 has 查询当成 create 的原子保证，也不因失败自动重放本批。
3. 后续非空批次串行调用 AppendableDataStore.append，每次只提供本批字节。不自动创建、不由 Store 插入换行；业务继续按现有格式生成完整 JSONL 行。
4. 本批日志写入成功后，再 create/update 活动快照；快照内容继续过滤敏感原始字段，保留现有容量限制。无新日志时无需空追加。正常写入沿用批次投影；发生过日志写入失败后，记录器不再把内存投影当作已保存事实，后续快照从 get 返回的实际日志完整行重建，并由同一次内容读取计算 sourceBytes。若完整行损坏，重建报错且不发布新快照；后续日志批次仍按原策略尝试写入。
5. 正常 close 等待最后一个批次与已排队操作完成。每批的 EOF 只结束本批写入，不代表 Agent 会话结束；会话结束由记录器 close 协调。
6. 本批日志创建或追加失败时，本批不继续保存快照，并在记录器内标记投影不可信，之后按第 4 项从实际日志重建快照。该标记仅是进程内实现状态，不新增持久化字段。原有 flush 错误捕获与报告机制不变，后续 flush 清除前次队列拒绝后继续处理新批次。不得把底层失败写入标成成功，不自动重放本批，也不因此自动重启或重新执行 Agent。
7. 日志已保存而快照保存失败时，后续读取仍可按原机制重建，后续 flush 继续处理新批次；不重放已追加的日志，不增加本批自动重试策略。
8. 读取时继续忽略尚无换行的尾部，完整行损坏则明确报错；不能把未到达或未保存的数据当作展示结果。沿用既有 sourceBytes 校验时，字节数从 get 返回的内容流统计，不依赖文件 stat 或新增 Payload.size。

既有追加失败可能留下部分内容，后续继续追加可能形成损坏的完整行；该风险在原 appendFile 路径已存在。本轮不顺带建设停止记录、日志修复或恢复协议，遇到完整行损坏仍沿用明确报错的读取行为。若实际验证发现新 Store 引入不同于原实现的失败语义，先报告具体差异，再与 Human 讨论，不以维持现状为由掩盖新回归。

接入代码尚未实现。日志 Store 必须声明 append 能力；持久化入口检测到能力缺失时明确报告 Store 配置不支持日志追加，沿用 D2 的错误回调与报告策略，不偷偷退回直接文件追加，也不因此额外终止 Agent。当前与归档内容读取仅依赖 DataStore 通用能力。

成本需要如实验证：通用接口没有“内容长度查询”，沿用 sourceBytes 判断可能需要读取完整日志；当前 filesystem get 本身也会读取整份文件。不能把流接口当作现有实现已经具备低成本随机访问的证据，不为规避这一点自行增加公共 API。

### 3.2 Memory 快照文件与状态更新

现有 `startRun` 先完成 `writeRunMemorySnapshot`，再保存 Run 状态；状态保存失败时清理本次快照。本轮保持这个正常顺序，不另行新增“先保存空清单、再逐项补写状态”的过程：

1. 业务枚举本次快照来源，按原目录结构为每个受管理文件确定 DataId，通过快照 Store 保存内容，并收集文件身份。来源枚举服务于创建快照，不是核心读取旧 Run 时的补齐回退。
2. 所有快照内容成功保存后，将完整的 `files` 与现有 `memorySnapshot.path` 一起放入 Run 状态，通过原状态保存入口一次发布。随后的快照发现使用 `files`，不扫描目标目录。
3. 常规写入或状态保存失败时，沿用“不成功创建 Run”的处理方向，通过 Store 清理本次写入的内容并报告失败，不把不完整清单当作有效 Run。本次清理所需的本地变量不是新增持久化进度记录。

现有进程崩溃也可能发生在快照已发布、Run 状态尚未保存之间；本轮不能宣称跨 Store 与状态文件形成原子事务。应验证对应中断、清理失败及孤立内容边界；若 Store 接入导致无法维持原有正常结果或需要新增恢复策略，先提供具体反例与 Human 决策，不自行增加检查点、后台扫描或状态协议。

### 3.3 归档流程与现有文件系统记录

按已确认的 D6 组织受管理内容：读取源 Run 的既有引用和 Memory 文件清单，复制、覆盖并校验全部内容；最后移动 Run 状态文件，再按有效端的清单清理旧端。恢复反向执行。切换后重跑不要求旧端仍保有完整清单或完整内容，也不重新复制其残留文件。

实际代码中，Procedure 快照等业务状态已经内嵌在 Run 状态 JSON 中；常规 Run 内容在本轮四类模型范围内。未建模的 Run 状态及既有 `.archive.json` 继续使用文件系统；活动调试 `launch.json`、`prompt.md` 位于 `config.debug.root`，不是本次 Run 内容搬运对象。不为假设的其他文件新增 Model、Store 或通用搬运机制。

实施补充决策：Human 明确“可以的，处理方式和 run 的 status 保持一致吧”。`.archive.json` 与 Run status 同为状态信息，保留原 JSON 格式及最终布局，不进入内容 Store、不新增字段。内容复制与校验后先保存既有归档元信息，最后移动 Run status；它不作为搬运进度或有效位置判据。这样旧式根目录 Run 的 layout 信息不会在状态移动成功、元信息保存失败时丢失。两份状态均采用原生文件操作，元信息写入采用与 Run status 一致的临时文件替换。已经完成的同次归档元信息不反复改变时间；directory 恢复后保留原元信息位置，legacy-file 恢复仍不保留。详见 decision-pending-archive-layout.md，此项已确认，不作为待决项。

ChangeSet 归档保持原搬运方式。旧目录若实际出现无法由当前业务记录覆盖的额外文件，先说明具体来源与影响并向 Human 决策，不擅自删除或增加恢复协议。

需要验证复制失败时源端完整可读；状态移动失败时不清理源；切换后元信息或清理失败可重跑；源端仅剩部分文件仍能完成清理；完整重复执行收敛到同一有效位置。跨卷移动错误不自动转成“复制状态文件后删除源”的双状态协议；若现有配置要求跨卷支持，提供实际失败后另行讨论。

### 3.4 本地导出副本进入统一 report

现有 `reportRunUnlocked` 在 Schema 最终提交阶段调用 `reportSchemaFinalArtifact`；后者的 `assertManagedSchemaDraftSource` 强制输入等于内部草稿路径。本轮不是只修改提示，而是取消此输入来源限制，接受 `--artifact-file` 指定的本地文件副本。受管理内容的写入目标仍由 Run 决定，不能把输入路径当作 Store 目标或借此修改 Submission。内部原路径不再作为必须编辑的公共入口。

接入顺序保持既有业务阶段和校验职责：

1. 当前 Run、父步骤、Schema 最终提交阶段及 Runner 权限仍按现有状态检查；本地文件副本不是绕过未完成字段或任意重写历史步骤的凭据。完整合成产物的最终 report 仍在既有最终提交阶段进行，逐字段上报流程不改变。
2. 输入沿用统一文件型 report 的读取约定，由 `prepareArtifactCandidate` 一次读取成候选内容并完成格式解析，再执行当前父步骤的 Artifact 校验。取消“输入必须在内部 Artifact 目录且等于 draft.path”的检查；Store 写入目标的身份和路径安全检查保留。
3. 输入不可读、格式错误或校验失败时不弹出 Schema frame，不推进父步骤，不覆盖已保存中间内容，不生成正式 Submission。沿用现有校验结果记录机制，保留可继续修订的最终提交状态；用户修正本地副本后重跑同一 report。
4. 校验通过后使用已读取的候选字节创建正式 Artifact：无 Review 时创建既有正式文件和 Run Event，有 Review 时创建新 Submission 独立文件及冻结上下文。不得重新从用户输入路径读取后写入，避免校验与提交使用不同内容；不先用本地副本覆盖中间文件，不将中间 DataId 提升为 Submission 身份。
5. 正式内容或 Run 状态保存失败时，保留原有未接纳状态，清理本次新建的候选文件；不删除源副本或此前 Submission。保持已有常规失败处理，不宣称跨 Store 事务；若新 Store 无法维持该结果，报告具体反例并先与 Human 讨论。
6. 正常正式产物上报和评审要求修改后的上报继续走既有 `acceptPreparedArtifact`／`reportReviewedArtifact`，revision summary 与权限要求不变。对历史 Submission 的保留不因本轮无历史导出参数而削弱。

验证使用内部目录之外的本地导出副本：有效副本完成最终提交；无效、不可读及持久化失败保持中间状态；旧 Submission 不被覆盖；新 Submission 的 digest 与已校验字节一致；正式、副本和中间 DataId 关系不变；未完成 Schema 不因导出而提前完成；export 不改变 Run，默认目标存在时报错、force 覆盖仅影响本地副本。

## 4. 技术决策状态

StoreId 映射、日志失败后的快照一致性、兼容基线例外及活动记录存在性边界已分别收入 D1、D2、D7、D8；新版契约确认见第 8 章。已决事项不重复审批。历史版本显式选择不纳入本轮，技术确认不替代实施方案 Review 投票。

Worker PID 探测的保守边界已由 Human 确认并收入 D6。当前无已知待决项。

实施和验证中发现实际反例、需要改变公共 API、文件布局、配置、失败策略或本轮边界时，仍须先向 Human 说明并取得明确决定，不通过 Agent 评审代替 Human 技术决策。

## 5. 影响范围与开发工作

正式方案评审通过后，按以下职责产出开发计划，再开始施工：

- Project 数据宿主：注册内置 Extension，声明四类模型、八个 StoreBinding，复用 DataManager；由既有根目录配置得出物理位置，不增加用户配置入口。
- Run 内容访问：Artifact、Memory 快照和活动记录的写入、按 ID 读取、删除、复制使用各自 Store；清单按 D5 纳入 Run 状态，状态自身不改用 ValueStore。
- CLI、View 与 Review：替换内容读取旁路；统一另存为与上报，更新仍要求编辑内部 draft 路径的提示。
- Memory 快照 Provider：保留 Memory 的逻辑引用、解析与 Catalog 能力，从 Run 状态获取快照文件清单，经 Store 读取内容；不改造普通 Project Memory 持久化。
- 独立旧记录补齐工具：按已确认边界生成并保存旧 Run 的受管理内容清单；与核心访问代码隔离，不在正常访问中自动调用。
- 归档与恢复：业务层组织受管理内容清单和跨 Store 搬运，协调剩余文件；ChangeSet 归档不因这次 Run 改造而改变。
- 文档、System Memory 和 Skill：同步实际改变的 Artifact 操作与 Schema 最终提交提示；修改 Memory 时按流程创建或复用 ChangeSet 并执行变更级 validate。

目前未发现必须改变 `src/data/api` 才能接入日志 create/append 的理由。清单、补齐工具、日志错误处理及 redo 切换规则已确定；实时查询成本和切换可靠性仍需验证，不能据此宣称整个接入已无风险。

## 6. 验证方案

| 被保护的契约 | 验证方式 |
| --- | --- |
| 四模型、八 Store，Project 隔离，当前与归档分别可替换 | 受控 Store 和 Factory 记录调用，断言 StoreId/model；同一 Project 不按 Run 增殖 Store |
| 原正式文件的位置、字节、摘要与配置不变 | 用 820530e 的结构构造已有当前和归档记录，走新 CLI/View/Review 读取及搬运，逐项核对 |
| 活动记录运行中可见，不要求会话先结束 | 控制 flush 和输入流边界，首批及后续批次读取；不使用固定 sleep 推断成功 |
| 日志只保存一次，快照来源可信 | 首批 create、后续 append；快照失败后重建，不重复追加；断言原日志与过滤投影 |
| 写入错误回调及批次策略不变，失败后快照不展示未保存事件 | 注入批次 A 零字节失败、完整行后失败及部分行后失败，再让批次 B 成功；断言回调只报告一次、Agent 不停止、B 仍尝试保存、A 不重放。零字节失败后快照不含 A，完整行后失败只展示实际保存的行，sourceBytes 来自同一次重建内容；部分行拼成损坏完整行时读取和重建明确报错，不发布含未保存事件的新快照，不修复日志 |
| Run 状态提供完整定位信息，不增加重复清单或依赖目标目录常态枚举 | 复用 Artifact 和 Review 引用、活动身份映射；新增 Memory files 覆盖空快照、来源枚举、文件保存与状态发布失败，不用缺失字段冒充空清单 |
| Memory 快照内容和逻辑读取不变 | 使用非规范文件名、四类 Memory、缺失类别和引用关系；Provider 文件清单来自 Run 状态、内容来自受控 Store；旧 Run 补齐后验证原有读取与搬运 |
| 旧 Run 清单补齐与核心访问隔离 | 单独运行工具前后核对内容位置、字节和业务记录；验证默认检查不写入、显式写入只补缺失字段、重复执行不覆盖、异常目标保留原状态；核心不会自动扫描或补写清单，不把未补齐误作空集合 |
| 正式与中间产物可导出编辑再统一 report | 按第 1 章 D3 验证 export 命令、覆盖及默认选择规则：合成中的中间产物、当前 Review Submission、最近一次上报产物；覆盖非法内容、Review 冻结边界，并按 D4 验证既有身份关系；不新增历史选择参数，既有历史提交和查看能力不丢失 |
| 归档和恢复可 redo，每步重复执行语义一致 | 各复制/校验/切换/清理边界注入失败和重启；目标同 ID 内容不同自动覆盖，部分写入重跑不追加重复字节，已删除资源再次清理成功；状态切换前始终读源，切换后始终读目标，源仅清理一部分也不反向复制；覆盖对称恢复、反复执行、两端状态副本及状态缺失，Worker 未退出时不搬运，移动状态失败不删源 |
| Worker PID 探测保守且不修改受阻 Run | 可控探测覆盖 PID 存活、复用、ESRCH、权限受限及其他不确定错误；仅明确不存在允许搬运，无 PID 保留既有处理。归档与恢复受阻时两端内容和状态均不变，不终止进程；退出后重试成功，不以固定 sleep 推断退出 |
| 不依赖 Store 私有文件路径发现和读取已登记的内容 | 使用不暴露本地目录的受控 Store，禁用 Store.list；仍能根据 Run 状态清单查询和搬运内容 |
| 活动记录可选性不掩盖搬运故障 | 覆盖各 Attempt 状态下两类活动文件均无、仅日志、仅快照及两者均有；不存在可跳过，I/O/权限错误必须报错。已发现后在复制/验证前消失阻断切换，保留源；明确 Artifact/Memory 引用缺失仍报错。切换后有效端缺少但旧端仍有活动内容时不删除旧端、不反向覆盖并报错；正常删源后 redo 不要求旧端仍完整。不增加持久化存在性清单 |
| 原 JSONL 文件名可通过 Store 持续保存与搬运 | 使用实际 filesystem Factory 和宿主内部 Config，验证 .acp.jsonl 首批 create、后续 append、get 的 application/x-ndjson，以及跨当前/归档 Store 的复制、恢复字节与 contentType 一致；不修改用户配置或公共 API |
| Linux、Windows、macOS 与路径安全 | 嵌套相对 ID、平台路径及非法路径测试，配合现有跨平台 CI；不将 Linux 结果当作其他平台实测 |

受影响套件包括 data-manager、agent-activity、run-store、run-command、review 相关测试、archive-store 和 View 集成测试。实际前端交互发生变更时使用 playwright-cli 操作受影响流程；System Memory 修改时运行 reserved-store 测试及 Memory ChangeSet validate。最终执行 typecheck、全量 npm test、build 与 memsphere validate，区分本轮失败、历史失败和环境阻塞。

本文是代码调查与验证设计，不是测试结果；本轮尚未修改接入代码、运行接入测试或完成整体验收。

## 7. 采用的规则与下一步

采用以下已读取的规范：

- `statements/memsphere-repository-development-rules`：避免过度设计，保持代码、System Memory 与 Skill 同步，不擅自新增 syntax 关键字。
- `statements/memsphere-repository-testing-rules`：按用户可观察契约组织测试，执行受影响与全量验证，记录未验证项及环境限制。
- `statements/memsphere-repository-requirement-rules`：明确向前兼容结论、范围和验收基线；仅 stable checkpoint 要求按 D7 的 Human 明确批准采用本轮例外。以 `820530e` 构造第 6 章已有记录的回归输入，不称其为稳定 Tag，不降低文件、内容及配置兼容范围，不创建 Tag、不更改全局规范、不承诺任意其他历史状态。

已读取 Run、Artifact Review 和 Memory 的相关 Concept。需求基线为原已确认契约及 Human 于 2026-09-30 明确确认的第 8 章补充，不能只引用仍缺少这些补充的旧冻结 Submission。

本轮不提议新增 Memory YAML syntax 关键字。若后续方案需要新增，按开发规范单独列明并先取得 Human 确认。

已确定的技术决策集中在第 1 章，第 4 章说明当前决策状态。曾提出但已撤回或排除的方案不作为施工要求，也不通过加入额外实现恢复到本轮范围内。

已确认项不重复审批，既定边界内的接入细节不逐项请求确认。向同一个 Run 上报本文，进入研发、架构、测试评审；依 CLI 返回的下一动作推进，评审通过后再产出开发计划与实现。

第四轮研发意见要求将新基线写回 flow[1] 的旧冻结 Submission，Runner 不采纳该具体操作：Procedure 要求“范围变化必须先更新需求契约并重新确认”，并未要求改写历史 Artifact。本地 change.md 和本章第 8 节已更新，Human 对更新后的基线和后续选择逐项明确确认，新候选连同当前完整基线一起冻结。旧 Submission 是当时事实，不再作为清单待决等旧结论的当前施工依据；不能为消除历史文字而篡改旧材料，也不重复索取同义确认。

## 8. 新版需求契约（Human 已确认的当前基线）

此补充与本地 `change.md` 一致，明确替代原第二轮冻结契约中关于清单尚未决定及“旧记录无需迁移即可使用”的不完整表述。旧 Submission 不修改、原投票不扩张；Human 已重新确认此补充，将其随修订方案一起冻结为新一轮评审依据，不另起 Run。

整体目标：将 Run 附属数据的文件内容读写、归档与恢复收敛到已完成的数据层，保留将当前和归档 Store 分别替换为其他后端的能力。当前范围、后续范围、交付物和验收要求如下，均整理自已确认契约与决策，不新增需求：

- 整体目标及本轮内容范围不变：Artifact、Memory 快照文件、活动日志和活动快照接入四类 raw 模型、八个 Project 级当前/归档 Store；Run 状态仍是本地 JSON，后续再接入 Model／ValueStore。
- 清单属于 Run 状态，已有 Artifact、Submission、上下文及中间引用和活动身份映射继续复用；仅缺失的 Memory 文件清单补为 `memorySnapshot.files: DataId[]`，不新增总清单、四份重复数组或搬运进度。
- **结论：需要向前兼容。** 正式产物、Review 冻结材料、Memory 内容、活动文件及已归档内容的原位置、文件名、字节格式与用户配置不变；以 `820530e` 作本轮额外回归参照，不把它称为稳定 Tag checkpoint。
- **兼容前提的明确例外：旧 Run 若有 Memory 快照但缺少 files，必须先手动运行独立工具补齐状态清单，再执行依赖该清单的 Memory 读取、完整归档或恢复。** 工具只补状态，不移动、编码或删除内容；默认检查，显式写入，重复执行不覆盖已有清单。核心不自动扫描或写回，缺失清单不解释为空；不依赖该清单的 Artifact 读取不受影响。这是有意改变旧 Run 的可用前提，不再声称这些操作零写入即可继续使用。
- 中间产物取消 drafts 目录并记录阶段，不兼容旧未完成草稿流程；本地副本可导出并按既有 report 阶段统一提交。本轮不新增历史版本选择、统一版本链、额外历史快照、OSS 后端或配置入口。
- 归档及恢复按已确认的复制覆盖、校验、最后移动 Run 状态、清理旧端执行，逐步可 redo；Worker 未退出时暂不搬运，不增加进度持久化。
- 方案第二轮后的明确补充：八个 StoreId 与目录映射按 D1；日志写入失败后，后续快照只从实际保存的日志重建，不展示未持久化事件，不重放、不修复日志、不停止 Agent；stable checkpoint 要求仅本轮采用 D7 的明确例外，兼容范围不降低。
- 方案第三轮后的明确补充：活动资源存在性按 D8 处理。允许初始无记录；搬运已确认存在后缺失或不可读报错，明确资源引用仍不可缺失，不新增存在性状态，不承诺检测未登记的搬运前外部删除。
- 交付物增加独立补齐脚本、使用说明和检查/写入/重跑测试；状态 files 字段、Store 接入、export/report、归档/恢复、CLI/View/Review/Memory/Skill 同步及测试仍按本文第 5、6 章验收。
- Human 保留全部新增技术决策权；发现需要偏离上述范围、公共接口、配置、布局或失败策略时，先讨论，不先实现后确认。

交付物：Project 数据宿主与四模型八 Store 装配；Artifact、Memory、活动记录的业务读写接入；export/report、归档与恢复；独立清单补齐工具；CLI/View/Review 读取同步；相关文档、System Memory 与 Skill 同步；自动化测试及实际验证报告。验收标准为第 6 章完整矩阵，覆盖文件位置和字节保持、清单驱动读取、原日志错误策略与有限快照修正、导出副本提交、归档恢复 redo、活动可选性、路径安全及跨平台验证。后续范围：Run 状态领域建模与 ValueStore、云存储后端、配置开放和新增历史选择能力，均不在本轮实施。

待确认项：当前无已知待决项。已确认事项不重复审批，实施中发现实际新问题时按同一门禁讨论。

确认记录：2026-09-30，Human 在收到新版契约补充及旧 Run 清单前置条件说明后回复：“确定，我觉得可以按照这个结论，你继续你的流程了”。此记录确认新版需求契约补充，不作为实施方案 Review 的通过票，也不追溯修改旧需求 Submission。

后续确认：同日，Human 对 D1 回复“同意这组命名与映射”，并对 D2 的日志一致性修正和 D7 的本轮基线例外分别回复“同意”。这三项记录随第三轮方案冻结，不改写旧 Submission 或旧投票。

第四轮补充确认：Human 对活动资源存在性边界回复“接受，请你继续”。本次将 D8 随第四轮方案冻结，不改变旧轮次材料。

第六轮补充确认：Human 对使用已有 Worker PID 及其保守探测边界回复“哦哦，那可以呀，可以基于这个 pid 做检查”。本次将 D6 的探测语义和验证要求随第六轮方案冻结，不作为方案 Review 的通过票。
