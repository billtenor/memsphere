# 实现与验证验收材料

## 当前待验收成果

验收对象为整个 Run 的已确认需求契约第二轮、实施与验证方案第二轮、前序实现摘要和初始验证报告，以及当前 Workspace 的实际代码/测试改动。请独立查阅完整前序产物和 `git diff`，不要只根据此材料或已有测试结论投票。

最终四文件及 digest 见 evidence/source-digests.txt：

- src/commands/view.ts：完整候选引用目录、独立基线/候选规则投影、单引用失败隔离、只在 snapshot 内存活的 lookup、无 checkpoint 候选详情与无长期临时索引。
- src/memory/changeset.ts：detail callback 暴露 baseMemoryRoot，统一清理生命周期。
- modules/org.memsphere.memory/adapter/view/index.ts：目录分离与保持 change 的源命题跳转，解除 section=changes 的详情覆盖。
- test/view-responsive.test.ts：五个新增真实 HTTP/浏览器回归、独立临时候选 helper、稳定目标正文和双向来源切换断言。

## 冻结摘要之后的验证修正

前序功能实现摘要记录的是第一次开发结束状态。之后实际检查发现无 checkpoint 详情接口 400 和旧 DOM 瞬时断言问题，详见 verification-correction.md。现已复用 detail snapshot 支持该候选导航，所有一次性候选的 summary/full/detail 索引都不写长期缓存；测试及 playwright-cli 等待目标 canonical header 和实际正文，修正后整轮重新验证。

这是已确认验收 3 的补修，不改变范围。首次未完成的全量/旧浏览器日志保留，明确不作为最终通过证据。请同时核查本补修与已确认方案对候选/基线来源和缓存生命周期的要求。

## 验证与风险

verification-report.md 与 evidence/ 提供最终第二轮证据：受影响 31/31；全量 146 文件零失败；typecheck/build/Store validate 通过；实际展开/收起/目标正文跳转通过；12 次详情请求 GC 后堆快照没有保留的 disposable preview 路径。SHA256 结束复核全部通过。截图使用隔离 fixture，不等同于真实服务已发布。

## 第二轮修正

已接纳第一轮研发/架构发现的同一个缓存隔离问题：候选不写正式详情 cache，退出候选重载正式目录/详情，切换 Project 清空正式 cache。新增同应用实例中正式→候选→正式→候选→正式的稳定浏览器回归，正式标题/正文及目录来源均正确。采纳测试建议，保存完整可复跑 lifecycle 验证器并亲自复跑，通过。详见 implementation-revision-2.md。前序冻结验证产物是第一轮版本，本候选附带下面的完整第二轮验证报告，评审应按当前代码与第二轮证据判断。

无 Memory 差异，因此无 ChangeSet ID，未创建空记录。未执行生产发布、Human 验收、commit/PR/远端 CI；它们不作为本步骤已完成事实。当前无已知未修复阻塞，第三方 renderer 自行组织 UI、跨 Project 引用等仍在原后续范围外。

请分别从研发（代码一致性、边界和失效路径）、测试（反例、真实断言、两版本来源）、架构（snapshot 生命周期与组合契约）的独立视角审查，并区分亲自检查/复跑与仅引用的证据。发现非阻塞的可行动风险或建议也请正式记录。


# 第二轮完整验证报告

# 初始验证报告（本 Run 最终实现）

## 结论

当前代码满足需求契约验收 1–6、8。产品需求和方案均经 Agent 评审接纳；实现成果评审和 Human 最终需求验收仍待完成。未发布到正在运行的 View。

