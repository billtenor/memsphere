---
id: 20261019-preserve-disclosure-state
completed_at: 2026-10-19T08:57:05.145108+00:00
type: bugfix
created: 2026-10-19
run_id: run-20261019-053859z-c589946f
---

# 当前迭代需求契约：刷新后保留内容展开状态

## 整体目标
用户在 Memsphere 中展开、收起内容后，提交评审意见或发生同一对象的界面刷新时，继续保持阅读结构，无需重复操作。

## 当前迭代范围
1. 修复 ChangeSet 中提交 Comment 导致记忆正文展开/收起状态重置的问题，覆盖定位意见与整体意见、重复提交，以及编辑、删除意见引起的同类刷新。
2. 排查并修复普通 Memory 详情和 Run 详情及 Artifact Review 中由刷新、意见交互或重渲染触发的同类问题，覆盖实际存在的内容折叠控件（规则、流程、产物等）。已有能保持状态的控件保持其行为。
3. 同一页面会话中，以 Project、对象及内容位置区分用户选择；不同记忆、ChangeSet、Run、评审材料或轮次之间不串用状态。内容变更后只继承仍可准确对应节点的状态，新节点沿用默认值，不把旧节点状态误用到其他内容。
4. “全部展开/全部收起”和逐项展开/收起的结果都应在同一对象重渲染后保持；保留原有默认展开策略、键盘操作与扩展组件回退能力。

## 后续范围
本轮不增加跨浏览器、跨设备或关闭页面后的永久偏好同步；不重新设计评审流程或修改评论、投票及 Memory/Run 存储协议。对象切换后返回是否恢复，可按组件生命周期提供，但本轮不承诺刷新整个浏览器页面后的恢复。

## 交付物
代码修复、能复现原问题的自动化回归测试、三个界面的实际交互验证记录、需求跟踪记录、交付报告和通过全部适用 CI 的 GitHub PR。最终合入由 Human 执行。

## 验收标准
- ChangeSet：对至少两个层级设置不同展开状态，提交意见后原有展开及收起状态均保持；连续提交、编辑及删除意见后仍成立，意见正常保存与显示。
- ChangeSet：差异视图与候选视图分别检查，状态不相互污染；“全部展开/全部收起”后提交意见保持选择。
- Memory：同一记忆发生页面内刷新/重渲染后，用户设置的展开状态保持；不同记忆及 Project 不串状态。
- Run/Artifact Review：同一 Run 或同一轮同一材料刷新及意见交互后，用户设置的内容展开状态保持；切换 Run、材料或轮次不误用其他对象状态，既有评审提交、轮次切换与自动刷新正常。
- 内容增删或结构变化不引发异常，不将已移除节点状态套到无关节点；原默认值对新节点仍有效。
- 使用真实 View 和 playwright-cli 操作受影响交互；自动化测试等待稳定重渲染结果，不靠固定延时推断成功。
- 交付前通过受影响测试、npm run typecheck、npm test、npm run build、memsphere validate；如实际产生 Memory 差异，追加最终 ChangeSet 校验与入口证据。

## 向前兼容
结论：不需要向前兼容。当前仓库未发现名称包含 stable 的 Tag，不涉及稳定 checkpoint 的数据迁移或旧协议兼容。本轮属于界面临时状态修复，保留现有 CLI/API、持久化数据、评审权限与现有 View 扩展契约。

## 采用规范与初步证据
- 已读取 statements/memsphere-repository-requirement-rules：独立明确向前兼容结论。
- 已读取 statements/memsphere-repository-testing-rules：可观察行为回归、真实 View 集成、playwright-cli、稳定异步等待和交付必跑检查。
- 已读取 concepts/memsphere-view：遵循 Shell/Module/UI/Slot 边界及原生 disclosure 语义。
- 仓库 changes/README.md：每个需求独立 change.md，用 run_id 关联详细产物。
- 初步代码：modules/org.memsphere.memory/adapter/view/index.ts 的 submitComment 调用 load，render 删除并重建详情 DOM；modules/org.memsphere.run/adapter/view/run-detail.ts 已有局部状态集合，但产物使用新建 details。此为调查线索，完整根因、具体实现及验证方案在需求契约通过后形成。

## 参与角色与待确认项
产品负责人：Human billtenor（actor5）；研发：Agent traex2；测试：Agent traex3；架构：Agent traex4；Runner 负责推进实现与流程。
产品负责人已于 2026-10-19 正式投票通过本轮范围和验收标准。其余技术方案、实现、测试及相应评审交由 Agent，只有出现范围变化或交付验收时再次请产品负责人参与。
Run：run-20261019-053859z-c589946f。

## 技术与测试方案
采用本 Run 第2轮已通过的实施与验证方案；使用模块内同步捕获及按明确节点身份恢复，覆盖真实 Agent Activity 折叠。System Memory 与 Skill 同步更新。关联需求：changes/active/20260828-changeset-diff-review；未找到重复缺陷需求。

