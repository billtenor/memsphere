# 自由探索结束归档与依赖图优化：实施与验证方案

## 问题与结果

当前自由探索已具备 CLI 结束入口，Run 页缺少完整的结束、归档与找回动线；依赖图使用固定行列与自行绕线，多输入、多汇合时出现重叠、穿点和长距离绕顶。完成后，Run 页支持可确认的结束与终态归档、列表找回和恢复，产物图采用已确认的绿色视觉方向及实际尺寸布局，内容与依赖证据保持不变。

依据：已通过的本轮需求契约、第 2 轮 Runner accepted-fixed 的 AC2 说明修正、Human 对绿色主题及 archived 布尔字段的明确确认。

## 采用的规范

- memsphere-repository-development-rules：避免过度设计；用户行为、模型、System Memory 源/副本和 Skill 同步。
- memsphere-repository-testing-rules：受影响测试、完整回归、真实 View/Playwright CLI 验收、Memory 变更级校验。
- memsphere-repository-requirement-rules：范围及兼容结论不因实现调整而降低。
- memsphere-repository-delivery-rules：验收证据、归档及交付记录。
- memsphere-run：运行实例、两种运行模式、角色和状态的概念解释；执行约束见对应规范、Skill 与 CLI 文档。

## 1. 归档模型与持久化

Human 已确认，只在 `memsphere/context_control/run.json` 增加可选字段：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| archived | boolean，可省略 | true 为已归档，false 或缺省为未归档。 |

`status` 保持 running / done / abandoned。Step、Artifact、External、Review 不增加字段。归档数据仍在原模型 Store；不移动文件、不复制内容、不改变 contentRef、依赖、评审或成果人工差值。

`ContextControl.archive(runId, archived)` 在已有短 Run 锁中读取终态记录，以 ValueStore expectedRevision 更新该单份 Run。运行中拒绝归档，恢复不改变原终态；同义重复操作不写记录。普通 report / redo 保持不修改 Run。通用 data CRUD 仍遵守原管理边界，不额外建设新的业务锁或多记录事务。

已知候选 `archivedAt` 替换为 archived；运行中且 archived=true 的异常组合不得作为可继续生产的合法状态，领域操作明确报错。结束后的业务内容只读不妨碍归档标记的更新。

## 2. 结束与空成果

沿用 `run finish --run R`、`continue C finish` 及已有显式 `--artifact ID`。默认使用本次锁内推导的成果；完成提交前检查产物完整性与引用内容。

结束 API 的 `artifactIds`：省略表示当前成果，`[]` 明确表示空交付，不使用 truthy 判断把空数组替换为默认成果。CLI 对已有成果明确选空时，复用 `run outputs update --remove ID` 后 `run finish`，不新增空集合命令。

页面结束确认展示当前交付成果的数量与名称，空集合明确显示“无交付成果”。点击确认提交当时展示的具体 ID 数组，而非省略参数后在服务端悄悄改用另一个集合；拒绝或失败时留在当前页，重新获取后确认，不虚报结束。新增并发产物与快照之间的变化按单次明确确认的 ID 集合处理，不引入额外确认版本或交付缓存。

结束成功后尽力关闭当前 Project / Run 的 CommandState；辅助关闭失败返回 warning，不撤销已提交终态。View 与 CLI 复用 helper，并显式使用各自实际 Home，避免写到另一个 Home。

## 3. View 与 CLI 找回

| 场景 | 展示或操作 | 服务端 |
| --- | --- | --- |
| 运行中 | 顶部结束运行、废弃及各自确认 | 现有 Run 读写分流；自由探索走 ContextControl，原流程保持原服务。 |
| 已完成 / 已废弃 | 顶部和列表归档动作 | 新模型只更新 Run 标记；旧流程沿用现有 Archive 服务。 |
| 已归档 | Run 模块“已归档”入口，显示原终态 | 查询归档集合；这是 UI 筛选，不增加 Run.status 枚举。 |
| 归档详情 | 原稳定地址只读，提供恢复归档 | 新模型不换 Store；旧流程仍从现有归档位置读取。 |
| 恢复后 | 返回原 done / abandoned 列表 | 只恢复可见性，不恢复生产。 |

沿用项目隔离的 `/api/projects/P/runs`、`/runs/R/finish`、`/runs/R/abandon` 与 `/archive/runs/R`；归档查询使用独立 archived 查询条件，普通状态筛选语义不变。恢复使用 `/archive/runs/R/restore`，先唯一确定来源，再分别调用模型服务或原流程 restoreRun。

归档列表至少覆盖本轮自由探索记录，并复用已存在的旧流程归档摘要以保持单一 Run 入口。不得让同 ID 的新旧来源相互覆盖；列表、详情、内容、归档和恢复都执行唯一来源检查，Store 失败不作为“不是新模型”而静默回退。

