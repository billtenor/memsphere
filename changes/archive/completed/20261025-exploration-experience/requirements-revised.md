# 自由探索体验优化：修订需求契约

基线：73c60253b0949e10cd166538fb37c20b8095faeb。原需求契约及其第2轮通过记录保留；本版汇总技术共创中 Human 确认的范围收敛，随实施与验证方案提交整体复核。

## 目标与范围

减少自由探索 CLI 的重复参数、多余操作及长正文回显，改善现有 Run 依赖图。Continue 是全局入口，本轮仅支持自由探索；旧流程 Run、Schema、正式 Review 和 ChangeSet 保持现有方式。

| 编号 | 当前迭代要求 |
| --- | --- |
| F1 | run start 自动建立 CommandState 并返回前文 ID；使用显式 continue C 承接公共定位。run status 找回已有记录，不重新创建。不建设 ACP 接入、环境默认 ID、Runner 启动或自动分配 |
| F2 | continue C --help 根据真实业务状态显示可执行操作、承接信息及必填参数。支持 report、review create、external add、artifact tag、outputs update、finish、abandon；查询与读取保持普通命令 |
| F3 | 普通自由探索取消 artifact create、report 的预建目标路径及读取 --for；完整成果直接 report，系统关联 Step；保留轻量评审、不可变修订和基于旧成果重走 |
| F4 | state 只保存 lastArtifactId、reads，正常路径比较已记录读取及上一份产物与实际依赖；有未覆盖候选必须非阻断提醒，无候选不制造提醒。无法可靠识别或辅助保存异常时允许遗漏／过期候选，不阻断业务，不强制补读或自动加边 |
| F5 | external add 成功回执只含 runId、externalId，文本及 JSON 信息一致 |
| F6 | Artifact、External 读取正文超过200 chars 时取前200个字符并追加 ...，给完整导出命令；按字符而非 bytes 计数。JSON 回执合法且正文与提示分开；--out 完整导出原始字节 |
| F7 | External 纳入现有依赖图：最新图显示当前产物所依赖的资料及未被任何完整产物引用的新资料；历史和交付视图按实际可见产物引用显示。节点用现有 Badge 和 source 预览，ID在详情；单栏浮窗展示完整来源及内容，不新增 Review 或领域字段 |
| F8 | 在画布空白或边上按住左键手抓平移，支持横纵方向；松开／取消／失焦时停止；节点、按钮、历史及浮窗操作保持原行为，滚轮和滚动条仍可用 |
| F9 | 边悬停高亮该边及全部直接端点，使用已有风格，离开时保留其他有效选中、悬停和焦点状态 |
| F10 | outputs从完整submitted产物及依赖、修订关系推导，Run只记录人工添加／移除；普通report和redo不写Run。outputs list／update支持重复--add／--remove；人工保留优先于自动推导，隐藏具体ID不被刷新恢复，新修订ID可自动出现。默认图为推导成果的依赖闭包，空集合不回退；历史及浮窗保留 |

CommandState 模型为 memsphere/command-state.json，包含 id、commandGroup、groupId、status、parameters、state。commandGroup=run；groupId=Run ID；parameters 本轮保存 project。status 区分进行中／已结束，方案取 active／closed。实例使用 Home 级 JSON ValueStore，以 id 为 data_id；业务关联反查采用分页筛选，首版不加索引。

## 验收标准

| 编号 | 用户可观察结果 |
| --- | --- |
| AC1 | 成功新建自由探索 Run 自动获得可用 contextId 和 continue C --help 提示，无需预建产物或手动 Session；连续执行沿用同一 ID |
| AC2 | 不同独立 Shell 可通过显式 C 延续；本轮不接受将 ACP、环境默认值或 Runner 启动器列为已交付能力 |
| AC3 | 同 Run 的不同 CommandState 的参数及辅助状态隔离；数据能力支持多记录，不要求新增分配或启动动线 |
| AC4 | Continue 帮助与实际可用业务操作一致；不误入旧流程或 ChangeSet，参数冲突和未知对象明确报错 |
| AC5 | 直接 report→轻量 Review→修订 report 可完成；旧成果保留，依赖可继承或显式完整替换，修订不自动改绑下游 |
| AC6 | 材料可按实际需要读或直接声明依赖；无 --for；识别或记账失败不使正文读取失败，辅助失败不改判已成功提交 |
| AC7 | 正常辅助路径有未覆盖候选必提醒，无候选无提醒；业务 report 失败不尝试结转。辅助 CAS 冲突不强行覆盖，异常可留下不完整辅助信息；真实依赖不被改写 |
| AC8 | external add 两种输出仅包含两个 ID；正文仍可通过普通读取获取 |
| AC9 | 覆盖199、200、201 chars及中英文混合：超过阈值只预览前200字符；JSON始终单一合法对象；导出与原始字节一致且不混入提示 |
| AC10 | 只有 External 时图可见；共享资料只有一个节点；历史／交付投影中的资料与真实依赖一致；点击可看完整内容，网页不受200 chars限制 |
| AC11 | 大图可双向拖拽；移出后释放或取消确实停止；不会误开节点，节点、历史和浮窗交互仍正常 |
| AC12 | 边易于命中，高亮边及直接端点，移出不错误清除其他有效状态 |
| AC13 | 旧流程、Schema、正式 Review、ChangeSet 和已提交成果读取不回归；不删除历史数据 |
| AC14 | 帮助、文档、Skill、System Memory 与行为一致；适用自动化和真实浏览器验收有证据；Memory 有差异时完成最终 ChangeSet 校验 |
| AC15 | report依赖链、并行及修订后成果推导正确，Run记录及revision不变；读侧redo也不写Run。人工调整与相反操作、重复幂等、一次替换及空集合正确；finish仅存差值且终态稳定。两类既有Run升级保留当前成果与历史；默认图和历史返回均取推导结果 |

## 兼容性与后续范围

向前兼容结论沿用原契约：不需要额外承诺未发布接口兼容。本迭代基线检查本地及 origin 未发现名称含 stable 的 checkpoint。数据保留和旧功能回归要求仍执行。

既有无 CommandState 的自由探索 Run 不静默补建或删除数据，普通查询与完整命令保留；新建 Run 保证成功回执具备 CommandState。当前项目已检查无 draft，不建设通用迁移体系。Run字段切换与执行器适配一起实施：已存outputArtifactIds的模型Run保留原成果选择，并转换为相对自动成果的人工增删差值；更早finalArtifactIds版的终态保留原最终根，运行中从完整产物图推导自动根。旧版report若中断，先接续原Step及应有成果变换，再计算差值。转换后删除完整根字段，只持久化outputOverrides，所有运行均继续按图推导outputs；report及redo不更新Run。旧流程非模型Run保持原样。

后续范围：普通流程及 ChangeSet 接入 Continue、ACP和Runner宿主、自动多Runner分配、查询索引、图缩放及编辑。本轮没有 YAML syntax 关键字变更。

## 正式评审与规范

原正式敏捷 Run 为 run-20261025-035719z-bcc49b1e；方案共创 Run 为 run-67ed4607-6fc0-4310-ba4b-8a9e0b201de0。Human 参与产品负责人及架构师；产品、研发、架构、测试角色均沿用绑定的 Agent。

本版以 Human 技术讨论中的范围确认作为修订依据；整体随正式技术评审请求 Human 核对，不代填新的正式投票。开发、测试、交付继续遵循原契约列明的四份仓库 Statement。
