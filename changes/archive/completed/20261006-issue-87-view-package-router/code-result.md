# 代码修复结果

## 审批与实施

本 Run 的理解摘要第一轮已通过；修复方案第二轮 review-20261006-143135z-599f6f4f / round-20261006-143348z-c62ece76 获研发、测试通过，Runner 已接纳。

方案通过后重新逐项审阅当前未提交代码与 Git HEAD 差异，确认上一轮草案已经实现获批方案的代码部分，保留这些改动作为正式候选实现，不制造无意义重写。评审要求增加的用例在下一个测试步骤补齐。

## 最终代码行为

src/view/package-config.ts 新增 router.register capability，并禁止实例 id 为 . 或 ..。普通 Package 保持默认最小服务集合，只有有效声明才获得 Router。

src/module/package-registry.ts 对 themeOnly 实例移除 router.register，有效能力不会通过主题选择启用禁用业务页面。

src/commands/view.ts 在 App 授权之外增加有效 router.register 的普通实例 Router 授权；api 仍只授予 App 绑定实例。正式 HTTP 页面入口使用当前 Project 启动快照中该实例的有效 Router 服务，匹配 `/modules/<encoded-instance-id>` 或其带斜杠后代，不误认相似前缀。启动资源注册失败返回的 loadError 实例没有 allowedServices，因此没有此页面入口。

src/view/view-runtime.ts 复用 Module 实例路由基路径、Route Token、激活条件、事务冲突检测和回滚。在 path 校验中解码每个段，拒绝 . / ..、编码分隔符、反斜杠、NUL 和非法编码，防止 URL 归一化破坏实例范围。

双语指南/API 同步描述独立业务 Package 的显式能力、页面贡献声明与失败边界；App 和 builtin 的既有契约保留。

## 当前证据与后续验证

实施核对来自源码、git diff 与前述审批；此产物不宣称最终测试已经完成。正式流程后续将补齐缺失 entry、启动资源类型拒绝、浏览器加载失败和完整路径输入矩阵，然后执行获批构建、类型检查和相关回归。

本次没有 Memory 修改，不创建空 ChangeSet。代码尚未 commit、push，未创建 PR，未改变 issue 状态。
