# 自由探索体验优化：实施与验证方案

状态：按第2轮持久化与模型装载意见修订，重新提交正式评审；未开始实现。基线为73c60253b0949e10cd166538fb37c20b8095faeb。

## 最终行为

本方案对应同目录 requirements-revised.md 的 F1–F10、AC1–AC15。原已评审契约保留，修订重点是移出 ACP／环境默认 ID／Runner 宿主，并明确辅助读取窗口采用尽力而为的轻量方式，以及成果推导与人工增删。当前需求基线是原flow[1]加已确认修订；当前修订需求产物为artifact-8f2e93fb-3e49-419b-9fc2-0b7ecd6208b2，Human确认依据见requirements-confirmation.md，不把本轮技术投票用作未来补确认范围。

| 能力 | 已收敛设计 |
| --- | --- |
| Continue | 全局显式 continue C，本轮只处理自由探索；七项业务写命令承接项目及Run，其他查询读取仍为普通命令 |
| CommandState | 独立模型，id、commandGroup、groupId、status、parameters、state；Home级JSON ValueStore，分页反查，无索引 |
| 读取窗口 | lastArtifactId、reads；提交成功后尝试辅助CAS；异常允许遗漏／过期候选，不为辅助信息恢复业务或阻断提交 |
| 输出 | external add只返回两个ID；正文前200 chars预览；JSON合法；完整文件导出；非文本提供导出信息 |
| 成果根 | 成果由图推导，Run只存人工增删；report／redo不写Run；默认图从推导成果展开 |
| External图 | 最新、历史、交付按已确认投影规则显示；source预览及单栏完整内容详情，无新领域字段 |
| 图交互 | 空白或边上左键手抓，复用原生滚动；节点点击及历史浮窗行为保留；边及直接端点悬停高亮 |

不存在本轮新建Agent宿主、语法扩展、全局状态管理界面、索引或图编辑器的任务。

## 1. 实际代码依据与改动边界

| 现有位置 | 已确认行为 | 本轮适配 |
| --- | --- | --- |
| src/commands/context-control.ts | 区分新旧Run存储；直接report已可创建完整产物；仍有create、target、--for；读取输出正文；external add返回完整记录 | 复用业务分派，移除普通预建路径，接入辅助窗口及简短回执、受控预览 |
| src/context_control/service.ts | 每条记录CAS，Run短锁协调，多记录失败可由已有redo补Step；读取辅助归旧draft Step | 保留业务提交及redo；Step辅助reads按捕获快照尽力保存，不能引入窗口恢复身份 |
| src/cli.ts、src/commands/cli-errors.ts | Commander注册，项目通过preAction选择；部分命令JSON错误；help可早于action退出 | 新增显式Continue入口和对应JSON错误识别，确保动态help实际加载C及业务状态；复用参数定义与原业务处理器 |
| src/home.ts、src/config.ts | Home可独立解析，普通readConfig会先解析Project | 从Home先读C，再按其项目定位；不能要求调用者先在正确Workspace中 |
| src/data/extensions/filesystem-json-valuestore | 单记录锁、原子写、revision CAS；list仅分页ID | 直接复用，不扩展查询或事务接口 |
| reserved-models/context-control/manifest.json、src/context_control/model-assets.ts、src/project/context-control.ts | 五个自由探索模型单独加载，绑定Store后拒绝不兼容替换 | 保留该边界，增加受限的Run字段升级入口；不冒充顶层system_models升级 |
| reserved-models/manifest.json、src/reserved/models.ts | 当前顶层catalog管理system_models及market_packages | 为Home定义新增home_models资源区；CommandState不进入Project自动安装列表，Home直接加载同一Schema并编译Runtime |
| modules/org.memsphere.run/adapter/view/context-control.ts、styles.ts | Artifact历史投影、宽浮窗、原生滚动；尚未画External，SVG关闭命中 | 纳入External、受约束滚动区域、Pointer拖拽及边命中和高亮 |
| src/commands/view.ts、src/context_control/graph.ts | 新旧Run来源先判定；Artifact完整内容及下载；依赖闭包已识别External | 增加对应External内容适配，沿用来源判定、读取与SHA-256检查 |

## 2. CommandState 与 Home Store

模型ID为memsphere/command-state.json，Schema草案见同目录command-state.schema.json。实体用途及六字段保持不变；Run的成果根调整另见第3节：

```json
{
  "id": "context-001",
  "commandGroup": "run",
  "groupId": "run-001",
  "status": "active",
  "parameters": { "project": "memsphere" },
  "state": { "reads": {} }
}
```

status=active/closed表示命令状态进行中／已结束；真实业务状态仍从Run读取。groupId映射为--run，不重复存parameters.run。读取窗口已有成功报告时再出现lastArtifactId。

state是明确object，动态JSON子字段由run命令组校验；当前Runtime支持原样保存，但不提供动态字段反射。parameters是有类型的字符串map。无oneOf、跨模型引用或新的元模型。

定义通过现有内置模型资产发布；既有Project的模型安装／升级沿用已有机制，不自动改造所有项目。Home数据Store使用独立适配器、固定的本轮JSON Factory绑定及ValueStore接口，目录配置可示意为Home/data/command-states；不把路径写进模型。实例data_id=id，metadata的revision和时间不在模型再存。

Continue按id直接读取；run status按commandGroup=run、groupId和parameters.project分页筛选全部匹配记录，不以过滤后空页提前结束，不新增缓存或反向索引。多个记录时返回可识别列表；查询不分配新状态。未知C、缺失项目、类型不支持明确报错，不静默选别的Run。

