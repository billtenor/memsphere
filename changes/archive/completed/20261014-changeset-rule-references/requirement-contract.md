# 当前迭代需求契约

## 整体目标

用户在 ChangeSet 页面查看 Procedure 步骤的命题引用时，应能够正确识别引用是否可用，并在原位查看命题的生效规则。截图中的有效引用不应因目标命题未在本次变更范围内而显示红色删除线、失去展开能力。

## 当前迭代范围

- 修复 ChangeSet 引用存在性判断，使其基于该 ChangeSet 完整候选 Memory 快照，而非仅以本次变更项作为引用范围。
- 为候选内容加载引用命题的生效规则；用于比较的基线内容从相应基线快照加载规则，避免混用版本。
- 有效步骤引用支持原位展开和收起规则；点击引用进入同一 ChangeSet 的候选命题详情。
- 真正缺失、错误规范名称或无法解析的命题引用不伪装为可展开，不阻断其余 ChangeSet 内容的阅读和评审。
- 普通已发布 Memory 引用行为、ChangeSet 评论定位和差异含义保持现有契约。

## 后续范围

跨 Project 引用、别名规则变更、规则编辑交互、引用错误诊断产品设计不在本轮范围。正在运行的 View 升级发布另行安排，本轮交付可审核 PR，最终合入由 Human 操作。

## 交付物

修复代码、自动化回归测试、需求/方案/开发任务/实现与验证材料、经过评审且适用 CI 全通过的 GitHub PR。

## 验收标准

1. ChangeSet 仅包含一个引用命题的 Procedure 时，未修改的有效目标命题不显示 missing/红色删除线。
2. 步骤引用显示正确生效规则数量；展开后可见规则正文、命题章节和章节定义，收起后正文隐藏。
3. 点击目标命题跳转后 URL 保留当前 ChangeSet，详情读取候选快照；来自 changes 导航时也能展示详情。
4. 真正无效的引用仍被标记不可用，没有虚假的展开内容；ChangeSet 主体可正常显示。
5. 原始声明、评论定位及语义 diff 不因附加的有效规则投影而改变；普通 Memory 详情回归通过。
6. 通过 typecheck、build、相关 View/ChangeSet 自动化测试、npm test 全量回归、memsphere validate，并用 playwright-cli 实际操作展开、收起和跳转。
7. 产品 Agent 确认需求，研发/架构/测试 Agent 评审方案与成果；交付报告阶段仅 Human billtenor 执行最终需求验收。此前不要求用户参与常规评审。
8. 同一 ChangeSet 同时修改引用方与目标 Statement，使基线和候选目标的规则正文及数量不同。分别断言 API/比较内容中的基线投影只包含基线规则、候选投影只包含候选规则；候选 UI 展开的正文和数量仅来自候选版本，点击目标仍进入该 ChangeSet 的候选详情。比较页对未修改的声明不强行展示双栏，旧版投影通过 API 独立核对。

## 向前兼容

结论：不需要向前兼容。当前仓库没有名称包含 stable 的 Tag，因此不存在适用稳定 checkpoint。仍保持当前 YAML/CLI 声明、普通详情行为及既有差异和评论契约；API 只增加引用目录与只读规则投影字段。

## 采用的 Statement

- memsphere-repository-requirement-rules：独立向前兼容决策、stable checkpoint 范围。
- memsphere-repository-testing-rules：真实行为回归、浏览器实际交互、全量验证、如有 Memory 差异则变更级校验。
- memsphere-repository-development-rules：以实际产品问题为边界，避免过度设计，保持文档一致。
- memsphere-repository-delivery-rules：验收后更新状态并归档，Memory 差异必须匹配最终校验记录。
- memsphere-yaml-syntax-rules：!ref target 使用 canonical 逻辑引用，不接受 alias；生效规则按对应 asserts/suggests channel 递归保留命题 sections。
- memsphere-memory-access-rules：View 在引用处展开有效规则，保留源 Statement 入口；展示投影与原始 Memory 声明分离。

## 待确认项

无。用户已明确 ChangeSet 场景，并要求只参与最后验收。实现可采用前序待审修复，但须经过本 Run 的独立评审与验证；任何扩大或缩小本契约范围的变更仍须先取得 Human 确认。
