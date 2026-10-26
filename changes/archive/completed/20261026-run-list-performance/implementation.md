# 实施与验证方案

## 目标与确认依据

对应需求 `20261026-run-list-performance`、Run `run-20261026-071300z-8bbc8d0c`。Human 产品负责人已正式通过需求契约，Runner 已接纳。产品 Agent 两条意见在本方案落实为端到端性能标准及未知数量的页面断言；功能范围不变，不修改五个领域模型、生产流程或持久化保障。

## 实际问题与改法

### 1. 单独读取 Run 摘要

`src/context_control/view.ts` 当前复用 `listRuns/findRun/snapshot`，触发重复恢复与所有子记录读取；`src/commands/view.ts` 的 summary API 最后才筛选。

增加专供 View 摘要的只读加载器，与详情使用的 `ContextControl` 分开。通过既有 Model Host、ValueStore 打开 `context_control/runs`，校验其绑定和 Run 模型；枚举及读取 Run，分页读完，检查 data_id/记录身份一致，生成名称、标识、status、createdAt、endedAt、archived/readOnly、representation 等摘要。更新时间只能使用 Run 自身结束/创建时间；不提供 eventCount、outputArtifactIds 或 contextRevision。不打开其他四个业务 Store，不调用 findRun、snapshot 或 redo，不向任何业务记录写入。

保留普通完整服务的 listRuns、findRun、snapshot 等现有恢复语义，CLI/Archive/模型升级不受影响。列表不是生产恢复入口，详情仍恢复并明确报告损坏，不能用列表正常代替详情正常。

summary API 使用新加载器，按请求状态与归档范围筛选后返回。旧流程仍使用现有摘要缓存；两种来源 ID 冲突检查必须跨状态与归档范围保留，不能先过滤到看不见冲突。非 summary 旧接口行为保留，不因本轮精简而改变其完整性约定。

### 2. 只缓存资源，不缓存业务结果

摘要加载器按规范化 Project root 在当前 View 服务生命周期内复用，服务关闭后释放引用。每次查询在现有 Project/settings 锁内读取最新配置和 model-operation stamp，指纹变化时重新打开 Run Store 和校验模型；缺少初始化时返回空，部分绑定/不兼容按现有契约明确报错，不静默沿用旧实例。初始化失败不能永久缓存 rejected Promise。

不能只依赖 model-operation stamp：`createBusinessStore/removeBusinessStore` 直接原子写 Project config，并不一定更新这个 stamp，因此指纹同时包括当前配置中模型存储、登记和业务绑定等相关值。单条 Run 每次从 Store 读取，report、结束和归档后的新状态不被资源复用遮蔽。不取消 Project 锁、记录 CAS、路径校验、模型准入或来源冲突检查。绑定变更后的重新装配和摘要读取位于同一一致性范围内。

### 3. 首页与列表共享在途摘要

在 Run Module 实例内增加一个小型摘要请求入口，首页、列表（及相同摘要的其他消费者）按完整 Project API URL 共享同一个尚未结束的 Promise；响应解析一次，完成或失败就删除，不保存长期结果。不同 Project/状态独立，失败后下一次刷新重新发请求。

共享请求独立于单个页面消费者的 AbortController；消费者退出只取消自身等待，不能取消首页或另一消费者的请求。Module 卸载统一终止所属请求并清理。路由更换/状态切换后，旧响应不得覆盖新列表；按当前请求代次或等价取消机制保护提交。

### 4. 前端缺省值与详情刷新

列表元信息当前为 `shortId · (eventCount ?? 0)`；改为仅在真实数量字段存在时显示数量，自由探索只显示标识。旧流程合法的 0 仍显示 0，不把缺省、null 或非数字当作计数。

当前 `skipUnchanged` 条件只有声明和判断，没有调用者；显式刷新及现有业务操作已请求选中详情，不把该死分支误认为当前刷新故障。删除依赖摘要 contextRevision 的无效优化分支，保持实际详情请求路径，并测试显式刷新、新产物/轻量评审后的刷新及生命周期操作。保留独立详情错误、历史与浮窗选择、正式评审轮询和本轮以外的交互，不新增全列表轮询，也不为此另建详情缓存协议。

## 影响范围与交付边界

- 主要文件：`src/project/context-control.ts` 或相邻摘要读取模块、`src/context_control/view.ts`、`src/commands/view.ts`、Run Module 请求及列表渲染；对应测试。
- 不改模型定义、Run 的生命周期字段、outputs 推导与人工增删记录，不迁移数据，不新增统计索引或后台任务。
- 同项目复用资源，跨项目严格隔离；有效配置变化重新校验。损坏子记录不影响列表，Run 自身损坏/身份冲突仍不能被当成正常运行。
- 无 syntax 关键字变更；Memory/Skill 仅检查一致性。本轮不引入新的 Agent 使用命令或概念，若实现发现需要修改 Memory，再按受控 ChangeSet 流程处理，不直接改长期定义。
- 原始性能样本、浏览器脚本和截图保存在 Run 验收材料或临时工作目录，不提交 Git。

