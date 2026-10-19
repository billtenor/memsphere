---
id: 20261019-pr-full-health
type: improvement
created: 2026-10-19
completed_at: 2026-10-19
run_id: run-20261019-131051z-f3f21f57
---

# 当前迭代需求契约

## 整体目标
取消每日定时full，改为每次合入master（push master）后运行full，把master最新提交的full健康状态作为后续PR合入门禁，避免依赖Human主动查看结果。用户明确选择：master full失败时，该PR最新提交的full成功即可解锁，避免修复PR死锁。

## 当前迭代范围
1. 去掉CI schedule。普通PR保持default精简覆盖与五分钟预算；push master使用full，workflow_dispatch仍可手动选择default/full。每次master推送的full都执行，不以取消旧运行优化开销。
2. 稳定门禁 `Full health / master`：master最新提交的有效full排队/执行中时，后续PR等待（pending）；非成功时拦截；成功允许。新master提交尚未出现full运行时也等待，不能借上一个提交的绿灯放行。API错误为error，无full记录不得伪报成功。
3. 用户授权修复解锁：该PR当前head对应最新有效full成功可解锁master等待/失败/无记录；旧head或其他SHA的成功不适用。当前head自己的最新full排队/运行时等待，完成为非成功时拦截，即使master成功也不能冒充通过。
4. master full只认当前仓库固定CI workflow身份、push master或手动master full；PR head full只认该head有效full。default与bootstrap不属于full。候选最新按created_at、run ID降序；重跑以最新attempt为准，进行中明确等待，保留之前失败证据且不回退较旧绿灯。成功必须整run及实际执行的full汇总均success；失败、取消、超时等都拦截。
5. PR创建/更新、master push、相关full requested/in_progress/completed后刷新所有开放master PR；发布前读取当前master SHA与PR head，防止乱序事件或旧SHA冒充新状态。写入只执行默认分支可信代码，不执行PR代码或不可信Artifact。
6. 将稳定门禁加入现有Protect master ruleset，绑定GitHub Actions身份，保留其余规则。strict_required_status_checks_policy=false，不额外要求每个PR更新到master；检查master最新提交full与此不同。
7. 新门禁仅API查询/状态发布，不新增完整构建。更新说明、需求记录与策略/事件/权限回归；仍在当前PR #108交付，历史测试删减Run保持不变。

## 生效及验证边界
PR #108仍OPEN，master尚无full健康工作流，现有规则集没有required_status_checks。正式自动发布工作流只执行默认分支可信代码，合入后自然生效。首次安装用已存在的CI workflow_dispatch作受控bootstrap：只允许仓库owner账号显式发起，执行经过本Run架构/成果审查且由输入SHA与运行实际SHA严格相等确认的候选；不自动执行任意PR代码，也不使用外部Artifact或PR提供的脚本。该首次安装例外须在架构与成果评审中显式审查，不能用未经审查候选写门禁。bootstrap不重建/重跑全量，不属于full候选，不得覆盖正常full结果；它只利用已经真实通过的当前head full证据计算/发布相同稳定状态。默认分支已安装正式发布工作流后拒绝bootstrap，改用默认分支可信刷新。

规则修改与验证由Agent负责，并在本Run的CI跟进Agent Action中完成：先完成该head default/full/Security及正式成果审查，先执行真实只读dry-run并核对当前安装PR full成功、bootstrap owner与精确SHA条件可执行；再从最新ruleset追加必需context、保留全部其他规则，以该context尚未发布导致PR缺少required状态/BLOCKED作为真实接线阻拦证据；随后手动bootstrap用当前head真实full成功发布状态并验证Actions身份，确认required满足、PR恢复可合入；全部完成后才上报最终交付报告、进入Human合入步骤。安装PR当前head已有真实full成功及健康状态，故不会被新增必需检查锁死。发生故障先修复，必要时只撤回本轮新增context恢复原规则，不移除既有保护，不声称完成。Human仍只负责最终审核合入和确认结果无问题；取得完整确认后才进入本地分支清理。不存在合入后的Agent激活前置条件或在Human步骤夹入Agent写操作。

真正自动事件刷新必须等工作流进入master才能生效，合入前用模拟REST/工作流契约覆盖自动刷新，并用受控bootstrap对真实PR状态与规则验证；不把自动事件尚未发布说成已实跑。首次bootstrap到合入之间的安装窗口由Agent核对最新head与full事实；后续正常使用由默认分支自动刷新。具体可信代码、状态身份、验证资源与回滚步骤进入架构方案正式审查。

## 首次真实接线验收口径

不创建额外测试PR/测试分支，不伪造失败full或错误的最终状态。使用本轮安装PR #108：在所有原有CI和当前head full成功、只读判定success、owner精确SHA的bootstrap已核对可执行后，临时添加本轮必需context但尚不发布该context。GitHub显示缺少required状态且PR被阻拦（BLOCKED/必需状态待到达），此为真实规则接线证据，不能声称它等价于实际触发了full失败。随后受控bootstrap根据真实head full证据发布success，读取状态身份、ruleset与PR合入状态，验证恢复。若服务或权限异常导致无法恢复，在有界等待后只回滚本轮新增context并继续修复，不移除其他保护，不冒称交付完成。真实full失败/取消/超时导致failure，以及后续真实success的策略与刷新路径由确定性策略+模拟REST测试覆盖；不对生产master故障注入。


## 确定性判定表与术语