启动先打开并校验Home Store及模型，再串行创建Run与初始CommandState；成功回执必须有contextId。若某一步实际已保存后出错，错误如实说明已生成的身份，保留数据，不建设跨Store事务或删除用户Run来掩盖失败。既有无C的Run只读查询照常返回空关联列表，完整原生命令继续可用。

### Home CommandState的唯一资源与装载

- 唯一Schema源：reserved-models/home-models/command-state.json；模型ID仍为memsphere/command-state.json。changes中的Schema仅为评审草案，实现时与源校验一致，不成为第二装载源。
- 在现有reserved-models/manifest.json增加home_models数组（条目为id、metaModel、source），扩展src/reserved/models.ts的同一catalog读取／路径校验，单独导出readBundledHomeModels。该区不参与readBundledSystemModels，因而不自动安装到Project，不进入Context Control的五实体manifest。
- 新增src/home/command-state-store.ts适配器：先按Home配置定位，再从catalog取唯一ID，用JsonSchemaModelRuntimeFactory及现有JSON Serializer／filesystem-json ValueStore Factory建立Store；不读取Project registry，也不持有独立硬编码Schema。data_id=id，目录为Home/data/command-states。
- 第一次状态写入时初始化Store，按ID查询不存在时明确NOT_FOUND；正常读取不创建虚构记录。资源损坏、重复ID、未知元模型或现有记录不满足当前Runtime时明确错误，保留原记录，不自动重置／删除／改绑。首版此前无CommandState记录，不设计未来任意模型迁移；兼容数据按当前Schema继续读取，不兼容升级应显式报错等待专用转换。
- package.json已有reserved-models目录随包发布；scripts/check-reserved-models.mjs增加Home资源Runtime和样例校验。新增test/command-state-store.test.mjs与test/command-state-cli.test.mjs覆盖临时Home、无Project依赖、多项目C、坏资源／坏记录、旧合法记录重开及打包后的源解析。Project系统模型数量和五个Context Control实体数量保持不变。

## 3. Continue 处理与生产动线

| 子操作 | 自动定位 | 显式业务输入 |
| --- | --- | --- |
| report | project来自parameters，Run来自groupId | 内容/文件、名称；依赖、标签、修订来源等 |
| review create | 同上 | 产物ID、reviewer来源、评论或文件（保留重复comment） |
| external add | 同上 | 来源和内容，或结构化文件 |
| artifact tag | 同上 | 产物ID、标签 |
| outputs update | 同上 | 可重复--add／--remove产物ID |
| finish | 同上 | 交付产物ID，可多份 |
| abandon | 同上 | 原有原因参数；必须Human明确决定 |

入口载入C、校验命令组及业务Run来源后调用同一套业务处理，不拼Shell、不递归启动CLI、不维护第二套产物服务。公共参数与C矛盾时明确拒绝，不能用Continue悄悄改绑。原生完整命令保留。

动态help只展示当前状态允许的上述操作及已承接、仍必填参数。已结束不提供继续生产；原生查询仍可用。不能因Commander提前处理--help而只打印静态菜单，或绕过C、Run与新旧存储来源检查。

普通artifact create、读取--for和自由探索report预建target路径退出；Schema与旧流程保持原路径。产物自动ID、Step完成、修订来源和真实dependencies沿用现有规则。修订省略依赖时继承旧产物，显式依赖替换完整集合；按tag解析固定为当次实际Artifact ID。

finish或abandon结束业务后尝试关闭相关命令状态，保留记录；实际Run已终止但关闭辅助写入失败时，仍按真实Run状态阻止新业务写入，不把已成功终止改判失败。不增加手动关闭、过期或重开命令。

### Run成果推导、人工调整与命令

Run不保存完整outputArtifactIds，只保存可省略的outputOverrides，内含addedArtifactIds与removedArtifactIds两个去重数组，两组互斥。未人工调整时省略。自动成果从完整submitted产物中排除被其他完整产物依赖或被revisedFrom替换的ID；实际成果＝（自动成果∪人工添加）－人工移除。只遍历本次Snapshot的完整记录；不把External、草稿或未完成Step作为根。

人工添加是显式保留，后续被依赖或修订仍保留，直到手动移除；人工移除只针对具体ID，新修订ID可自动出现。移除入口不删除依赖闭包中的节点。查询投影Snapshot.outputArtifactIds及View/API顶层outputArtifactIds只为兼容消费者提供计算结果，不进入Run Store或CommandState。空集合不回退全图。

outputs list保持普通查询，outputs update纳入Continue，支持重复--add／--remove、一次替换及幂等相同调整。先核对全部ID、同Run及加入项完整submitted，再短锁内一次CAS保存人工调整；同一ID的反向操作同时取消旧选择，重叠输入拒绝。finish显式确认根，在结束Run的同一次CAS中保存相对自动集合的差值；不存另一份最终列表。终态图与人工调整固定，成果可稳定重算。

普通report只校验保存Artifact并完成Step，redo只恢复原Step；两个路径都不修改Run、不清理人工调整。Run只在人工调整、finish／abandon等Run级操作中写入。已有短锁协调生命周期，但本次不增加Run写竞争，也不把新设计包装为已实现无锁并发执行。

### 提交中断后的读取与重试

status/show、list、outputs list、View Snapshot/API及Artifact读取等入口仍先在短Run锁中恢复未完成Step。只有Step完成且绑定Artifact一致的submitted产物才进入推导。持续故障明确RECOVERY_REQUIRED，附已保存artifactId／stepId及带项目的恢复命令；不成功输出无效图。故障解除后现有run status重做原Step。已完成记录不重放；人工移除不会因查询或后续report丢失。

report若已经保存Artifact，错误回执明确其稳定身份，先status恢复；原样重发report是新请求，可能再产生一个Artifact，不宣称请求去重或exactly-once。辅助读取窗口失败不影响核心提交。