## 开发任务

1. 增加只读、可复用的 Run 摘要加载器并接入 summary API；保留完整接口与来源冲突。
2. 共享前端在途查询，处理取消、失败重试、Project/状态隔离与迟到响应。
3. 调整数量显示及所选详情刷新，不更改原有业务操作。
4. 补充下述回归测试，执行基线与优化后实测，更新需求记录及验收材料。

## 验证方式

| 契约 | 测试与观测 |
| --- | --- |
| A1/A2 | 模块测试：混合状态/归档 Run、分页；子 Store 方法设置为失败仍可读摘要；Run/子记录 revision 不变。真实 HTTP 验证筛选、排序、两个来源冲突（包含冲突藏在其他状态/归档的情况）。损坏的 Run 主记录、data_id 身份不一致、running 且 archived=true 必须明确失败，不能返回正常条目。 |
| A3 | 构造损坏子记录或 Artifact 已保存、Step 未完成的故障；摘要返回 Run，详情执行原恢复或明确失败，不伪造完整成果。原有 outputs/恢复测试继续通过。 |
| A4 | 可控制 Promise 的请求协调测试：同 URL 合并、不同 URL 隔离、单消费者取消不影响另一方、失败后重试；真实浏览器观察页面启动请求数，切换状态/Project 后不被旧响应覆盖。 |
| A5 | 同加载器连续读取，验证复用实例且能读取新 Run/新状态；移除/重建或有效变更 Run Store 绑定、修改模型后，下一查询使用新绑定或明确失败。失败修复后能再次读取，不缓存错误。 |
| A6 | 真实 View 查看自由探索图与内容；新产物/轻量评审后点刷新，详情更新。运行生命周期与旧流程正式评审使用已有套件回归。缺少 eventCount 的自由探索列表不出现 `· 0`，旧流程真实 0/非零照常展示。 |
| A7 | 实际页面端到端与 HTTP 分层实测，口径见下。 |
| A8 | 先跑适用测试，随后 typecheck、npm test 全量、build、memsphere validate；必要时 ChangeSet validate。浏览器操作使用已授权的 Playwright CLI；有界状态等待，不以固定睡眠断言正确性。 |

### 性能验收口径（落实产品意见）

基线和优化后均使用当前实际 Project 数据规模（约 388 个旧流程 Run，3 个自由探索 Run、114 个 Artifact/Step、39 个 External、40 个轻量 Review；本轮流程记录增长单独说明），同机同构建模式、同浏览器与视口、相同目标 URL。记录开始/结束时数量，不能删数据、隐藏有效 Run 或改成静态结果达标。

1. **服务已启动、首次页面进入**：使用新浏览器上下文，从导航开始到“运行中”的预期列表项真实出现、加载态消失且可点击为止；不等待无关详情或后台任务。先预热服务一次，各采至少 5 次，记录并比较中位耗时及 API/渲染时间分解；列表必须加载成功且可操作，不残留 loading/error 状态。不增加需求契约之外的页面百分比门槛；若页面仍慢，报告实际表现及剩余瓶颈，不能只凭 API 通过声称用户体验已改善。
2. **摘要 API**：同一服务预热一次后连续至少 5 次，中位耗时降低至少 70%；记录返回条目数、响应体积和实际请求/Store 访问。
3. **服务冷启动后的首次列表**：与浏览器缓存冷暖分开标注，基线和优化各记录首个页面样本及首次摘要耗时，要求加载成功，另以访问边界断言其不扫描子记录；不将单个冷样本混入上述预热中位数，也不以机器速度作 CI 单测门槛。
4. 原始样本作为本 Run 验收证据。若后端优化后浏览器仍无可见改善，继续查真实页面瓶颈，不降低已确认的 API 标准或停止在服务端测量。

## 采用规范与风险

采用 `statements/memsphere-repository-requirement-rules`、`statements/memsphere-repository-development-rules`、`statements/memsphere-repository-testing-rules`、`statements/memsphere-repository-git-rules`、`statements/memsphere-repository-delivery-rules`，以及 `changes/README.md`。主要风险为过期绑定、共享请求取消相互影响、详情因缺省指纹停止刷新；由以上明确用例保护。首个请求仍需打开 Run 的 Runtime，旧流程首次读取仍有现有摘要成本；本轮通过减少无关读取改善，不新增持久化缓存，也不承诺所有数据规模固定毫秒数。