## 开发任务
- [x] 共享状态工具与 Memory/ChangeSet 修复。
- [x] Run/Artifact Review 修复及对象隔离。
- [x] 原问题回归与边界测试、真实 View 实操。
- [x] 系统记忆校验及147文件完整回归（初次实现）。
- [x] 同内容节点插入边界补测及修正。
- [x] 修订后的最终完整复验（第5轮147文件通过）。
- [x] 正式多角色实现验收（第5轮三方approve，Runner接纳）。
- [x] 产品负责人交付验收。
- [x] 验收通过后写completed_at并归档；commit、PR与CI由关联Run继续跟进。

## 验收结果
初次实现及完整验证已完成；Runner补充发现同内容节点插入与父节点更名的两类身份反例，已修正并增加4项浏览器回归；第2轮完整复验通过后，正式研发/测试复审发现唯一节点移位及稳定容器正文变化会丢失状态，Runner已要求第3轮修订；已补充反例并将稳定语义身份与位置/正文分离，第3轮验证通过；正式研发复审发现嵌套Procedure和循环多产物的实例身份碰撞，第4轮已修正并通过完整复验；研发指出合法事件时间戳无唯一保证，第5轮完整历史occurrence修订及全量复验已通过，研发/测试/架构第5轮均approve且Runner接纳，当前进入产品负责人交付评审。

- 原实现已复现 ChangeSet 评论保存后列表收起、Run 刷新后原生折叠重置、Artifact Review 保存后执行详情收起。
- 修复后：Memory builtin 10/10、Run builtin 1/1、真实 Agent Activity 定向 1/1（含两轮真实 Agent 日志）、reserved-store 10/10，typecheck/build/Store 校验通过。
- playwright-cli 在隔离临时 Project 的真实 View Shell 操作 Memory 键盘及重绘、ChangeSet 真实评论保存、Run 刷新、Review 桌面和700px保存意见后展开/收起保持；console 0 errors/0 warnings；模块卸载后无新增错误。
- 当前 ChangeSet 无独立整体意见输入入口；无 target 整体意见通过受支持 HTTP API 设置再正式刷新验证，定位意见走可见行内 UI。Review 现有自动刷新仅增量 Activity 轮询；外部完整 context 更新通过身份切换和现有 refresh hook 验证，未新增轮询机制。
- Memory ChangeSet：`change-20261019-060004472z-18cf913a`，valid=true，checkpoint `a9542290f310516974e49cd0bde9906e050b5d01159d20e5eda304e36633aa66`，入口 `/projects/memsphere/changes/change-20261019-060004472z-18cf913a`。
- 首次全量147文件/1217项仅两项旧前置假设失败；由测试 Agent 保留原断言并新增状态保持断言，responsive定向2/2及整文件26/26通过。最终完整 npm test：147文件成功、1216项通过、0失败、1项既有Windows专属用例在Linux跳过，361.23秒。类型检查、构建、Store校验及最终ChangeSet校验均通过。
- 研发/测试/架构正式实现验收已完成：第5轮三方approve、0阻塞，Runner已接纳；产品负责人交付评审待完成。

## 后续改进与修订记录

- 研发、测试建议已采纳：拆分验证与正式评审清单，更新阶段性概述。
- 架构建议接受为后续改进：Module长会话访问大量对象/材料/轮次时，scope状态与活动缓存可增加有界淘汰和压力测试；当前缓存随Module实例释放，未扩大本次修复范围。
- 三位正式Reviewer初轮均通过；Runner额外发现索引路径配合同内容新节点插入可能误继承，主动要求修订并增加浏览器反例，不降低既定新节点默认/歧义不匹配标准。

身份修订验证：同内容新节点插入和父节点更名均先取得浏览器红灯。实际恢复key与分组身份均包含非根稳定父身份；内容未变时重复节点仍各自保持，结构变化时歧义组按新内容版本使用默认状态；不同命名父下的同值列表保持独立，根正文无关变化不清空其状态。修订专项4/4、完整Memory14/14、类型检查与Store/ChangeSet校验通过。修订后首个完整回归146/147文件通过，view-project-switch初始beta列表按钮等待超时；原样定向1/1和带浏览器诊断的6/6有效复验均通过，原因未定。随后原样完整确认回归147/147文件通过、1220项通过、0失败、1项既有Windows平台skip，364.14秒；该项目切换用例在同次全量通过5.52秒。未修改或放宽该用例。

第2轮正式审查：研发和测试要求修正Memory唯一命名节点移位、命名父内部增删及Run规则/产物正文变化后的保持；架构通过并保留缓存边界后续建议。Runner接受三项阻塞，继续同一迭代修正，不以已有全量绿灯替代行为验收。

