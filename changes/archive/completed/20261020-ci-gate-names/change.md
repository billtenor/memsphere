---
id: 20261020-ci-gate-names
type: improvement
created: 2026-10-20
completed_at: 2026-10-20
run_id: run-20261020-041526z-0fc096e3
---

# 需求

用户无法区分Full health工作流和Full health / master提交状态，误以为两者都是测试任务。用户明确要求清理已合入PR108的旧本地分支，并创建独立PR，使名称直观体现职责。

| 名称 | 职责 |
|---|---|
| CI (full) | 实际运行完整跨平台测试，名称保持不变。 |
| Update PR merge gate | 查询full结果，通过API更新PR状态，不跑测试。 |
| Merge gate / full regression | 保存在PR最新提交上的Commit Status，供保护规则读取，本身不执行任务。 |

刷新运行标题显示master updated、CI completed、PR opened等来源；初始化显示名为Initialize PR merge gate。触发条件、权限、可信master checkout、并发、full判定、修复解锁、测试范围/构建数/超时保持不变。历史运行和提交状态记录不改写。不重设计CI、不删事件、不增加API重试。

# 验收标准

- 工作流、运行标题、job/step、状态和文档能区分动作与结果。
- 默认仅发布新context；严格true的临时变量启用新旧双写，关闭即恢复单写。
- 全部PR的旧context pending阶段先于新context阶段；某笔失败后仍撤销其他可写标志，每笔只尝试一次，撤旧失败不进入健康查询/结果发布。
- HTTP验证成功/失败/等待、identity/逐PR查询error、单/多PR部分写入失败；历史与新初始化记录均不能供full成功证明。
- 生产切换保留原保护，context绑定Actions15368，不改其他规则；实际新状态及规则回读属于合入后的Run收尾，不用本地测试冒充线上证据。

# 向前兼容

结论：不需要向前兼容。仓库CI命名不是稳定Tag发布的产品接口，无相关稳定checkpoint兼容责任。线上已有required状态采用临时双写迁移，避免要求维护者停用保护；不永久保留旧名作为新提交的界面。

# 技术与测试方案

变更两份工作流、发布脚本、两份测试、CI说明和本需求记录，保持工作流文件路径与CI身份。临时仓库变量FULL_HEALTH_PUBLISH_LEGACY严格为true时启用固定旧context→新context双写；撤旧按context分阶段，收集独立写入错误后整体失败，不重试。状态写服务本身不可用时无法保证撤销该状态，既有服务故障和异步传播窗口明确保留。

新建PR时并行执行default CI和门禁刷新；状态不存在也阻拦，API先写pending再判定，CI/full事件继续刷新已有PR标志，无需重跑这些PR的default测试。说明文档区分任务、标志位和API更新机制。

# 开发任务

- [x] 工作流/job/step及事件标题、初始化和提交状态改名。
- [x] 临时双写、全PR分阶段撤旧、历史初始化排除。
- [x] 受影响HTTP/CLI/workflow、类型、构建、全量回归和Store验证。
- [x] 文档、需求记录和Agent成果验收。
- 后续Run步骤：独立PR与远端检查、Human合入、生产context切换/关闭变量、确认结果并清理本地分支。

# 验收结果

最终受影响19/19通过；npm test 150文件、1261通过、2平台跳过、0失败，366.58秒；pretest构建、typecheck、memsphere validate和git diff --check通过。无Memory差异，无空ChangeSet。

第1轮成果架构评审发现多PR部分失败缺口，已修复并补真实HTTP反例；隔离旧顺序副本实际失败，修正后通过。精确true反例和事件标题分支建议也已落实。第2轮review-20261020-043416z-a8490d32 / round-20261020-044553z-0b588e7f：研发、测试、架构全部通过，Runner接纳。此前结果只保留在Run历史，不代替最终验证。

# 交付边界

当前迭代实现、本地验证和Agent成果验收已完成，归档实现交付材料。整个Run尚未结束，线上名称切换未部署，不宣称已完成生产迁移。

改名PR仍由旧master发布器与旧required context保护。合入前启用临时变量；合入后可信master刷新，验证新状态及Actions来源，读取最新ruleset仅原位替换该context，保留所有其他规则，回读验证后删除变量并复查。异常保留双写和旧规则。Agent不自行合入或启用自动合入。

# 关联需求

PR108已合入；旧Run run-20261019-131051z-f3f21f57已完成，旧本地分支codex/trim-ci-test-coverage已删除。无重复命名需求。采用需求、开发、测试、交付四份仓库Statement；详细过程产物在本Run。
