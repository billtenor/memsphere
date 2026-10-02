# 实现评审第 2 轮意见处置

Review：`review-20261001-071900z-a1fe7c7d`；轮次：`round-20261001-072543z-6ed381b7`。Runner 已完整读取三位 Reviewer 的摘要、Comment 与 Vote。

## 绝对 `$id` 与文件 ModelId 的身份映射

研发意见 `comment-20261001-072809z-6ff9481f` 的失败复现成立，但所要求的本地 URI→文件映射超出已经批准的方案。处置：`rejected-out-of-scope`。

实施方案第 3 节明确：逻辑 ID 与文件相对路径一致；跨模型依赖按精确 ModelRef；缺失依赖显式报错；**不新增 HTTP schema 下载或 `$id` 别名解析器**。当前候选、实现摘要和第 2 轮修订均保留这些边界。

复现中的依赖身份为 `https://example.test/value.json`，目录中真实模型身份为 `value.json`，不是同一个 ModelRef。底层 Factory 可以访问 Registry 已精确登记的绝对 URI Runtime，不表示 Project 已承诺通过定义里的 `$id` 自动登记另一份身份。公共 Registry 按 `descriptor.id` 登记；Factory 返回的 `descriptor.id` 必须等于 `model.data.id`，本轮也未改变该协议。

当前行为按方案显式报 `No model binding: https://example.test/value.json`，而不是把不存在的精确引用静默重写为某个文件或访问网络。列表 `available` 表示定义可读取/元模式合法，不承诺整个业务 Runtime 已创建，方案与页面都明确这一区别。

补独立反例回归，确认两份定义可浏览、被引用的标量模型自身 Runtime 可用、URI 身份缺失时报上述明确错误；已有不带 URI base 的文件精确引用正例继续通过。不增加 Runtime API、别名规则、文件格式或降低当前验收标准。若未来引入 `$id` 作为模型身份或别名，需要另行讨论冲突、重名、路径与版本规则，不由本轮施工决定。

## 原生跨平台执行

测试风险 `comment-20261001-072753z-d3987ebb` 接纳为已披露的非阻塞风险，后续发布由仓库跨平台 CI/人工冒烟验证。本轮仅 Linux 实跑，Windows-only 按条件跳过，不把可移植实现声明为三平台实测，不隐藏该风险。

## 复验

意见反例加入 `test/project-models.test.ts`，受影响元模型/Project 模型 14/14 通过；`npm run typecheck`、`git diff --check` 通过。完整 `npm test`（含构建）825 项，824 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过。最终 Memory ChangeSet validate 再次通过，digest 未变；Project validate 通过。

本轮没有再修改实现代码，只补已确认范围边界的独立反例和意见处置证据；第 2 轮冻结 Submission 原状保留。上述意见、残余风险与最新验证将在交付报告中完整披露，不将研发建议票要求修改伪装为三方一致通过。