### 在用模型及记录的受限升级

入口复用memsphere --project P project models initialize。只接受已知finalArtifactIds旧版、已落地outputArtifactIds版或目标定义；未知自定义模型、损坏记录及不支持的Factory明确失败。普通start不静默迁移。旧流程非模型Run不受影响。

Run旧定义SHA-256：7d0612cb7ece147e5475fba998cabd5fb35f6f58a315db4c8ac4014e247990a3、e8766633d676456f375c3bca66ab43d7ce02917d0d49ff3aafa193b9e201bc02；Artifact只改说明，支持对应两版已知定义。其余三模型、绑定、登记ID、data_id和历史Artifact／Review不变。

1. 复用Project settings锁及原有model-operation发布／恢复，正常Context Control与五个Store通用data操作共用同一门禁，固定Project→Run→ValueStore锁顺序。只协调短操作，不锁住Agent生产或评审。
2. 用旧Runtime验证原记录并先redo原Step。已存outputArtifactIds的运行保留原根；若旧report尚未完成Step，在redo前捕获原提交身份，再在内存补齐旧自动成果变换，避免把中断遗漏当成人工隐藏；不为此回写旧Run。更早finalArtifactIds版的终态保留原最终根，运行中从完整图取自动根。以原根对比自动根，只保存必要人工增删差值；没有差值可省略outputOverrides。删除旧完整根字段，保留envelope元数据、ID，迁移记录revision只增加一次。
3. 所有转换先用候选Runtime校验，再通过原commitModelOperation备份before／after及哈希并原子发布文件。专用operation仅允许配置中已核验的Run业务目录与对应模型文件，不开放任意业务文件。多记录编排不宣称Store多记录CAS。
4. 中断按原操作日志回滚，原命令可redo；未知外部改动保留并报冲突。已成功转换重复initialize无改动，不覆盖人工选择，不增加第二套迁移日志或后台修复机制。

验证覆盖两类旧Schema、终态／运行态、人工旧版根与空集合、发布中断回滚及重试、升级与report／通用data操作互斥。额外断言正常report、并行生产、修订和读侧redo前后Run envelope／revision完全一致，避免再次把自动成果维护引入Run生命周期。

## 4. 辅助读取窗口

state只包含可选lastArtifactId及reads map；键为artifact:ID或external:ID，值保留真实readAt。首次没有lastArtifactId。普通读取按明确项目及Run查找唯一active C时可辅助记账，零条／多条时跳过；不得猜测Runner、恢复--for或要求补读。

report前捕获窗口和revision；业务提交仍由现有流程完成。真实读取可尽力归入Step.reads，上一份产物只加入候选，不伪造读取。正常路径对比真实dependencies，有未覆盖候选必给非阻断提醒。

成功后尝试一次CAS同时更新lastArtifactId并清空reads；业务失败不结转。CAS冲突或辅助保存失败保留现有数据，不重新读取后强制清空、不拒绝下一次正常提交、不重跑已成功业务。异常允许遗漏或过期候选，业务依赖正确性不受影响。普通读取正文和输出成功不依赖记账成功。

不预留产物ID，不新增窗口模型、提交日志、请求重放协议或窗口专用跨记录锁。已有业务CAS／Run锁／redo职责不变。该取舍是Human明确选择的轻量方案。

## 5. 输出契约

external add在CLI回执层仅保留runId、externalId，Store保留完整材料。

Artifact／External正文≤200 chars完整显示，超出取前200个Unicode码点再追加...；按chars而非bytes，英文字母、汉字各算一个，标点和空格也计入。文本stdout为正文，截断及完整导出提示放stderr。JSON沿用runId、id、contentType，content为字符串，增加truncated；需要导出时提供带实际项目、Run、材料ID的exportCommand，不在JSON后追加文本。

--out写完整原始字节，继续独占创建，已有文件不可覆盖，不混入提示。非文本材料显示类型及下载／导出信息，不打印二进制。网页完整内容不受CLI阈值影响。本轮不增加阈值配置、自动摘要或分段读取协议。

## 6. 图展示与交互

默认Artifact图统一从Snapshot.outputArtifactIds（推导成果）求实际依赖闭包，不再展示所有产物族最新版的并集，也不额外拼回全部草稿。空集合不回退全图；运行中可单独显示从未引用的新External。进入和刷新直接展示当前成果，历史版本保持原上下游投影及浮窗规则；退出历史恢复当前成果，按钮为“回到当前成果”／“回到交付视图”。不增加聚焦按钮或持久化前端选择。

运行最新图=当前可见产物引用的External＋未被任何完整产物引用的新资料；历史／交付图只取当前可见产物实际引用。历史独占资料随历史分支收起。只有External也正常绘图，共享资料只一个节点，边方向为External→依赖它的Artifact。节点身份用kind+id区分。

External节点用现有Badge标识外部资料及source预览，ID在详情；复用宽浮窗单栏展示完整来源和内容，无评审／版本控件。Artifact既有名称、标签、历史选择及浮窗翻页保持原行为，不新建模块或修改External模型。

画布在页面可用区域内有明确滚动范围，复用scrollLeft/scrollTop。空白或边上左键拖拽，节点及交互控件不开始画布拖拽；Pointer捕获处理移出后释放、取消、失焦及销毁清理。滚轮、触控板、滚动条保留，无缩放或节点布局编辑。

边增加合适命中区域，悬停时高亮边和直接端点。移出仅移除该次悬停状态，与节点焦点／悬停／选中叠加，避免一律清除class。使用既有View Token与组件，不修改公共Shell。

## 7. 开发任务及验证

