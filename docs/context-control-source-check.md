# 实施验收第2轮：Run来源检查修复

Review：review-20261024-120001z-b3cc3d7b，Round：round-20261024-122617z-e32fad96。

研发提出 comment-20261024-123158z-8c00025b，并以 comment-20261024-123221z-288708d0 补全因Shell转义丢失的定位；两条描述同一缺陷。原正文/下载端点直接读取新Store，未像详情端点检查新旧同ID冲突。

已将来源解析集中为 `contextRunForView`，在共享 `/api/runs/:id` 请求入口选择具体操作之前执行。详情、正文、下载和旧Run操作共用该检查；同ID存在于旧当前或归档Run和模型Store时明确报错，不返回正文，不更改旧Run；没有Project上下文的旧接口保留原能力，实际Store故障不当成来源缺失。

新增 `test/context-control-view.test.ts` 使用真实模型Store、真实旧Procedure Run和HTTP：覆盖旧当前/归档双来源的详情、正文和下载拒绝，断言没有正文或下载响应头泄露；覆盖冲突时废弃请求不改变旧Run；覆盖无冲突新Run的正常预览与原文下载。

- 直接HTTP及旧View兼容定向验证：7项通过。
- 新产物图及旧正式评审浏览器集成：20项通过。
- typecheck及diff检查通过。
- 最终 `npm test -- --test-concurrency=4`：157文件全部通过，1319项中1317通过、2项Windows专属跳过、零失败、零取消，236.16秒。
- 含修复的实际npm包重新独立安装，九条命令通过。

最终结果：/tmp/context-control-source-check-test-results.json；完整日志：/tmp/context-control-source-check-full-tests.log；独立包：/tmp/context-control-source-check-package-result.json。Memory没有后续修改，已验证checkpoint仍为15b2bf478a08534c275edb3772c2d3f7747b3385d69af72099b13abfd784139e。

当前Review尚未作出Runner决策。这是已确认来源约束下的实现修复，Runner将以accepted-fixed记录当前轮意见处置及验证，不回写Reviewer投票或Human已提交的通过票。后续交付材料附带本修复与最终验证结果。

## Runner 对再次提交要求的判断

实际比较了本轮不可变Submission与本地验收材料：字节一致，sha256为ca9296b0c01532b4db6ca580d9c6cf4e5a2f7c3cf1fd230e168ccb40363e875f。没有覆盖历史Submission或把新统计伪装成旧材料的内容；旧156文件统计保留为当时验证记录，最终157文件结果通过当前轮正式Runner意见处置追加，并在交付报告中汇总。

本步骤的既定验收对象明确包含“当前工作区代码改动”，Reviewer需独立查阅实际代码；现有Review没有冻结Git代码树的机制。本轮修复完成已确认的来源冲突约束，不涉及需求或授权范围变化。当前轮也尚未形成要求修改的整体决策；Agent为建议票，Runner负责阅读和处置意见后最终决策。故代码缺陷按accepted-fixed关闭；要求为相同需求内修复另起一轮的流程建议不作为阻塞，不再次索要已提交的Human通过授权。若有需求变化或未解决功能问题，仍须按流程处理。
