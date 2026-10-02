# Project 模型存储与模型界面：交付报告

历史报告：本文件保留第 1 轮交付及后续本地摘要。Human 已正式要求修改，重新提交的完整候选见 [交付报告第 2 轮](delivery-report-round-2.md)；本文件中的旧测试数、试用步骤和结论不作为当前验收材料。

Run：`run-20261001-054855z-53c67dce`。分支 `codex/project-models`；基线 `9766bdb6a85c42610a08fed1945a1e06303c5e98`。

试用后的展示修订与验证见 [模型树表反馈修订](ui-hierarchy-revision.md)：紧凑树表、数组根与结构节点、动态字段、格式与枚举、独立规则列、联合分支、本地引用展示和自动说明清理。模型模块已补齐整体页面与定义正文两个可配置 Slot，沿用记忆/运行的选择和内置回退机制；扩展通过只读官方服务加载模型，不改变模型定义、存储、路由或业务验证。

最新 typecheck、build、受影响回归及浏览器实测通过。全量 npm test 为 858 项、857 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过；Memory ChangeSet validation passed，digest `c085756a7ddfb91552e7532ff98d695f7f074ecef61129b8c2e9dabe03a7d4ab`。下文保留第 1 轮冻结报告的原交付事实，不将旧评审票解释为已经评审本次修订。

## 交付内容

- Project JSON Schema 模型定义存入现有 filesystem DataStore，保存可读 JSON，ModelId 为 `sales/order.json` 这类相对文件路径；不加记录封套、编码或索引。
- 独立 Draft-07 元模型扩展引导、Project DataManager 装配、完整分页和单项坏定义隔离；同一字节快照用于加载模型及展示原文，保留 BOM/空白/CRLF。
- 项目设置新增“模型存储”，支持默认、相对、绝对目录；相对目录以登记的 Project root 解析。保存确认、校验、放弃、刷新生效，不搬文件、不改 Home 或其他 Project 配置。
- 正式“模型”模块与记忆/运行并列，真实列表、四个内置 raw 业务模型、树形字段表、逐级展开数组/对象、所属对象必填、原始定义/复制、筛选与状态反馈。
- 真实 Project-scoped API、双语、窄屏、迟到响应隔离、卸载清理；没有模型详情中的 Project 设置入口。原型与正式模块分开，样例不混入真实列表。
- README、数据实现文档、System Memory 源及开发副本、Skill 和自动化测试同步。

未改 `src/data/api`、Run 状态或内容布局。全部修改仍未 stage/commit/push，用户原有 `.vscode/`、`review-summary.md` 不纳入本轮。

## 实际验证

最终 `npm test`（含构建）825 项：824 通过、0 失败、1 项既有 Windows-only 在 Linux 条件跳过，退出码 0。元模型/Project 模型受影响组 14/14；真实模型 View 浏览器套件 14 项包含在全量回归中。typecheck、构建、diff check、Project validate 与最终 Memory ChangeSet validate 通过。

playwright-cli 在隔离 on-disk Home 的真实生产 ViewHost/Shell/Modules 操作桌面/窄屏、树表、复制、筛选、错误重试、卸载、目录保存/放弃/切换和真实 Home 语言保存，结果 passed、pageerror 为 0，截图已逐一检查。当前用户 View 已切换到工作区构建，正式模型页与内置详情只读核验正常；没有安装测试模型或改用户设置。实际 Home Settings 沿用既有凭据保护，未授权的隔离浏览器返回 401，是既有权限门禁，不是新增模型错误；设置授权操作在隔离 Home 完成验证。

执行/修正历史详见 `initial-validation.md`、`implementation-revision-2.md`、`implementation-review-dispositions.md`。完整工作区文件映射见 `implementation-summary.md`。

## 评审与验收结论

产品第 2 轮需求/原型和三方技术方案已经确认；这不是正式产品交付验收。

实现 Review `review-20261001-071900z-a1fe7c7d` 共两轮，最终轮 `round-20261001-072543z-6ed381b7`，三位实际 ACP Reviewer 均提交，Runner 正式通过：

- 测试、架构通过；研发要求加入绝对 `$id` URI→文件模型身份映射。
- Runner 对照已批准方案“不新增 `$id` 别名解析器”，正式 `rejected-out-of-scope` 处置研发意见，并补实际反例测试：定义可浏览、目标模型自身 Runtime 可用、不存在的精确 URI ModelRef 明确失败，不下载网络资源。没有偷偷引入别名或改变 ModelId。不能将本结果描述为三方一致通过。
- 第一轮的宿主 URL 异常、原文 BOM 问题已修正并复验；相对 `$id` 保持原 Factory 的明确不支持边界，不扩展编译器子集。
- 原生 Windows/macOS 未实跑风险接纳并保留，后续发布由跨平台 CI/人工冒烟验证；本机 Linux 验证不能替代三平台实机证据。

当前功能符合已确认范围，无剩余范围内阻塞项，提交产品负责人交付验收；尚未收到本报告对应的 Human 正式验收票。需验收通过后才更新完成状态、归档需求并进入 commit，随后由 Human 决定是否创建 PR。

## 产品试用

当前正式入口为 `/projects/memsphere/models`；设置为 `/projects/memsphere/settings/models`，不是 model-prototype。本地 View：[模型页面](http://127.0.0.1:30000/projects/memsphere/models)、[模型存储设置](http://127.0.0.1:30000/projects/memsphere/settings/models)。用户先前的转发入口也可使用相同路径 `http://localhost:62776/projects/memsphere/models`。

当前真实 Project 未安装业务 JSON Schema 文件，所以列表只显示四个真实内置 raw 模型。它们没有字段树，不能用它们验收订单字段展开。原型仍可查看，但不代表真实持久化数据。

如要亲自试用实际订单模型：

1. 在项目模型存储设置中查看解析后的目录。
2. 将需求目录的 `assets/order.example.json` 另存/复制到该目录下的 `sales/order.json`，保持 JSON 原文。本报告仅提供示例，不自动写入用户 Store；示例已直接通过现有 JSON Schema Factory/订单值反射检查。
3. 回到正式模型页刷新，选择“订单”，展开 `items → 数组元素`，检查字段、必填与说明；切到原始定义并复制核对。
4. 检查模型列表筛选，以及项目设置保存/放弃。变更目录只切换，不自动移动旧文件；Settings 使用既有操作凭据。

完整试用无需新增模型 CLI 或网页编辑器。模型分域留待当前迭代结束后再讨论。

## Memory 最终证据

交付前再次检查源与开发副本一致，最终内容未再修改：

- ChangeSet：`change-20261001-065614910z-18de9f8c`，active，validation passed。
- Base：`9766bdb6a85c42610a08fed1945a1e06303c5e98`。
- Content Digest：`59d901b23ad5a33cb2e5c94652e040716c9fdd07c4d921b1c3b007aebb1a9cb2`。
- [Memory 候选差异](http://127.0.0.1:30000/projects/memsphere/changes/change-20261001-065614910z-18de9f8c)。

按 `statements/memsphere-repository-delivery-rules` 执行：Human 验收前不移除 active status、不写完成时间或归档。普通 validate 不替代上述变更级校验。

## 后续范围与残余问题

模型分域、网页编辑/创建、数据值实例、Run 状态建模、Schema 完整反射、URI 别名/网络加载、索引、迁移和云存储均不属于本轮。filesystem 列表仍按目录扫描；复杂条件在树表提示查看原文，不宣称完整语义展平。Windows/macOS 原生验证尚未执行，作为非阻塞发布风险保留。
