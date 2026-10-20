# PR full 健康门禁交付报告

## 交付内容
取消每日定时full，master push自动full，PR保持default精简（8构建/234文件执行）；full18构建/450文件执行。master最新SHA full尚未登记或在途pending，非成功failure；当前PR最新head full success可解锁，旧head失效，最新重跑pending而非退回旧绿灯。

新增固定仓库/CI workflow身份、真实full汇总和attempt/分页核证、实时head/master二次复核、先pending再判定/error的轻量发布器。可信master工作流由PR target/master push/CI requested-in_progress-completed/手动触发，不安装依赖或执行PR代码/Artifact。受控bootstrap仅owner、reviewed_sha==实际github.sha且master未安装发布器；只发布状态不构建，不属于full。ruleset辅助只追加/定向回滚稳定context，来源Actions15368，保留其他保护及已有严格策略。README与CI操作说明已同步。

## 需求基线与验收结论
当前Run run-20261019-131051z-f3f21f57，Human明确确认契约v5，方案第2轮正式通过。成果review-20261019-145546z-7665bec8 / round-20261019-145546z-e3a34b3c：Human通过，测试/架构通过；研发唯一blocking为旧事件SHA与实时checkout相等检查导致提前退出，已修复并accepted-fixed；架构同源risk亦accepted-fixed。正常发布器固定master checkout、记录git HEAD，允许旧事件依据实时master刷新；bootstrap精确SHA限制保留。Runner已接纳。采用需求/开发/测试/交付四份Statement，无Syntax/Memory变更，无空ChangeSet。

## 本轮真实验证
- 最终受影响15/15通过，含真实本地HTTP/Node CLI、新排队事件A与检出B不等的回归；既有workflow覆盖/预算断言保留。
- 最终npm test：150文件、1241 TAP项（1239通过/2平台跳过/0失败），372.42秒。其pretest实际执行npm run build并成功。
- 最终npm run typecheck、memsphere validate、git diff --check通过。
- 真实GitHub只读dry-run约12.889秒：当时PR108 head3996954与master b8fa54c，凭head full39249732765成功判为success，没有写状态/规则。这是现有远端记录的读取证明，不能代替未提交实现的CI。
- 最初沙盒端口测试失败，宿主首次复跑通过；旧历史扫描因查询过多停止并优化为优先自身/当前master SHA证据，旧push default排除；新回归与最终全量通过。无产品失败遗留。

## 归档、后续步骤与残留边界
实现/验证/成果验收已完成，需求记录移至changes/archive/completed/20261019-pr-full-health，移除active状态并记录completed_at。整个Run未完成。后续按当前Run commit、更新既有PR108、跟进最终head default/full/Security，之后在CI跟进Agent步骤完成required context missing阻拦→owner精确SHA bootstrap真实success恢复、身份/规则回读。异常仅撤本轮新增context，保留其他规则；不伪造full失败、不创建额外测试PR/分支。

自动事件工作流合入master后才正式部署，合入前只声称模拟事件、真实只读和bootstrap接线。GitHub事件/状态API有传播窗口，不能与点击合入原子同步；API读取失败error，写入服务本身故障时工作流失败并暴露无法刷新。无合入时不主动发现环境变化，仍可手动full；不新增过期策略或外部通知系统。最终Human合入并确认无问题后，再验证实际merged、完整纳入与安全清理本地分支。Agent不合入或开启自动合入。


## 2026-10-20 Human确认修订
取消整体五分钟预算（含Security同类step）；default/Security保留原生job5分钟，full测试/打包20分钟、full汇总5分钟，排队不作为失败。依据、原话及修订范围已记录于当前Run CI跟进产物，替代历史预算约束。API不增加退避重试，测试覆盖和8次PR构建不变。修订后的当前head仍须完成本地/远端验证和真实接线。


## CI耗时调查与超时选择依据

| 运行 / job | job总时长 | 最后步骤完成后的空档 | 结果 |
|---|---:|---:|---|
| default第2轮 Windows core | 396秒 | 185秒 | 取消 |
| default第2轮 Windows upgrades | 334秒 | 77秒 | 取消 |
| default第2轮 macOS platform | 317秒 | 111秒 | 取消 |
| full macOS runtime | 627秒 | 569秒 | 10分钟超时 |
| full汇总 | 154秒 | 153秒 | 1分钟超时 |
| 定向调试复跑 macOS runtime | 87秒 | 约2秒 | 成功 |
| 定向调试复跑 full汇总 | 2秒 | 约1秒 | 成功 |

full异常macOS runtime实际81文件38.75秒、0失败，所有步骤58秒结束；同源码复跑成功。因此观察到的异常集中在步骤之后，并非测试需要运行十分钟。对齐GitHub runner v2.337.0官方源码，后续还有进程检查、日志队列排空、临时目录清理和CompleteJob结果上报；成功调试没有复现失败长尾，不能凭此声称已查明或修复其中某个内部根因。20分钟full/5分钟汇总用于容纳已观察到的收尾波动，仍有明确终止界限；default5分钟不变。整体含排队时间只观察，API失败不增加重试，测试断言不变。

本次v6最终验证：npm test 150文件、1239通过、2平台跳过、0失败，362.10秒；构建（pretest）、typecheck、Store校验和15项受影响验证通过，git diff --check通过。远端验证必须使用v6提交的新head，旧head调试成功仅作为耗时诊断依据。
