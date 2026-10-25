# 上下文控制：初始验证报告

Run：run-20261022-130223z-496d73ae。分支：codex/context-control-exploration；master 基线：1d4679b4e9208e93778aef4233bffe82d0e3b90d。

验证基线为原第4版需求及实施方案第4轮固定附录A（AC24–AC27）。Human 已在 round-20261024-111321z-5cbf4ff3 / assignment-20261024-111321z-d6960ebe 确认补充并投通过；本报告不改写历史需求快照。

## 执行结果

| 检查 | 结果与边界 |
| --- | --- |
| `npm run typecheck` | 通过，包含主项目及 Module 类型检查 |
| `npm run build` | 通过；完整测试的 pretest 已对最终源码重新构建，检查五模型 Runtime、View 资源及示例包 |
| `npm test -- --test-concurrency=4` | 修订版通过：156/156文件，零失败；1317项中1315通过、2项按平台条件跳过，零取消；耗时223.83秒 |
| `memsphere validate` | 通过；仅作为当前 Project 校验，另行执行变更级校验 |
| Memory 变更级校验 | valid=true，零 issues；见下方最终 checkpoint |
| 独立发行包 | 修订后重新npm pack独立安装；全新Home/Project完成原七条命令及External创建/文件导出共九条命令，全部成功；五模型和manifest均在包中 |
| 实际浏览器 | Human 授权的 Playwright CLI 检查真实 Store 的图、正文/评论、同一浮窗翻页、390×844 窄屏；console 0错误0警告。另有全量测试中的真实浏览器集成覆盖 |
| diff | `git diff --check` 通过 |

## 覆盖重点

- 分层 ValueStore：分层 CRUD、递归查询与分页、同叶不同 Run 隔离、跨进程 CAS、删除重建 revision 保留、旧扁平记录和非空目录重新登记。
- 五模型与装配：原型基线受控适配、正式模型/登记/业务 Store 路径、无绑定只读查询不初始化、内存 ValueStore 替换文件后端、完整键与 value.id 分离。
- 生产动线：create 自动关联 Step；读取通过 --for 归入目标 Step；report --target 同 ID 提交完整成果；直接完整 report、tag 当次展开、具体依赖、External、轻量 Review、修改重走及多根交付。
- 恢复与并发：单记录 CAS、业务层按 Run 编排；Artifact 保存后失败按原 ID redo 补 Step；已完成不重复执行；终态阻止继续写入。无 target 的新 CLI 请求不承诺重复请求去重。
- 阅读：正文或文件输出先成功；辅助记账故障只警告；contentRef 读取及 sha256 核对；未被当前操作使用的旧分支不因 redo 被无故重读。
- 图与浮窗：历史折叠、较新分支作为最新版本、保留真实依赖的不同版本、历史选择只切图、无下游隐藏、同一浮窗翻页、窄屏标签页及 Escape。

## 本轮失败与修复

首轮完整测试暴露新 Store 探测对旧无 Project 上下文 View API 的回归：Artifact Review、Run 废弃和 Schema 展示三个接口测试失败，相应浏览器文件因等待失败请求未结束。终止该停滞测试后完成首轮统计：156文件，4文件失败。

修复将新来源探测限定于具有 Project 上下文的 View 配置，保留原无 Project 的旧 Run API 能力；实际 Project 的 Store 错误仍正常报告。三个接口文件定向重跑共5项通过。随后从最终构建重新完整回归，156文件全部通过；旧 Artifact Review 浏览器文件及新的上下文控制浏览器文件均通过，不把首轮结果当作通过。

此前新增领域测试的一处输入未使用 DataStore MIME 所需后缀，已修正 fixture 并重跑该领域文件6项通过。沙盒内子 CLI 输出被宿主隐藏时，不据此修改产品；真实 CLI、HTTP、浏览器和跨进程验证在已授权的沙盒外执行。当前没有作为历史失败豁免的测试。

## 最终 Memory 校验

- ChangeSet：change-20261024-113723145z-e05840bf
- 状态：valid=true，issues=[]
- checkpoint：15b2bf478a08534c275edb3772c2d3f7747b3385d69af72099b13abfd784139e
- View：http://localhost:30000/projects/memsphere/changes/change-20261024-113723145z-e05840bf

本 checkpoint 对应最终七份 System Memory 源与工作区副本；替代此前实现摘要的开发中 checkpoint。无新 YAML 关键字，未创建、删除或重命名 System Memory，manifest 无需变化。Skill 同步完成。

## 实施验收后的修订验证

首轮实现验收独立发现 External show 未注册 --out、不同叶记录同时创建大小写/Unicode别名父目录可污染Store。两处已修复，并新增29项测试：包括真实CLI输出/记账矩阵、原生锁超时、别名父目录同进程/跨进程竞争与失败清理、Run并发顺序和每个持久化边界前后中断。受影响的两批测试分别34项和52项全部通过，再次完整构建和全量回归为1315通过、2项平台跳过、零失败。详见 docs/context-control-implementation-revision.md。

## 限制与未执行项

首版只实现 JSON 文件后端；内存 Store 测试验证领域没有依赖文件目录能力，未声称接入实际远程数据库。查询采用完整分页扫描；未进行大规模性能压测。

本机为 Linux，跳过的两项分别验证 Windows Shell 的 Agent Review 命令、Windows 文件共享冲突恢复；未在本机声称执行 Windows 专属验证。其余本轮测试没有跳过。

旧流程不迁移；改绑保护、热迁移、graph DSL、正式评审的新模式及图上编辑均在已确认范围之外。真实本地界面证据见 changes/archive/completed/20261024-context-control-exploration/browser-validation.md。

修订后最终回归日志和独立包smoke结果位于本机 /tmp/context-control-round2-full-tests.log、/tmp/context-control-round2-test-results.json、/tmp/context-control-round2-package-result.json；首轮日志仍保留。临时fixture不进入项目数据或Git。
