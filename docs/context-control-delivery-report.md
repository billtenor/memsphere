# 上下文控制自由探索：交付报告

Run：run-20261022-130223z-496d73ae。工作区：`/data00/home/liuyanjun.lyj/.codex/worktrees/7dad/vibe-mem`；分支：`codex/context-control-exploration`；master基线：`1d4679b4e9208e93778aef4233bffe82d0e3b90d`。

## 交付内容

| 能力 | 本版行为 |
| --- | --- |
| 模型持久化 | 自由探索使用独立context_control模块和五模型ValueStore；Run按run_id存，其他四实体按run_id/实体_id存。JSON ValueStore支持分层键、CAS、删除版本保留及旧扁平记录 |
| 生产边界 | Agent声明Artifact目标，系统关联Step；读取通过--for归到目标Step，report --target在同ID一次提交完整成果；直接完整report仍可用，普通report不接收draft正文 |
| 依赖与修订 | Artifact/External具体ID依赖；default与自定义tag；按tag依赖只展开当次集合；已提交内容不改，修改创建新Artifact/Step，支持回到旧产物重做下游及多根交付 |
| 阅读与轻量Review | Artifact/External正文可输出到stdout或排他文件；记账失败只警告；human/agent来源、多条评论及评论文件；无需先配置正式reviewer或产物model |
| 并发与恢复 | Store单记录CAS，业务按Run短锁；先保存Artifact，再按原IDredo补齐Step；已完成跳过，不能恢复的情况明确报错。分层新记录对顶层目录名称空间做短锁仲裁，防止别名并发污染 |
| 前端 | 既有Run模块、列表及详情的另一种展示；真实Store依赖图、折叠历史、点击节点开正文/评论浮窗、同一浮窗翻页及背景切换、统一badge、单一顶部名称/状态、窄屏及下载 |
| 新旧兼容 | 旧Procedure执行、Schema渐进写作、正式Review与旧RunState保留；CLI/View按来源分派。共享Run接口在具体操作前拒绝双来源同ID，不静默返回正文或执行旧Run操作 |

实施基线为原第4版需求与实施方案第4轮固定附录A（AC24–AC27）。Human已明确确认需求补充并正式投通过；本轮没有扩展需求，也没有改写历史需求Submission。

## 查看与使用