CLI 沿用 `archive run R` / `archive list runs` / `archive restore run R`，合并展示相应来源。Continue 的适用命令组不扩大；已结束的前文不因恢复归档而变为 active。

归档原地址跨轮询保持可读；用户执行归档动作后从普通列表移出，不能因同一段“移出列表”逻辑而使之后直接打开的归档详情自动跳走。

## 4. 图布局与视觉

### 展示边界

正式实现继续归入 `org.memsphere.run`。原型包只在独立、仅本机监听的预览进程替换现有 Run page.presentation，没有新增正式模块、一级导航或 Home 配置。将确认后的视觉转入正式 renderer 后，历史原型作为本地需求材料保留，不属于代码提交内容。

保留绿色主题、公开 Theme token、现有 Badge、名称/标签和历史入口。External.source 节点最多三行，完整来源、ID、URL 与内容在原浮窗可读；不新增 External 名称或摘要字段。Artifact 的全部现有标签仍可读，不能通过裁切标签获得固定高度。

图的根仍为推导 outputArtifactIds，版本选择仍使用真实依赖闭包，revisedFrom 只分组不画边。每条真实依赖对应一条边，不能删边、合并身份或改变方向以获得整洁。

### 采用已有布局能力

新增固定版本 `elkjs@0.12.0`，只用作坐标和路径计算；现有 DOM/SVG renderer、主题与交互保持。核对 npm 元数据：EPL-2.0 OR GPL-3.0-or-later，采用 EPL-2.0 分发路径并补齐 LICENSE/THIRD_PARTY_NOTICES 对应声明；安装归档解包约 8.0MB，不把该数值当作浏览器实际 bundle 大小，构建时记录打包结果。此技术选择不引入 React 或 React Flow 运行时。