第3轮修订最终验证：Memory新增六项先红后绿，完整20/20；Run容器与产物正文两项独立红灯转绿，相关24/24。完整npm test 147/147文件通过、1226项通过、0失败、1项既有Windows平台skip，362.47秒；项目切换同次通过5.22秒。typecheck、build、Store与最终Memory ChangeSet校验、System Memory逐字一致和diff check均通过。

第3轮正式审查：测试、架构通过；研发指出Run嵌套Procedure多规则树缺少来源身份，以及循环/重复调用多事件缺少事件身份。Runner接受，要求保留原规则树正文去重展示，并用稳定调用链与事件字段区分实例，先浏览器红灯再修复。

第4轮最终验证：root/callee/leaf规则来源调用链与event.at/frame实例身份已修复，保留原规则正文去重。独立测试Agent核对生产模型后修正夹具，最终源码正控绿，单独撤销owner及event身份的两项负控分别红。相关24/24通过；完整npm test 147/147文件成功、1226项通过、0失败、1项既有Windows平台skip，365.98秒。typecheck、build、Store与最终Memory ChangeSet校验、System Memory逐字比较及diff check均通过。

第4轮正式审查：测试和架构通过；研发指出同at/frame/stepId/契约的合法事件仍碰撞，测试也记录相同风险。Runner接受，基于当前RunStore事件仅追加及View hydration原序保证，用完整历史内稳定occurrence区分实例，不增加持久字段或修改协议；先取得同时间戳真实浏览器红灯再修复。

第5轮最终验证：Run完整history按tuple组内occurrence区分同时间戳合法事件，step/latest与collection共享sidecar；同at/正文修订/append新事件回归先红后绿。独立移除occurrence负控准确红灯，R4断言未删除或弱化。相关24/24，独立Run1/1通过；完整npm test 147/147文件成功、1226项通过、0失败、1既有Windows平台skip，371.63秒。typecheck、build、Store/Memory ChangeSet、System Memory逐字比较与diff check通过。

第5轮正式实现验收：研发traex2、测试traex3、架构traex4均approve，阻塞0。Runner已于2026-10-19接纳；三条缓存容量建议/风险均已正式accepted-followup（comment-20261019-074948z-422a2c0c、comment-20261019-075140z-385e4272、comment-20261019-074909z-4c5e22ec）。交付规范已复核：待产品负责人交付验收通过后写completed_at、移除active状态并归档需求目录，再继续commit/PR/CI；当前尚非完整交付。

## 按用户要求合并最新 master（2026-10-19）
用户在产品交付评审待提交期间明确要求合并最新master。当前修复临时stash后，分支快进至332b562（PR #104），原修复全部恢复，无冲突；新增helper、测试及需求文件逐字核对与备份一致，其他差异恰好是master的18个文件。

该合并结果通过npm run typecheck、build、完整npm test：149/149文件成功、1229项通过、0失败、2项既有Windows专属平台skip，362.51秒。测试期间远端又新增仅README的c9ee454（PR #105），已一并快进；运行时代码与已完成全量测试的版本相同。直接读取README的git/product-positioning/package-release测试13/13通过，最终diff check及无冲突检查通过。

最终HEAD/master基线：c9ee4546d10b267b4f1710297962abed1f6c45af。用户的合并指令不作为产品负责人正式投票；原Run仍停在交付评审review-20261019-075457z-ca632f8c，修复保持未提交。

CLI来源的Embedded ChangeSet不允许跨Git基线重绑，因此通过官方validate在确认新基线无其他候选后生成新基线证据，旧记录保留。最终Memory ChangeSet为change-20261019-082236697z-37fa07ba，valid=true，无issues；base=c9ee4546d10b267b4f1710297962abed1f6c45af；checkpoint=9b11138c2c561e0d122f0a5a4cf13297b1f1587084b715d0e7b4a453dddb791a；入口http://0.0.0.0:30000/projects/memsphere/changes/change-20261019-082236697z-37fa07ba。候选Memory正文未改变，后续交付采用本节新基线证据。原fb5f64d及中间332b562基线的ChangeSet分别为change-20261019-060004472z-18cf913a、change-20261019-081858382z-0fa81ac1，作为当时验证历史保留。

## 产品负责人最终验收与预览

产品负责人查看当前代码部署的默认30000端口View后明确回复：“好的没问题，验收通过”。已正式代提交approve及授权审计，Review review-20261019-075457z-ca632f8c / Round round-20261019-075457z-41bb3fbc，Runner接纳，阻塞0。默认30000端口Memory及Run模块已通过当前dist文件SHA256一致性检查，ChangeSet和Run页面HTTP 200；临时30306预览已关闭。按交付规范完成本目录归档，关联Run继续commit、PR和最新head全部适用CI，最终合入由Human执行。
