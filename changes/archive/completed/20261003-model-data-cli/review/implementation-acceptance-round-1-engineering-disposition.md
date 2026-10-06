# 研发 Agent 测试环境意见：修复依据

日期：2026-10-05（Asia/Shanghai）。
Run：run-20261003-090655z-f1e492f6。
Review：review-20261005-034612z-e11cf3b0。
Round：round-20261005-034612z-aa5a54fb。
Comment：comment-20261005-035653z-329a9ac8（traex2）。

接受该问题：原有 fake launcher 测试继承执行者的 ACP Session 环境，断言没有包含产品 guard 正确注入的 Project 参数。在修正前实际复现退出 1；修正测试环境隔离后保留原有权限断言，并增加真实 Session manifest、Project 与普通/冻结 Memory 作用域验证。未修改产品 guard 或放宽访问范围。

将宿主 MEMSPHERE_* 清除后，只注入不含真实凭据的合成 ACP Session，再执行同一完整串行门槛。最终命令、退出码、数量和日志哈希见 implementation-acceptance-round-1-fix-validation.md 与 ../review-verification-results.json；只有门槛全部通过后提交本处置为 accepted-fixed。

原始研发 Vote 和 Comment、初始全量日志、第一次复现和新增 fixture 修正过程全部保留。Human 对第一轮实现的通过票无需重写，补充范围为验证修复及已批准目录契约的解释，没有新增产品或架构决策。
