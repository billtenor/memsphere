# 上下文控制：实现与验证验收材料

当前为实施验收第2版。第1轮发现的External导出遗漏和父目录别名并发缺陷已修复；逐条修改与证据见 docs/context-control-implementation-revision.md。前轮Human通过票及历史材料保留，新轮审查当前修订成果。

Run：run-20261022-130223z-496d73ae。

## 验收基线

本轮按原第4版需求及实施方案第4轮固定附录A（AC24–AC27）实施。Human 已明确“补充需求我也确认了，这轮我投通过，继续往下走吧”，正式记录位于 round-20261024-111321z-5cbf4ff3 / assignment-20261024-111321z-d6960ebe，Runner 已在读完 Agent 意见并完成处置后通过。固定附录就是本轮需求补充，不改写旧 flow[1] 的历史需求快照，不因历史快照没有追加文字而再次要求相同授权。

验收对象是当前实际代码、Run 中的功能实现摘要、初始验证报告及本材料。请独立检查需求、方案和代码，尤其是边界及失败路径；本摘要和测试通过不能代替审查。

## 当前实现

| 范围 | 可检查行为 |
| --- | --- |
| 分层持久化 | Run 使用 run_id，其他四模型使用 run_id/实体_id，value.id 保持实体ID；通用 JSON ValueStore 支持层级CRUD、递归分页、完整键CAS及删除版本保留 |
| 新旧并行 | 自由探索进入独立 context_control 服务与五模型Store；旧流程执行器不迁移。CLI/View 按真实来源分派，来源冲突/实际Store故障报错，旧无Project上下文View继续读取旧Run |
| 轻量生产 | artifact create 声明目标，自动关联Step；show --for 记到目标Step；report --target 同ID完整提交；直接report保留便利入口，没有普通report --draft |
| 依赖和修改 | Artifact/External具体ID、tag当次展开、default标签、不可变已提交内容、修订新ID/新Step、依赖继承或替换、影响查询与多根交付 |
| 轻量Review | 独立Review记录，多条 --comment、评论文件、human/agent来源，不要求正式reviewer绑定或model，不额外增加轮次和投票 |
| 并发和redo | 持久化层单记录CAS；业务按Run短锁。先保存带stepId的Artifact，再补Step；后续写操作按已有ID自动redo，已完成跳过；无目标的新请求不承诺请求去重 |
| 阅读 | 原文/输出文件先返回，Step.reads失败只警告；不把阅读自动当成依赖；contentRef通过Store/Runtime读取并核对sha256 |
| 既有Run界面 | 原模块/原列表/原详情中的真实依赖图，无新模块；历史折叠及切图、点击开浮窗、同一浮窗上下版、背景同步、badge、单一顶部名称/状态、窄屏内容/评审切换与下载 |

## 实际代码入口

Workspace：`/data00/home/liuyanjun.lyj/.codex/worktrees/7dad/vibe-mem`。
分支：`codex/context-control-exploration`；master 基线：`1d4679b4e9208e93778aef4233bffe82d0e3b90d`。

当前尚未创建功能commit。新增文件尚未暂存，不能仅凭 `git diff` 判断没有实现；请结合 `git status --short` 读取新增文件。`docs/procedure-graph-syntax.md` 是无关草案，不在本轮实现和后续commit内。

| 路径 | 审查重点 |
| --- | --- |
| src/context_control/service.ts、types.ts、graph.ts、view.ts | 五实体、生命周期、不变性、具体依赖、读取记录、原ID redo、图闭包与视图DTO |
| src/context_control/model-assets.ts、reserved-models/context-control/ | 固定发行模型来源、原型基线适配、五模型字段与Runtime支持、manifest |
| src/project/context-control.ts | 模型/Store装配、现有业务服务使用、每Run业务锁、内容读取端口，无通用跨记录事务协议 |
| src/commands/context-control.ts、run.ts、cli.ts、cli-errors.ts | 新旧命令分派、参数互斥、DTO系统字段拒绝、输出、重复comment、tag、create/for/target动线 |
| src/data/extensions/filesystem-json-valuestore/、shared/filesystem.ts | 相对ID、父目录、原子写入、CAS、旧扁平版本兼容及元数据校验 |
| src/project/data-service.ts、business-stores.ts | 层级ID准入、非空目录重新登记 |
| src/commands/view.ts、modules/org.memsphere.run/adapter/view/ | 原Run入口、真实API、图/浮窗生命周期、安全内容渲染、刷新、键盘、窄屏 |
| test/context-control*.test.ts、test/data-filesystem-hierarchy-process.test.ts | 领域、真实CLI、故障注入、内存后端、跨进程CAS、50修订、真实浏览器 |

其他修改的既有测试为 business-data-service、data-filesystem-json-valuestore 及其跨进程fixture。完整文件列表和实现说明见 docs/context-control-implementation-summary.md；CLI语义见 docs/context-control-exploration-cli.md。

## 实际验证

- `npm run typecheck`、`npm run build`、`memsphere validate`、`git diff --check` 均通过。
- 修订后最终 `npm test -- --test-concurrency=4`：156文件全部通过；1317项中1315通过、2项Windows专属测试在Linux跳过，零失败、零取消，223.83秒。旧正式Review及新图的浏览器集成都通过。
- 首轮无Project上下文View探测回归已修复；定向5项通过后重新完整构建并全量测试。没有把历史失败或环境问题作为失败豁免。
- Human 已授权 Playwright CLI。真实Store页面实测历史切图、同一浮窗翻页及背景变化、390×844全屏与评审切换，console零错误零警告。证据在 changes/archive/completed/20261024-context-control-exploration/browser-validation.md。
- 修订后最终npm包独立安装到临时consumer，全新Home/Project执行创建项目、start、artifact create、report --target、artifact show、External创建/导出、finish、status九条命令均成功。包中包含五模型及manifest；未依赖开发Project模型。
- 领域内存ValueStore测试通过，证明不依赖本地目录能力；未声称已经实现远端数据库。

完整验证与失败归因见 docs/context-control-initial-validation.md；修订后本机最终日志在 /tmp/context-control-round2-full-tests.log、/tmp/context-control-round2-test-results.json、/tmp/context-control-round2-package-result.json。新增领域/进程34项和CLI/Store52项定向测试均通过。Reviewer 请区分亲自复跑的内容与引用的既有证据。

## 最终语义资产与范围

七份System Memory源与当前工作区副本一致，Skill已同步；无新YAML关键字，System Memory清单没有增删重命名。

- ChangeSet：change-20261024-113723145z-e05840bf
- 校验：valid=true，issues=[]
- 最终checkpoint：15b2bf478a08534c275edb3772c2d3f7747b3385d69af72099b13abfd784139e
- View：http://localhost:30000/projects/memsphere/changes/change-20261024-113723145z-e05840bf

这份最终证据替代此前实现摘要上报时的开发中checkpoint。后续若再改Memory，必须重新校验。

剩余范围维持已确认方案：不迁移旧Run，不做改绑保护/热迁移、不引入通用日志/自动回滚/补偿框架，不实现graph DSL、正式Review新命令、图上编辑或代码自动回放。首版完整分页扫描，没有索引和大规模压测。前轮架构师明确标为非阻塞的列表O(R×E)及内联正文成本已接受为后续事项，记录于 changes/archive/completed/20261024-context-control-exploration/follow-ups.md，不声称大规模性能保证。运行数据与项目数据均未因测试写入真实业务Run。

当前进入实施验收，尚未宣称完成交付。验收通过后记录结果并归档需求目录，提交交付报告；交付评审通过后仅commit本轮变更，PR仍由Human决定。