[真实Store前端预览](http://localhost:21017/projects/test-project/tasks/run-1d037728-acd5-4155-8d21-5a1498dbf2f4)使用独立临时验收Project，含7个真实Artifact及历史依赖、轻量Review。交付报告前已检查页面和Project API均200，representation=context-control。此入口用于本地验收，不是新的产品模块或独立业务导航。

当前工作树通过 `node dist/cli.js` 运行；安装本版后命令前缀为 `memsphere`。完整命令和例子见 docs/context-control-exploration-cli.md。最小动线：

```bash
memsphere run start --name "探索任务" --output json
memsphere run artifact create --run R --name "方案" --tag design --output json
memsphere run artifact show --run R --artifact A --for B --out input.md
memsphere run external show --run R --external E --for B --out external.txt
memsphere run report --run R --target B --artifact-file result.md --depends-on artifact:A
memsphere run review create --run R --artifact B --reviewer agent --comment "补充恢复路径"
memsphere run report --run R --revised-from B --artifact-file revised.md
memsphere run finish --run R --artifact B_NEW --authorization "用户已确认修订成果并同意结束"
```

R、A、B等为相应命令返回的实际ID。按tag依赖使用 `--depends-on tag:design`，当次展开为具体ID。无目标的新CLI请求不保证重复请求去重；结果不明时先查询，不盲目重复创建。

## 最终验证

| 检查 | 实际结果 |
| --- | --- |
| 最终全量 `npm test -- --test-concurrency=4` | 157/157文件通过；1319项中1317通过、2项Windows专属在Linux跳过，零失败、零取消，236.16秒 |
| typecheck/build | 通过；构建包含五模型Runtime检查、正式View资源和示例包检查 |
| 高风险定向验证 | 领域/进程34项、CLI/Store52项；后续来源冲突与旧View接口7项、浏览器20项全部通过，最终全量再次覆盖 |
| 实际Playwright CLI | Human已授权并实际操作真实Store的图、浮窗翻页、背景同步、390×844窄屏；console零错误零警告。后续来源检查修复另经真实浏览器集成验证 |
| 独立发行包 | 最终源码构建后npm pack，独立consumer/全新Home和Project的九条命令通过，含External文件导出；五模型及manifest在包中 |
| Project与Memory | memsphere validate通过；最终变更级校验valid=true、零issues，详见下方 |
| diff | git diff --check通过，无未解决Git合并冲突 |

最终全量日志：/tmp/context-control-source-check-full-tests.log；结构化结果：/tmp/context-control-source-check-test-results.json；包验证：/tmp/context-control-source-check-package-result.json。架构师Agent也独立完整复跑当前修正代码157文件通过，236.10秒。没有把原156文件的历史统计冒充最终代码结果。

首轮验证发现的旧无Project上下文View回归已修复；实施验收又发现External导出遗漏、父目录别名并发污染和正文/下载来源检查遗漏，均增加反例与验证后修复。当前没有以历史失败、跳过或降低断言豁免产品缺陷。

## 验收与意见处置

实施验收 Review `review-20261024-120001z-b3cc3d7b` 第2轮 `round-20261024-122617z-e32fad96` 已通过，全部Reviewer已提交，未处置阻塞为零。

Human架构师与测试Agent投通过。研发与架构师的建议修改票原样保留：研发发现的实际来源冲突缺陷已accepted-fixed并附最终验证；两个列表性能风险accepted-followup；架构师要求为已确认范围内修复额外开轮的流程建议由Runner判断为非阻塞。架构师已亲自检查并完整验证当前修正代码；Runner承担最终技术验收判断，没有代投或改写任何Reviewer意见。

本轮冻结Submission本身没有覆盖；旧统计仍作为提交时的历史证据，最终修复与157文件统计通过正式Runner意见处置追加。比较时Submission与本地验收材料字节一致，sha256为ca9296b0c01532b4db6ca580d9c6cf4e5a2f7c3cf1fd230e168ccb40363e875f。归档后只同步工作区文档路径，不回写Run中的不可变材料。详见 docs/context-control-source-check.md。

交付报告评审已通过：Human产品负责人及产品Agent均投通过，全部意见已收齐且无待处理意见；Runner已投通过，流程进入本轮功能代码提交。Commit SHA通过Run的提交结果产物记录，是否创建PR由Human另行决定。

## 语义资产与归档

七份System Memory源与当前工作区副本一致，Skill已同步；没有新YAML关键字，没有System Memory增删/重命名，manifest不变。

- ChangeSet：change-20261024-113723145z-e05840bf
- 最终校验：valid=true，issues=[]
- checkpoint：15b2bf478a08534c275edb3772c2d3f7747b3385d69af72099b13abfd784139e
- [Memory变更入口](http://localhost:30000/projects/memsphere/changes/change-20261024-113723145z-e05840bf)

已完成交付规范要求的需求记录归档：`changes/archive/completed/20261024-context-control-exploration/`，记录真实completed_at、移除active状态、保留原Run及验收信息，并同步工作区文档引用；没有覆盖已有归档目标。最终报告的产品评审状态另行记录，不把技术验收归档当作产品已投票。

## 残余问题与后续范围

- 列表目前逐Run重复扫描，约O(R×E)，内联正文增大读取和内存成本。已记录于归档目录follow-ups.md；后续先做一次扫描分组、摘要按需加载及规模基准，再判断索引需求。首版不承诺大规模性能。
- 本机没有执行Windows专属验证，也未接入真实远程数据库；内存ValueStore测试证明领域不依赖本地目录能力。
- 旧Run迁移、Store改绑/热迁移、graph DSL、正式Review新动线、图上编辑和代码自动回放不在本轮；没有通用事务日志、自动回滚或补偿框架。
- 当前交付在工作分支，尚未合入master或发布。`docs/procedure-graph-syntax.md` 为无关草案，不进入本轮commit；测试fixture和/tmp结果不写入业务Project或Git。

关键实现位于 src/context_control/、src/project/context-control.ts、src/commands/context-control.ts、分层JSON ValueStore和既有Run Module。新增文件尚未暂存，审查应结合git status读取，不能仅凭git diff遗漏新文件。