| 顺序 | 工作包 | 验证重点 |
| --- | --- | --- |
| 1 | 内置模型、Home Store与命令状态服务 | Schema和原始JSON往返、ID读取、分页反查跨空匹配页、跨项目及多C隔离、CAS冲突 |
| 2 | Continue及生产动线 | 跨独立进程显式C，未绑定Workspace仍可定位；动态help、关闭状态、未知命令／参数、项目冲突；旧Run拒绝新入口而旧命令不变 |
| 3 | 两字段窗口与简短回执 | 直接report→评论→修订；读记账归属失败及CAS冲突不影响正文／业务；正常候选提醒、失败report不更新；external add不泄露正文 |
| 4 | 200 chars预览及完整导出 | 199/200/201、中英文、代理对、换行；单一可解析JSON、stderr分离、文件原始字节、已有文件保护、非文本 |
| 5 | 成果根、External图、内容及历史 | 首次report、依赖串行及并行、修订替换、手动移出及清空、redo不恢复手动移出、既有记录转换、仅External、共享引用、当前／历史／交付投影、完整内容及SHA-256、单栏详情、原Artifact浮窗与窄屏 |
| 6 | 拖拽及边高亮 | 双向拖动、移出释放、取消／失焦、控件点击、历史重渲染、选中叠加及视图清理 |
| 7 | 文档、System Memory与Skill同步 | 实际命令帮助和示例一致，Reserved及安装副本一致，最终ChangeSet校验 |

### 部分写入故障的验证契约

通过临时Home／Store上的定点故障注入验证，不对真实业务数据注入故障，也不新增故障恢复协议。

| 故障位置 | 可观察断言 |
| --- | --- |
| Run已创建，CommandState创建失败 | text及JSON错误明确包含已保存runId；没有实际保存的C时不返回可用contextId。按runId可查询原Run；status不自动补建。重试不会删除原Run或将其静默绑到另一C；再次start属于新的显式创建请求，失败回执应让调用者可区分原Run |
| finish／abandon已保存，关闭CommandState失败 | 原命令仍报告真实业务终态并携带辅助关闭警告；text警告与成功结果分开，JSON仍是单一合法对象。残留active C的help及后续写操作均依据Run终态，不能继续生产；查询和历史仍可用 |
| 普通report或redo | Run Store update若被注入失败也不影响生产，因为该路径不得尝试写Run；持久化envelope及revision必须保持不变 |
| Artifact已保存，Step完成写失败 | status、outputs list、View先redo原Step再推导；持续故障明确RECOVERY_REQUIRED；整个report及redo不更新Run，人工调整不丢失 |

另外验证部分report失败后的三条相邻路径：原命令原样重试生成两份明确不同的Artifact（不承诺去重）；改执行另一写命令先恢复旧提交；进程重启后run status只恢复原身份。分别断言Artifact、Step、outputs数量及ID。上述断言同时覆盖文本与JSON路径；CAS冲突保留已有记录，不强行覆盖、不删除已提交业务。没有本次实际写入成功的身份不能虚构在回执里。

在test/context-control-cli、context-control、context-control-graph、context-control-view和view-browser现有套件中按用户契约更新；新增CommandState模块／CLI覆盖。测试构造使用临时Home和Store，不访问真实业务数据；时间与重渲染等待事件／状态，不用固定sleep代替断言。

当前已进入实现修订，不能把先前Schema草案验证或历史全量测试当作本轮实现验收。完成定向测试后执行npm run typecheck、npm test、npm run build、memsphere validate；涉及Memory时最终执行memsphere memory change validate并记录匹配的ChangeSet与View。前端用已获授权的playwright-cli在真实Run页面进行桌面／窄屏、点击、拖动、历史、键盘和console验收，保留证据。

## 8. 规范、兼容与交付

| 适用Statement完整引用 | 本方案采用项 |
| --- | --- |
| statements/memsphere-repository-requirement-rules | 保留已确认范围与兼容性要求，明确排除ACP，outputs增补与验收逐项对应 |
| statements/memsphere-repository-development-rules | 调查实际模块、复用现有模型操作及CAS、保持CLI／View／Skill／Memory一致，不引入通用迁移框架 |
| statements/memsphere-repository-testing-rules | 用户契约及失败边界、临时Store并发／故障注入、typecheck／test／build／validate、真实Playwright交互，区分设计校验与实现证据 |
| statements/memsphere-repository-delivery-rules | 保留历史、归档变更、交付摘要与适用CI证据，按流程等待Human合入；Memory差异必须有最终ChangeSet验证 |

避免过度设计，正常故障清楚暴露；不新增YAML syntax关键字。

用户可见改动同步reserved-memory来源、当前Project安装副本及src/skills/memsphere/SKILL.md，按原规范检查Procedure／Schema／Artifact／Framework等相关记忆，只改实际涉及的语义；没有Memory差异时不建空ChangeSet。模型资产更新通过已有清单检查，不绕过runtime验证。

旧流程、Schema、正式Review、ChangeSet行为及历史数据保留。既有无CommandState记录不自动迁移；取消未发布预建目标接口，不删除原数据。当前Project草稿核查为0，无额外迁移工作。CLI错误保持文本／JSON既有规范，未知或损坏存储不静默降级为另一Run来源。

正式流程：本方案和修订契约整体核对后，研发／架构／测试Agent及Human架构师评审；通过后再形成开发计划并实施。需求范围调整已按requirements-confirmation.md记录Human明确确认；本次Human同时担任产品负责人和架构师。原flow[1]历史、独立修订需求及本轮修改票共同提供当前需求依据；本轮审查实施方案是否符合该基线，不再把技术投票当作尚待取得的需求授权。单项讨论记录不冒充新正式投票。

