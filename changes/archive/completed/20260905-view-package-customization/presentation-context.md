# Presentation Context 所有权与最小契约

本文件冻结实现前边界。类型名可在落地时按现有模型收窄，能力不得扩成原始 fetch、可写 store、私有 DOM 或 Review 状态机。

## Memory page

- Host/官方保留：Route 注册与 URL、Memory API 调用、筛选状态、实体选择和错误恢复。
- 只读数据：通用 mount `route`，以及 `presentation.memoryPage()` 返回的冻结 `filters`、`items`、可选 `selectedReference`。
- 受控动作：snapshot 上的 `refresh()`、`openMemory(reference)`、`openCreate()`；后者只打开官方拥有的创建/导入入口，不向替换页开放写 store。
- 自定义范围：页面 presentation；不得改写 canonical reference 或 ChangeSet/Review 规则。

## Memory detail renderer

- Host/官方保留：kind 解析、canonical reference、section 查询、ChangeSet/Review 关联入口。
- 只读数据：`reference`、`kind`、`title`、冻结的 `metadata` 与 `sections`。
- 受控动作：`openChangeSet(id)`、`openReview(id)`、`copyReference()`；官方 `defaultRender()` 只用于失败回退。
- 自定义范围：详情正文；官方业务入口保持可用。

## Run page

- Host/官方保留：Route 注册与 URL、Run API、状态筛选、Run 选择和刷新语义。
- 只读数据：通用 mount `route`，以及 `presentation.runPage()` 返回的冻结 `filters`、`runs`、可选 `selectedRunId`。
- 受控动作：snapshot 上的 `refresh()`、`openRun(id)`、`startRun()`；后者只打开官方拥有的启动入口，不向替换页开放 Run store。
- 自定义范围：页面 presentation；不得直接修改 Run 状态。

## Run Artifact renderer

- Host/官方保留：Artifact 获取、稳定 material identity、Artifact Review overlay、Round/Vote/Assignment 状态机。
- 只读数据：`runId`、`artifactId`、`type`、`format`、`title`、`content` 与冻结的 `metadata`。
- 受控动作：`download()`、存在 review 时的 `openReview()`；官方 `defaultRender()` 只用于失败回退。
- 自定义范围：Artifact 正文；Review overlay 与操作壳始终由官方贡献。

## 共同约束

- 数组和记录在跨 presentation 边界前冻结；外部候选不可取得内部 mutable 引用。
- action 是官方 controller 的最小包装，错误遵循现有用户可见反馈。
- page presentation 的同步 throw、异步 reject 或 update 失败只让该 candidate abdicate；Runtime 清理其 mount/portal/subscription 后选择下一候选。data renderer 是同步契约，返回 thenable 视为非法并立即让位，同时消费后续 rejection。
- diagnostics 记录 package/source/version/cell/state/error/`fallbackTo`，不暴露秘密、绝对路径或内部对象。