依据：[ELK 官方](https://github.com/kieler/elkjs)说明其只计算布局；[ELK Layered 文档](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)支持分层、端口及多种边路由；[React Flow 官方示例](https://reactflow.dev/examples/layout/elkjs-multiple-handles)展示固定端口顺序减少交叉。该示例仅作接入参考。

实施方式：

1. 先构建真实节点 DOM，限制标题/来源预览并保留完整标签，测量节点及历史入口的实际宽高。
2. 将节点 ID、实际尺寸与所有真实边交给 ELK layered，方向从左到右，端口分配在东西两侧，按稳定的节点/依赖顺序生成唯一端口 ID。
3. 使用 ELK 给出的起终点与转折点绘制连线，在保持其避让走廊的前提下做小圆角处理；不将路径重新替换成贯穿节点的起终点单条曲线，不强制所有跨层边绕顶。
4. 保留边的命中宽度及真实 ID；悬停突出该边和两个直接端点。节点与历史菜单、浮窗仍用原事件逻辑。
5. ELK.layout 为异步：每次图投影使用本地递增请求序号，只有最新请求可应用坐标；旧历史选择、已切换 Run 或卸载后的结果丢弃。序号只在前端内存，不加入 Run 模型。
6. 常规轮询不无条件清空并重画不变的图；同投影刷新保留滚动位置、打开的历史菜单和浮窗，返回最新/切历史时按明确用户操作更新。初次测量后统一定位，不在每条边上触发重排。
7. 首版使用浏览器本地 bundle，不请求 CDN、不上传图数据、不新增服务端布局接口或 Worker 协议。布局失败显示局部可重试错误，不伪造一张完整图；卸载清理监听和失效请求。

布局目标是可读、避免穿点及减少重叠，不宣称任意 DAG 能零交叉。验证同时覆盖真实 8 节点 14 边、跨多层直连、扇入扇出、断开分量、多标签长标题和历史版本变化，不能只验证原型的单一数据。

## 5. 已知模型升级

复用 `project models initialize` 的 Project 写锁、已知定义 hash 检查和 model-operation before/after 恢复机制，不新增通用迁移框架。

| 已知旧形态 | 处理 |
| --- | --- |
| 当前已交付、尚无归档字段的 Run 模型 | 只更新模型定义；原 Run 缺省 false，不重写每条记录。 |
| 本轮预先安装的 archivedAt 候选模型 | 扫描其绑定 Run Store；只有真实含 archivedAt 的行改成 archived=true 并移除旧字段，其他行不写。 |
| 更早的 finalArtifactIds / outputArtifactIds 已知模型 | 保留既有成果差值转换，再叠加必要归档字段转换；不能丢失手选旧成果、空成果或终态选择。 |
| 定制/未知定义、身份冲突或损坏行 | 明确拒绝；不静默删字段或重建记录。 |

候选 archivedAt 转换在新定义校验前先通过旧 Runtime 读取，所有变更在完整检查后发布；保留未改动行的 revision/createdAt 和内容。实际转换行 revision 正常增加。转换中断使用原 model-operation 恢复；重试同一 initialize，无需新恢复命令。仅定义兼容的 Store 不要求 JSON 文件格式；确实需要既有文件级迁移时维持原 filesystem-json 能力限制，其他后端明确报错，不直接假设本地物理目录。

## 6. 影响范围与开发任务

| 部分 | 主要文件 / 任务 |
| --- | --- |
| 领域与投影 | `src/context_control/types.ts`、`service.ts`、`view.ts`：归档标记、终态和幂等、默认与显式成果。 |
| CLI / Home 前文 | `src/commands/archive.ts`、`context-control.ts`、`src/home/command-state-store.ts`：来源分流、合并查询、辅助关闭和明确 Home。 |
| View API / 页面 | `src/commands/view.ts`、`modules/org.memsphere.run/adapter/view/index.ts`：结束确认集合、归档入口、详情和恢复。 |
| 图与构建 | `context-control.ts`、`context-control-styles.ts`、`graph-layout.ts`、package.json / lock：ELK、测量与异步保护、选定视觉。 |
| 模型升级 | `reserved-models/context-control/run.json`、`src/project/context-control-upgrade.ts`：archived 定义与已知形态升级。 |
| 说明同步 | CLI 文档和 Skill 承载操作语义；System Memory 的 memsphere-run 源/副本只保留概念解释，保持一致。 |
| 设计草案 | 将已授权的 `docs/procedure-graph-syntax.md` 纳入交付，确认只描述将来设计，不接入当前解析/执行器。 |

实现与验证结果见 delivery-report.md；正式评审及验收记录由 Run 留存。

## 7. 验证映射

| 契约 | 需证明的结果与层级 |
| --- | --- |
| AC1–AC3 | 领域模块 + CLI/HTTP 集成：当前成果、显式成果和 [] 空集合、空 Run、重复完成幂等；运行中拒绝归档；终态禁止业务写入。 |
| AC4–AC6 | View/CLI 集成：归档列表找回、稳定地址轮询不跳走、恢复原终态；与归档前四类证据及依赖逐项一致；Home 前文不重新激活。 |
| AC7 | 布局模块 + 浏览器：边数量和身份完全一致，节点不重叠，边避开无关节点；真实尺寸、直接与跨层线可辨、绿色与 Badge 保留。 |
| AC8 | 浏览器 + playwright-cli：历史选择只切图、浮窗翻页不关闭、快速切换不被旧布局覆盖、窄屏标签与内容可读、边高亮、平移停止/失焦。 |
| AC9 | archive-store、Run/review/view 回归与模型升级测试：旧流程行为及已知数据不丢，缺省 archived 不写每行，候选归档标记转换、失败恢复及重复升级。 |
| AC10 | 受影响测试后 npm run typecheck、npm run build、npm test、memsphere validate；Memory 差异对应最终 memory change validate 证据。 |
| AC11 | 验收报告逐文件记录模型/CLI/Skill/System Memory 源副本与实现的语义核对，确认图语法草案没有 parser/schema/runtime 新语法接入。 |

错误路径覆盖：CAS 冲突、未知/冲突来源、Store 读写失败、contentRef 失配、后台辅助关闭失败、坏模型升级与布局异常；复用既有明确错误与幂等重试，不新增后台永远自动修复机制。

实际 View 验收使用专门测试数据，不结束、废弃或归档用户正在使用的 Run。已有只读原型端口仅本机开放；最终正式 View 更新由现有服务完成。

## 8. 风险与边界

- 新布局库的实际体积和计算时间需构建与代表图验证；先本地 bundle，避免另建 Worker/远端服务。若正常使用规模出现阻塞，先报告实测并在技术评审内调整。
- 节点高度、异步布局与轮询是主要回归风险，不能只测路径公式。
- 归档布尔字段允许旧记录缺省，候选时间字段转换只写必要行；跨源同 ID 仍明确拒绝，不能以旧流程为兜底隐藏异常。
- 不改变已通过需求范围，不增加缩放、图编辑器、自由节点拖动、自动依赖简化、更多 Continue 命令组。
- 代码、已接受的 Memory/Skill 与必要文档通过本次 PR 交付；模型和 Memory 保持最终校验证据，最终合入由 Human 操作。

# Syntax 关键字变更

本轮不新增、修改或启用任何 Memory YAML syntax 关键字。`archived` 是 Run 模型业务字段；API 参数和界面查询不是 Memory DSL 语法。图语法文档仅作为设计草案纳入。
