# 开发计划

Run：run-20261027-134406z-6b0c9b5a。需求与方案第1轮已通过；方案研发/测试/架构建议全部采纳。

1. 创建本轮 codex/ 分支，保留已有候选和无关 .playwright/。
2. finish 仅接受 --authorization <text>；CLI和Continue共用非空校验及结束行为；移除旧候选note/file入口。
3. 同步Skill、两份用户文档与Run Concept/自由探索规则Statement的reserved源、Embedded副本；不改Procedure Review参数、不新增数据存储或状态。
4. 拆出CLI授权契约集成测试：双入口缺失/空白拒绝并保持状态与成果，旧参数拒绝不绑定领域错误码，之后可反馈修订并授权结束；Help及Skill/Memory指引覆盖。
5. 订正change.md：旧候选方案和旧测试明确标为历史；主方案、任务和验收状态以本轮 --authorization 及重新执行结果为准。
6. 构建后先受影响集成/模块测试，再typecheck、npm test全量、build、memsphere validate、最终memory change validate；记录当前ChangeSet及View入口。
7. 上报功能摘要、初始验证及实现验收材料，处理评审意见；完成后提交产品负责人验收。
8. 交付时按Git规则核对暂存及新增文件忽略规则，.playwright/、/tmp日志和运行原始证据不提交；只提交本轮实现/可复用测试/必要文档/Memory。按正式流程创建PR、核验CI并等待Human合入与结果确认。

测试建议落实：旧参数只断言可观察拒绝及状态不变，缺失/空白才断言HUMAN_CONFIRMATION_REQUIRED。abandon的Human明确决定约束保留并检查。