不修改无关docs/procedure-graph-syntax.md，不提前合入代码、发布或创建PR。后续交付步骤沿当前敏捷Procedure及用户明确指示执行。

## 9. 本轮需求确认依据

Human最新明确确认：“好，就按照这个方案来，只记录人工增删，outputs通过推导得到。把模型、方案和实现都同步调整一下。主要我觉得每次上报artifact都去修改run，又变成有生命周期的并行冲突了。”本次据此替换此前完整outputs存储设计；第10节旧票证据仅作历史保留。


本记录整理已经发生的明确指示，不代填新的需求通过票，也不修改已接受的flow[1]历史快照。

当前基线为原flow[1]需求契约，加上Human在技术共创中已确认的范围修订。完整合并文本为requirements-revised.md，独立冻结产物为artifact-fa0200e6-1cfd-4067-ba2d-09296c1e46b9，先于本轮实施方案重报产生。

| 修订 | 已有Human确认 | 结果 |
| --- | --- | --- |
| ACP范围 | Human提出“ACP 暂时只是评审，那是不是这整件事情都不用管了呢？”；在收敛本轮不接ACP及环境默认ID后明确回复“好” | 本轮仅显式前文ID，不建设ACP／Runner启动宿主；替代旧契约F1／AC2中该部分 |
| 辅助窗口简化 | Human明确“好，就按这个简化方案来，把方案和模型说明同步改一下，然后我们看下一个技术决策。” | lastArtifactId、reads尽力保存，不以辅助窗口恢复业务，不预留提交身份 |
| 成果根增补 | Human明确“好，就按照这个方案来，把 outputs 的维护规则、命令和前端展示逻辑同步到方案里，Run 模型也一起调整一下。” | 采纳F10／AC15的增量outputs、手动命令及默认成果图 |
| 当前正式修改票 | Human明确“好，把这些调整整理成修改意见，我投修改，重新发起一轮 review。”；已在正式Review第1轮提交request_changes及4条意见 | 本轮依据已确认修订重报技术方案，等待新的技术审查，不将本条解释为技术方案通过 |

Procedure要求“当前迭代范围变化时，必须先更新需求契约并取得human确认”，未规定必须重放已结束Action或重新走一轮产品投票。本轮保留原历史，通过独立修订需求产物、已有明确Human确认及本正式修改票对齐当前范围，再提交新技术方案。前一版材料把范围确认写成“待随本轮核对”，混淆了已确认范围与尚未通过的技术方案；该不清楚的表述由本记录更正。

追溯：正式Run run-20261025-035719z-bcc49b1e；技术共创Run run-67ed4607-6fc0-4310-ba4b-8a9e0b201de0；ACP讨论保留在Review review-4219c402-2d12-45e9-b2b0-2be8a27f3f51，outputs确认保留在Review review-799f7cd7-de0d-4a67-b5ae-a1c9d91bc5b1。上述Review含Runner整理说明，Human原始表述以上表和本对话为准。正式第1轮review-20261025-071413z-204b2652／round-20261025-071413z-dfe84b49的原材料、票和意见均保留。

## 10. 既有轮次的Human原始证据（历史）

以下冻结副本保留原文，不代表当前outputs存储设计；现行规则以第3节及requirements-confirmation.md的后续明确确认记载为准。

以下材料随正式第3轮完整冻结，Reviewer无需访问另一个Run：

- 第1轮Human的request_changes原始Assignment（含4条outputs意见、委托授权说明及提交时间）；
- 第2轮Human对含完整修订需求附录的提交投approve原始Assignment、Round／Submission ID和摘要；该技术轮Runner要求修改不抹去Human已表达的范围取舍；
- 本对话中ACP收敛、轻量窗口及outputs确认的逐字片段，明确标为对话转录，无伪造消息ID或新投票。

本轮只是按已确认需求修补技术方案，等待新的独立审查；原flow[1]及各轮票均保留。

### 原始证据冻结副本

来源：当前用户对话逐字摘录；不伪造消息ID、时间戳或系统认证导出。

Human：“ACP 暂时只是评审，那是不是这整件事情都不用管了呢？”
Human随后确认：“好”。

Human：“好，就按这个简化方案来，把方案和模型说明同步改一下，然后我们看下一个技术决策。”

Human：“好，就按照这个方案来，把 outputs 的维护规则、命令和前端展示逻辑同步到方案里，Run 模型也一起调整一下。”

Human：“好，把这些调整整理成修改意见，我投修改，重新发起一轮 review。”

Human对第2轮指定方案投票：“通过”。正式受托提交原始记录见下。

<details>
<summary>当前正式Run的Human提交原始JSON</summary>

