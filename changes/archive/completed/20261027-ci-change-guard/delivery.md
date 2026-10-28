# CI 修改保护交付报告

Run：run-20261027-132814z-7a6d7855。分支：codex/ci-change-guard。交付评审提交时尚未创建commit/PR、尚未合入、规则尚未激活，Run未结束。Human随后明确指示先提交PR，本轮据此先交付PR供审阅，产品负责人正式验收票保持待提交。

## 本次交付

- 新增独立CI change guard，普通源码/业务测试变更通过；受保护的workflow、CI规划/执行/构建/smoke/安全配置、包和锁文件、门禁及其专属回归文件变更失败。
- 从可信master checkout运行无外部包依赖的校验，读取完整PR文件差异；新增、删除、双向改名、分页、3000文件上限、查询错误与head/base变化均有处理，失败或信息不完整不发布成功。
- 失败日志列出所有实际命中的文件，使用指定文案。例如：

```text
CI change guard: ".github/workflows/ci.yml" 等 CI 机制不允许在 human 未授权的情况下修改。请检查修改的必要性，或者请求 human 授权
```

- Human在GitHub PR上手工绕过专属规则并亲自合并，失败状态保持失败；其他合并规则继续执行。沿用共用账号，不增加身份隔离。
- 新增维护文档 docs/ci-change-guard.md、15项guard回归，需求/方案/任务和验收结论已按规范归档。原有CI参数、超时、矩阵、测试标准与Protect master没有弱化。

## GitHub实际结果

独立规则[CI change protection / 25963440](https://github.com/billtenor/memsphere/rules/25963440)已创建并多次GET核对：

- enforcement=disabled，目标仅refs/heads/master。
- 唯一必过检查CI change guard，来源GitHub Actions integration_id=15368，strict=false。
- bypass精确绑定User billtenor(10627561)，bypass_mode=pull_request；平台读回current_user_can_bypass=pull_requests_only。
- 原[Protect master / 19767795](https://github.com/billtenor/memsphere/rules/19767795)仍active、无bypass、Merge gate / full regression保留；创建前后关键字段一致。

首装代码尚未进入master，独立规则按方案保持disabled，保护此刻尚未生效。真实只读dry-run成功，但当时open master PR为0，不把空列表当作真实PR红绿验证，也没有发布个人来源假状态。

## 验证与验收结论

- 受影响四文件：37项通过；最终guard单文件：15项通过。
- npm run typecheck、独立npm run build、memsphere validate：通过。
- Runner完整npm test：173文件成功，1472通过、2项既有Windows专用项按平台跳过、0失败，670.60秒。
- 研发Reviewer独立完整npm test：173文件、0失败，658.82秒；测试Reviewer独立复跑15项与四文件37项均通过。
- 实现验收review-20261027-141604z-fb4a00cc第一轮：研发、测试、架构均approve，Runner通过，无阻塞意见。意见已逐项处置：清单文档对齐、未来本地Action维护边界、来源应用限制、关闭/改目标PR的旧pending说明；现场激活风险保留后续核销。
- 本轮无Memory/Skill差异，不创建空ChangeSet。最终源代码与自动化测试和全量验证相同，验收后仅修正文档并归档需求。diff与忽略规则检查通过。

原始日志、规则JSON和Reviewer复测保留在当前任务目录 `ci-change-guard-evidence/`（完整本地路径见Memsphere Run，不发布到代码仓库）。完整结果与实现指纹已上报同一Run。原始证据不提交Git；代码交付只含实现、可复用测试和必要文档/需求结论。

## 后续必须完成的步骤

- [ ] 产品负责人完成本交付报告正式验收（Human已另行授权先提交PR，不代填通过票）。
- [ ] 推送PR并跟进最新head全部现行适用CI；不自行合并、不启用自动合并。
- [ ] Human合入首装PR，确认master包含guard工作流和代码。
- [ ] 同一Run运行可信master guard，激活规则25963440并GET读回；旧Protect master继续保持原约束。
- [ ] 在真实适用PR上核验普通变更success、CI变更failure及Human手工bypass合并证据。当前尚无这些现场证据，按已确认方案取得并记录，不擅自合并或为演示制造无关PR。
- [ ] 取得Human合入与结果无问题的明确确认，核实目标分支实际包含本轮改动，再清理本轮本地开发分支并结束Run。

## 后续范围与边界

不引入评论授权、标签、独立App、额外身份隔离或恶意workflow防伪系统。Actions来源限定不能区分内部workflow，沿用Human已接受的共用账号及最终人工合入约定。保护清单按文件维护；未来新增本地Action或其他目录CI代码时扩展清单与回归。本次没有改变CLI、Memory、Run语法或业务数据兼容性。

产品负责人本轮评审对象是可提交PR的实现、测试证据及disabled规则配置；通过后仍须按上述同一Run后续步骤完成上线，不等于已宣称线上生效。

## 交付后补充记录

Human于2026-10-27明确要求先提交PR。仅调整PR提交与产品验收的先后顺序，不自行合入或激活规则。首次安装PR不会运行尚未存在于master的新门禁，合入并激活后才能在后续CI变更PR看到真实拒绝。

修订后docs/ci-change-guard.md SHA256：35cf22d8e73b71ffd6a042c705dc25e44a63d0f33fdc2021a4b91ae22aeb564d。代码和测试与已通过的完整验证版本一致。

## 临时演示验收与恢复

Human要求体验真实拦截，临时增加仅针对PR118的演示入口，并临时启用独立规则。Actions运行 https://github.com/billtenor/memsphere/actions/runs/40529163520 在演示head b2e3709c642e9c950e03b74673963dcbf6ee61c1 上真实发布CI change guard=failure，列出4个实际受保护文件及指定中文报错。Human随后明确表示验收没问题并要求恢复。产品负责人正式通过票已记入原交付评审。

已恢复规则25963440为演示前disabled，精确User bypass保持不变，删除临时ci-change-guard-demo.yml；正式workflow仍固定从master运行，代码与既有验证版本不变。旧Protect master保持active且无bypass。真实演示失败证据已保留；正式master运行、激活、普通PR success和实际Human bypass合并证据仍在后续步骤取得，不把本次验收当作已合入或已上线。

## 恢复后完整CI的既有Windows问题修复

恢复提交1fd2732的普通CI通过；完整回归40533697453复现master运行40512256758已存在的失败：两个Procedure图测试提取Markdown中YAML示例时只匹配LF，Windows checkout的CRLF导致示例为undefined。仅修正test/procedure-graph-syntax.test.ts与test/procedure-graph-runtime.test.ts的测试输入换行处理，新增LF/CRLF明确覆盖并保留原断言。新增CRLF用例先实际失败，修正后受影响三文件67项全部通过。生产代码、Memory、门禁代码及CI参数/超时/选测标准不变；本地全量和最新head远端完整回归继续跟进，最终结果记录于Run。

## CI测试目录整理

四个CI专用测试已集中到test/ci/，同步导入与维护说明。runner、planner和覆盖测试共用递归发现，仍发现全部173文件；已对比迁移前后每个套件的成员以及default/full矩阵，均一致。新增嵌套发现与真实runner列举回归，CI专用39项通过；本地全量与更新后PR检查继续跟进，最终结果见Run/PR。CI并发、超时、矩阵和原有断言标准不变。