## 实际执行

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `node --import tsx --test test/view-responsive.test.ts test/memory-changeset.test.ts` | 31/31 通过 | evidence/affected-tests.txt |
| `npm run typecheck` | 通过，两个 TS project | evidence/typecheck.txt |
| `npm run build` | 通过，保留模型及 View 构建门禁 | evidence/build.txt；全量 npm test pretest 再次构建通过 |
| `npm test` | 146/146 文件，0 失败 | evidence/full-tests.txt，第二轮最终 elapsed 351.00s |
| `memsphere validate` | 当前 Project Store 通过 | evidence/store-validation.txt |
| `git diff --check` | 通过 | 实际执行，无输出 |
| playwright-cli 实际操作 | 合法未修改引用不标 missing；展开/收起/跳转；等待目标正文加载，全部通过 | evidence/browser-and-lifecycle.txt |
| 重复 detail 请求与堆快照 | 12 次请求后 GC，保留的 disposable preview 路径为 0 | evidence/browser-and-lifecycle.txt |
| 保存的生命周期验证器复跑 | 通过，临时脚本/快照清理，12 次请求无保留 preview 路径 | evidence/reproduce-lifecycle.mjs；evidence/lifecycle-reproduction.txt |

## 场景证据

- 未修改的目标命题：ChangeSet scope 仅 Procedure，目标仍合法、显示 2 条规则并可展开章节定义。
- 无效规范名称/别名引用：保留缺失提示且不显示虚假展开，不阻断主内容。
- 同字段混合合法与缺失引用：API 精确投影有效成员，UI 有效命题可展开，无效命题无 toggle。
- 同 ChangeSet 修改 Procedure 与 Statement：API 精确核对 baseline 的原 2 条规则和 candidate 的新 3 条规则，浏览器只展示 candidate 3 条、无 baseline 正文；点击仍读取同一 change 的 candidate 正文。重复三次 API 请求结果一致。
- 没有 checkpoint 的 View ChangeSet：复用完整 baseline candidate；稳定 canonical header 和目标规则正文确实加载成功。
- 正式/候选双向切换：同一应用实例先缓存正式内容、进入正文/标题不同的候选，再退出及往返；等待正确版本标题、正式目录响应和实际正文，确认正式目录无候选标题、正式详情无候选正文、候选详情无正式正文。
- 普通 Memory、现有 ChangeSet 差异和评论行为：完整受影响文件及全量回归均通过。规则投影继续被既有 diff 排除，原始声明/定位未修改。

## 失败、历史与环境

本 Run 初次 playwright-cli 发现无 checkpoint 的候选摘要 400，旧断言可能命中旧 DOM。这是本轮遗漏，不归为历史或环境错误；已修正接口并加强断言。首次全量执行因此主动停止（exit 130），保存为 evidence/full-tests-before-navigation-fix.txt，不计入最终通过结果。旧浏览器证据另保留为 evidence/browser-before-navigation-fix.txt。最终全量及稳定浏览器检查均在修正后重新执行。

前序会话的 146 文件结果未用来代替本 Run 验证。浏览器在宿主许可下运行，复用已安装本地依赖；最终没有未恢复的环境阻塞。

成果评审第一轮又发现候选详情污染正式缓存：已禁止候选写入正式缓存，在离开候选时重载正式目录/详情，并在 Project 切换时清空正式缓存。当前报告为第二轮修正后的最新 Workspace 报告；前序 Run 冻结的初始验证产物仍是第一轮 30 项版本。第一轮通过证据保留在 evidence/revision-1/，第二轮新增回归后重新执行 31 项受影响测试、全量回归、typecheck/build 和 playwright-cli，均通过。

## Memory 与未执行项

最终 `git diff --name-only -- .memsphere/memory reserved-memory src/skills` 无输出：无 Memory 交付差异，不创建空 ChangeSet；普通 validate 只作为当前 Store 健康证据。

未执行：生产 View 升级/发布、Human 验收、commit/PR/远端 CI（流程后续步骤）。尚未声称需求验收或最终交付完成。

## 可复核材料

evidence/source-digests.txt 记录本轮最终四个代码/测试文件 SHA256，验证结束时 `sha256sum -c` 全通过。evidence/changeset-reference-expanded.png 为隔离测试数据的真实 View 截图，展示有效引用与展开内容，不宣称是真实用户 ChangeSet 已发布后的页面。