```json
{
  "runId": "run-20261025-035719z-bcc49b1e",
  "reviewId": "review-20261025-071413z-204b2652",
  "description": "从当前正式Run保存的Review读取的原始Human Assignment及Submission元数据；未修改Vote、Comment或授权内容。",
  "rounds": [
    {
      "id": "round-20261025-071413z-dfe84b49",
      "sequence": 1,
      "status": "changes_requested",
      "submission": {
        "id": "submission-20261025-071413z-7f5e07dd",
        "digest": "sha256:207efb0310b47d083ce8abae20e8a1558ebd2dabaaaa908b4c93eb0b25b83433",
        "createdAt": "2026-10-25T07:14:13.483Z",
        "artifact": {
          "name": "实施与验证方案",
          "type": "string",
          "format": {
            "name": "markdown",
            "options": {}
          },
          "validation": {
            "status": "passed",
            "correctable": false,
            "issues": []
          },
          "storage": "file",
          "path": "run-20261025-035719z-bcc49b1e/artifacts/reviews/review-20261025-071413z-204b2652/submission-20261025-071413z-7f5e07dd/artifact.md",
          "fileName": "artifact.md",
          "contentType": "text/markdown",
          "authorization": {
            "allowed": true,
            "permission": "artifact.submit",
            "subject": {
              "kind": "runner"
            },
            "artifactScope": "memsphere-agile-requirement-development#flow[2]",
            "revision": "sha256:043d8a4383c7492e5cbaf3a2135793c21f1635ba35a570435727c01e2e69d8d6",
            "actorId": "runner",
            "authoritySource": "config:control_plane.runner",
            "basePermissions": [
              "artifact.read",
              "artifact.submit",
              "artifact.write",
              "decision.assess",
              "decision.decide"
            ],
            "grantedPermissions": [],
            "effectivePermissions": [
              "artifact.read",
              "artifact.submit",
              "artifact.write",
              "decision.assess",
              "decision.decide"
            ],
            "reason": "allowed"
          }
        },
        "contextArtifacts": [
          {
            "stepId": "flow[1]",
            "artifact": {
              "name": "当前迭代需求契约",
              "type": "string",
              "format": {
                "name": "markdown",
                "options": {}
              },
              "validation": {
                "status": "passed",
                "correctable": false,
                "issues": []
              },
              "storage": "file",
              "path": "run-20261025-035719z-bcc49b1e/artifacts/reviews/review-20261025-071413z-204b2652/submission-20261025-071413z-7f5e07dd/context/001-artifact.md",
              "fileName": "001-artifact.md",
              "contentType": "text/markdown",
              "authorization": {
                "allowed": true,
                "permission": "artifact.submit",
                "subject": {
                  "kind": "runner"
                },
                "artifactScope": "memsphere-agile-requirement-development#flow[1]",
                "revision": "sha256:043d8a4383c7492e5cbaf3a2135793c21f1635ba35a570435727c01e2e69d8d6",
                "actorId": "runner",
                "authoritySource": "config:control_plane.runner",
                "basePermissions": [
                  "artifact.read",
                  "artifact.submit",
                  "artifact.write",
                  "decision.assess",
                  "decision.decide"
                ],
                "grantedPermissions": [],
                "effectivePermissions": [
                  "artifact.read",
                  "artifact.submit",
                  "artifact.write",
                  "decision.assess",
                  "decision.decide"
                ],
                "reason": "allowed"
              }
            }
          }
        ]
      },
      "humanAssignments": [
        {
          "id": "assignment-20261025-071413z-9351cf6e",
          "actorId": "actor5",
          "actorName": "billtenor",
          "actorKind": "human",
          "slotIds": [
            "memsphere-agile-requirement-development::架构师"
          ],
          "permissions": [
            "artifact.read",
            "artifact.submit",
            "artifact.write",
            "decision.assess",
            "decision.decide"
          ],
          "binding": "decision",
          "status": "submitted",
          "draft": {
            "comments": [
              {
                "id": "comment-20261025-075133z-d4d38ff0",
                "body": "Run 用 outputArtifactIds 统一记录当前成果及最终交付根，替换 finalArtifactIds；同步字段说明、示例和引用约束。",
                "severity": "blocking",
                "createdAt": "2026-10-25T07:51:33.096Z",
                "updatedAt": "2026-10-25T07:51:33.096Z"
              },
              {
                "id": "comment-20261025-075133z-19fe2a37",
                "body": "成功 report 后增量维护 outputs：移出实际依赖的 Artifact 和 revisedFrom 旧版，再加入尚未被依赖的新产物。手动移出的产物不能因后续全图重算被恢复；不需要 report --output。",
                "severity": "blocking",
                "createdAt": "2026-10-25T07:51:33.096Z",
                "updatedAt": "2026-10-25T07:51:33.096Z"
              },
              {
                "id": "comment-20261025-075133z-03a4fc3e",
                "body": "增加 outputs list 查看成果；outputs update 支持重复 --add／--remove，并可一次完成替换。更新操作承接 Continue 公共参数，list 保持普通查询。",
                "severity": "blocking",
                "createdAt": "2026-10-25T07:51:33.096Z",
                "updatedAt": "2026-10-25T07:51:33.096Z"
              },
              {
                "id": "comment-20261025-075133z-d335f4f5",
                "body": "前端默认直接展示 outputArtifactIds 的依赖闭包；中间无关产物默认隐藏，空集合不回退全图。历史选择及浮窗翻页保留，无需增加聚焦按钮，也无需通过历史菜单重选最新版才能看到主干。",
                "severity": "blocking",
                "createdAt": "2026-10-25T07:51:33.096Z",
                "updatedAt": "2026-10-25T07:51:33.096Z"
              }
            ],
            "vote": "request_changes",
            "updatedAt": "2026-10-25T07:51:33.096Z"
          },
          "submitted": {
            "comments": [
              {
                "id": "comment-20261025-075133z-d4d38ff0",
                "body": "Run 用 outputArtifactIds 统一记录当前成果及最终交付根，替换 finalArtifactIds；同步字段说明、示例和引用约束。",
                "severity": "blocking",
                "createdAt": "2026-10-25T07:51:33.096Z",
                "updatedAt": "2026-10-25T07:51:33.096Z"
              },
              {
                "id": "comment-20261025-075133z-19fe2a37",
                "body": "成功 report 后增量维护 outputs：移出实际依赖的 Artifact 和 revisedFrom 旧版，再加入尚未被依赖的新产物。手动移出的产物不能因后续全图重算被恢复；不需要 report --output。",
                "severity": "blocking",
                "createdAt": "2026-10-25T07:51:33.096Z",
                "updatedAt": "2026-10-25T07:51:33.096Z"
              },
              {
                "id": "comment-20261025-075133z-03a4fc3e",
                "body": "增加 outputs list 查看成果；outputs update 支持重复 --add／--remove，并可一次完成替换。更新操作承接 Continue 公共参数，list 保持普通查询。",
                "severity": "blocking",
                "createdAt": "2026-10-25T07:51:33.096Z",
                "updatedAt": "2026-10-25T07:51:33.096Z"
              },
              {
                "id": "comment-20261025-075133z-d335f4f5",
                "body": "前端默认直接展示 outputArtifactIds 的依赖闭包；中间无关产物默认隐藏，空集合不回退全图。历史选择及浮窗翻页保留，无需增加聚焦按钮，也无需通过历史菜单重选最新版才能看到主干。",
                "severity": "blocking",
                "createdAt": "2026-10-25T07:51:33.096Z",
                "updatedAt": "2026-10-25T07:51:33.096Z"
              }
            ],
            "vote": "request_changes",
            "summary": "要求修改：将已确认的 outputs 增量维护、管理命令、默认成果依赖图及 Run.outputArtifactIds 模型调整纳入本轮方案，修订后发起新一轮评审。",
            "submittedAt": "2026-10-25T07:51:33.096Z",
            "authorization": {
              "allowed": true,
              "permission": "decision.decide",
              "subject": {
                "kind": "actor",
                "actorId": "actor5"
              },
              "artifactScope": "memsphere-agile-requirement-development#flow[2]",
              "revision": "sha256:043d8a4383c7492e5cbaf3a2135793c21f1635ba35a570435727c01e2e69d8d6",
              "actorId": "actor5",
              "authoritySource": "config:control_plane.actors.actor5",
              "basePermissions": [
                "artifact.read",
                "artifact.submit",
                "artifact.write",
                "decision.assess",
                "decision.decide"
              ],
              "grantedPermissions": [],
              "effectivePermissions": [
                "artifact.read",
                "artifact.submit",
                "artifact.write",
                "decision.assess",
                "decision.decide"
              ],
              "reason": "allowed"
            },
            "delegation": {
              "kind": "runner",
              "runId": "run-20261025-035719z-bcc49b1e",
              "humanActorId": "actor5",
              "authorizationNote": "用户在当前对话明确指示：“好，把这些调整整理成修改意见，我投修改，重新发起一轮 review。”目标为当前敏捷 Run run-20261025-035719z-bcc49b1e 的实施与验证方案 Review review-20261025-071413z-204b2652，第1轮 round-20261025-071413z-dfe84b49。用户已连续确认 outputs 自动维护、手动命令、默认图展示及 Run 模型调整；以上四条是该已确认方案的整理。此次指示同时构成 request_changes 正式票和 Runner 代提交授权。",
              "authorization": {
                "allowed": true,
                "permission": "decision.decide",
                "subject": {
                  "kind": "runner"
                },
                "artifactScope": "memsphere-agile-requirement-development#flow[2]",
                "revision": "sha256:043d8a4383c7492e5cbaf3a2135793c21f1635ba35a570435727c01e2e69d8d6",
                "actorId": "runner",
                "authoritySource": "config:control_plane.runner",
                "basePermissions": [
                  "artifact.read",
                  "artifact.submit",
                  "artifact.write",
                  "decision.assess",
                  "decision.decide"
                ],
                "grantedPermissions": [],
                "effectivePermissions": [
                  "artifact.read",
                  "artifact.submit",
                  "artifact.write",
                  "decision.assess",
                  "decision.decide"
                ],
                "reason": "allowed"
              }
            }
          },
          "attempts": []
        }
      ]
    },
    {
      "id": "round-20261025-075317z-16ce67ac",
      "sequence": 2,
      "status": "changes_requested",
      "submission": {
        "id": "submission-20261025-075317z-5f3af074",
        "digest": "sha256:762ecc0ebd14095693bc04afbef76670f4c1fba047524422fb5ec69cb3dae266",
        "createdAt": "2026-10-25T07:53:17.913Z",
        "artifact": {
          "name": "实施与验证方案",
          "type": "string",
          "format": {
            "name": "markdown",
            "options": {}
          },
          "validation": {
            "status": "passed",
            "correctable": false,
            "issues": []
          },
          "storage": "file",
          "path": "run-20261025-035719z-bcc49b1e/artifacts/reviews/review-20261025-071413z-204b2652/submission-20261025-075317z-5f3af074/artifact.md",
          "fileName": "artifact.md",
          "contentType": "text/markdown",
          "authorization": {
            "allowed": true,
            "permission": "artifact.submit",
            "subject": {
              "kind": "runner"
            },
            "artifactScope": "memsphere-agile-requirement-development#flow[2]",
            "revision": "sha256:043d8a4383c7492e5cbaf3a2135793c21f1635ba35a570435727c01e2e69d8d6",
            "actorId": "runner",
            "authoritySource": "config:control_plane.runner",
            "basePermissions": [
              "artifact.read",
              "artifact.submit",
              "artifact.write",
              "decision.assess",
              "decision.decide"
            ],
            "grantedPermissions": [],
            "effectivePermissions": [
              "artifact.read",
              "artifact.submit",
              "artifact.write",
              "decision.assess",
              "decision.decide"
            ],
            "reason": "allowed"
          }
        },
        "contextArtifacts": [
          {
            "stepId": "flow[1]",
            "artifact": {
              "name": "当前迭代需求契约",
              "type": "string",
              "format": {
                "name": "markdown",
                "options": {}
              },
              "validation": {
                "status": "passed",
                "correctable": false,
                "issues": []
              },
              "storage": "file",
              "path": "run-20261025-035719z-bcc49b1e/artifacts/reviews/review-20261025-071413z-204b2652/submission-20261025-075317z-5f3af074/context/001-artifact.md",
              "fileName": "001-artifact.md",
              "contentType": "text/markdown",
              "authorization": {
                "allowed": true,
                "permission": "artifact.submit",
                "subject": {
                  "kind": "runner"
                },
                "artifactScope": "memsphere-agile-requirement-development#flow[1]",
                "revision": "sha256:043d8a4383c7492e5cbaf3a2135793c21f1635ba35a570435727c01e2e69d8d6",
                "actorId": "runner",
                "authoritySource": "config:control_plane.runner",
                "basePermissions": [
                  "artifact.read",
                  "artifact.submit",
                  "artifact.write",
                  "decision.assess",
                  "decision.decide"
                ],
                "grantedPermissions": [],
                "effectivePermissions": [
                  "artifact.read",
                  "artifact.submit",
                  "artifact.write",
                  "decision.assess",
                  "decision.decide"
                ],
                "reason": "allowed"
              }
            }
          }
        ],
        "revisionSummary": {
          "body": "# 实施与验证方案第1轮修改记录\n\n## Human修改意见（已正式提交）\n\n1. Run.outputArtifactIds统一当前成果和最终根，替换finalArtifactIds，同步说明与示例。\n2. 成功report增量移出实际Artifact依赖及revisedFrom旧版，再加入新产物；手动移出不因全图重算恢复。\n3. outputs list查询，outputs update支持重复--add／--remove和一次替换；只有update接入Continue。\n4. 默认图从成果根展开，空集合不回退全图，保留历史及浮窗行为，无需另加聚焦按钮。\n\n## Agent意见与处理\n\n- 研发、架构、测试提出当前需求基线及范围确认记录不清楚：采纳澄清要求。独立修订需求已先行冻结，补充已有Human明确确认来源，保留原flow[1]和正式票；不将本轮技术投票解释为未来补取需求授权。Procedure未要求重放已结束Action，因此不另造需求通过票。\n- 测试指出跨Store部分写入验证不具体：采纳。在实施方案新增启动、终止、outputs／Step写入中断的故障点和text／JSON／查询／redo断言。\n\n## 已完成与未完成\n\n仓库Run模型定义、字段说明及示例已调整并通过Runtime校验；真实Store及页面未切换，随实施适配。新一轮提交覆盖本记录和完整修订需求；不把设计阶段校验写成实现验收。",
          "digest": "sha256:4f93cd7d103c86fc3e6667e8fd4cd2b9ae83326c2e994b9a48c5f55c28ebf535",
          "createdAt": "2026-10-25T07:53:17.913Z",
          "previousSubmissionId": "submission-20261025-071413z-7f5e07dd"
        }
      },
      "humanAssignments": [
        {
          "id": "assignment-20261025-075317z-c00118e4",
          "actorId": "actor5",
          "actorName": "billtenor",
          "actorKind": "human",
          "slotIds": [
            "memsphere-agile-requirement-development::架构师"
          ],
          "permissions": [
            "artifact.read",
            "artifact.submit",
            "artifact.write",
            "decision.assess",
            "decision.decide"
          ],
          "binding": "decision",
          "status": "submitted",
          "draft": {
            "comments": [],
            "vote": "approve",
            "updatedAt": "2026-10-25T07:59:00.429Z"
          },
          "submitted": {
            "comments": [],
            "vote": "approve",
            "submittedAt": "2026-10-25T07:59:00.429Z",
            "authorization": {
              "allowed": true,
              "permission": "decision.decide",
              "subject": {
                "kind": "actor",
                "actorId": "actor5"
              },
              "artifactScope": "memsphere-agile-requirement-development#flow[2]",
              "revision": "sha256:043d8a4383c7492e5cbaf3a2135793c21f1635ba35a570435727c01e2e69d8d6",
              "actorId": "actor5",
              "authoritySource": "config:control_plane.actors.actor5",
              "basePermissions": [
                "artifact.read",
                "artifact.submit",
                "artifact.write",
                "decision.assess",
                "decision.decide"
              ],
              "grantedPermissions": [],
              "effectivePermissions": [
                "artifact.read",
                "artifact.submit",
                "artifact.write",
                "decision.assess",
                "decision.decide"
              ],
              "reason": "allowed"
            },
            "delegation": {
              "kind": "runner",
              "runId": "run-20261025-035719z-bcc49b1e",
              "humanActorId": "actor5",
              "authorizationNote": "用户通过request_user_input_async明确回复“通过”，该问题唯一定位实施与验证方案第2轮：Run run-20261025-035719z-bcc49b1e，Review review-20261025-071413z-204b2652，Round round-20261025-075317z-16ce67ac。该回复为Human架构师本轮approve决定及Runner代提交授权。",
              "authorization": {
                "allowed": true,
                "permission": "decision.decide",
                "subject": {
                  "kind": "runner"
                },
                "artifactScope": "memsphere-agile-requirement-development#flow[2]",
                "revision": "sha256:043d8a4383c7492e5cbaf3a2135793c21f1635ba35a570435727c01e2e69d8d6",
                "actorId": "runner",
                "authoritySource": "config:control_plane.runner",
                "basePermissions": [
                  "artifact.read",
                  "artifact.submit",
                  "artifact.write",
                  "decision.assess",
                  "decision.decide"
                ],
                "grantedPermissions": [],
                "effectivePermissions": [
                  "artifact.read",
                  "artifact.submit",
                  "artifact.write",
                  "decision.assess",
                  "decision.decide"
                ],
                "reason": "allowed"
              }
            }
          },
          "attempts": []
        }
      ]
    }
  ]
}
```

</details>