本次变更依据：Human明确指示“就按这个改吧，去掉每天定时 full，合入 master 后跑 full；跑的时候后续 PR 等待，失败就拦截，修复 PR 自己 full 通过可以解锁。继续当前 Run。”本契约修订替代前序已接受契约中的每日schedule与忽略在途full条款；历史Run产物不回写，新方案包含此修订并重新评审。

可信full候选：当前仓库固定CI workflow_id，push master或手动full，并由固定profile标记/实际full汇总证明是full；legacy master schedule full只用于识别历史，移除schedule后不再触发。default与bootstrap即使workflow success也不属于full。已标记full在plan/汇总之前失败或取消仍为非成功候选。full成功必须run与实际full汇总均success；skipped/neutral/缺失汇总不成功。

最新按created_at与run ID降序。master门禁还必须匹配实时master SHA：若最新master提交尚无full，则pending等待，不能用上次已完成绿灯放行。无任何full历史时failure并给出手动master full入口。run_attempt>1正在重跑则pending并保留上一attempt事实，不回退旧绿灯；完成后使用最新attempt结论。PR同head最新full优先级高于master；最新head变更使旧head解锁失效。

| master最新提交full | PR当前head最新full | 门禁 |
|---|---|---|
| 任意 | success | success（修复解锁） |
| 任意 | 排队/运行或重跑中 | pending |
| 任意 | 任意非成功 | failure |
| success | 无 | success |
| 排队/运行/重跑中，或新master SHA等待full出现 | 无 | pending |
| 任意非成功 | 无或仅旧head成功 | failure |
| 无有效full历史 | 无 | failure，提示手动master full |
| API查询或身份/结果证据异常 | 任意 | error，不能发布新成功 |

master push和full requested/in_progress/completed均刷新所有开放master PR。新full排队时即撤回旧绿灯为pending；PR自己的full进入新attempt也会撤回自身旧绿灯，不能重跑失败候选后借更早成功恢复。串行刷新读取最新事实，发布前重读master SHA与PR head，发生变化重新计算，不使用事件携带的旧结论。

状态刷新依赖GitHub事件/API，不承诺与人工点击合入原子同步；事件触发到pending生效存在传播窗口，连状态写API都不可用时记录无法刷新。若需要绝对串行合入须另评merge queue，不在本轮。无合入时不自动发现外部依赖/runner环境变化，可手动full。此门禁不证明每个PR的跨平台正确性。

## 后续范围
不保证这项门禁证明每个PR的跨平台正确性：它检测主分支已知full故障，普通PR本身仍按default覆盖。没有新设外部通知系统，不替代发布前对目标SHA验证full。不新增自动合入或绕过现有保护。暂不新增full过期时长策略。

## 交付物与验收标准
- 实现、策略说明、稳定门禁上下文及保留其余规则的ruleset变更依据。
- 覆盖master成功/失败/无记录/API错误，default及其他分支不能冒充full，PR当前head解锁/旧head无效，master push与full开始/完成刷新旧PR，乱序事件读最新事实，分页覆盖及可信代码权限边界。
- 首次实际执行受影响检查，随后typecheck、npm test、build和memsphere validate；区分本轮、历史、模拟与远端证据。
- PR最新head全部适用default/full/Security成功。合入前按下述首次接线验证证明required缺失阻拦及真实bootstrap success恢复，failed full判定由模拟REST回归验证；不声称做过真实master full故障注入，自动事件的正式发布条件与合入前验证边界须区分并给出证据，不能仅有口头说明。
- 无Memory差异不建空ChangeSet；若修改Memory必须最终change validate。需求完成归档，最后按Human合入确认安全清理本地开发分支。

## 向前兼容
结论：不需要向前兼容。只增加本仓库CI/合入策略，不改产品、数据或Memory契约；不得破坏既有Protect master规则。

## 采用Statement
statements/memsphere-repository-requirement-rules（独立兼容决策）、statements/memsphere-repository-development-rules（最少必要复杂度与权限/结果正确性）、statements/memsphere-repository-testing-rules（真实验证、失败边界和最低充分层级）、statements/memsphere-repository-delivery-rules（最终证据和归档）。无额外Git Statement。

## 关联与待确认
新Run run-20261019-131051z-f3f21f57；追加PR #108，当前head3996954。前一测试删减Run run-20261019-081003z-36eab35a已完成，不重新开启或覆盖历史。Human仍额外参与架构师，其他角色沿用对应Agent。用户已明确修复PR当前head full成功解锁及master push full/运行中等待策略，需求层无其他阻塞选择；具体实现与首次生效顺序进入架构方案评审。


## 实现与验收结果
已落实v5：移除schedule、master push full；运行/未登记等待、失败阻拦、当前PR head full成功解锁；可信master发布器和受控owner精确SHA首次bootstrap，规则仅追加稳定context与Actions15368来源。
Human方案第2轮、成果第1轮均正式通过；成果review-20261019-145546z-7665bec8由Runner接纳。研发发现的排队旧event SHA与实时checkout不同的竞态已修复，真实CLI回归证明撤旧success为pending；研发blocking与架构risk均accepted-fixed记录。
最终本地npm test：150文件，1239通过、2平台跳过、0失败，372.42秒；受影响15项、typecheck、build、Store校验通过。无Memory差异，不创建空ChangeSet。当前阶段完成实现/验证/成果验收并归档，整个Run仍等待PR CI、真实规则接线及Human合入确认；不能将本地验收当成线上生效。
