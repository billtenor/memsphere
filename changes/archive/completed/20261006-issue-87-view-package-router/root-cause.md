# bug 根因分析

## 基线与草案

分析基线为当前 Git HEAD，使用 `git show HEAD:<path>` 区分原实现与尚未提交的修复草案。正式 Run：run-20261006-142737z-c8d2dca6，bug 理解摘要第一轮已获需求负责人和 Runner 通过。

## 根因一：普通外部实例缺少公开 Router 授权契约

src/commands/view.ts 的 externalViewInstances() 为外部实例生成 allowedServices。基线只在 apps.has(instance.instanceId) 时添加 api/router，普通可信本地 Package 只能使用 slots/theme/presentation/ui 及条件授予的 themeRegistry。

src/view/view-runtime.ts 的 validateServices() 在 plugin.apply() 前检查每个 inject 服务是否获得有效授权。Router 是 Runtime 支持的服务，但普通外部实例没有该 grant，因此稳定返回 issue 中的错误。这是正确执行了较窄的 Host 授权，不应删除授权校验或对特定包开后门。

src/view/package-config.ts 的 capability 枚举只有主题和样式类型，普通包无法通过正常 Manifest 声明获得 Router。docs/view-plugin-guide.md 展示 Module 的 Router 编程方式，并介绍正式本地 Package 安装，却没有说明授权差异，造成公开使用契约与实际入口不一致。

## 根因二：正式普通外部实例没有服务端页面入口

基线服务端 handleRequest() 的 GET 页面分支只接受 isViewPagePath() 的 core/builtin 路由、显式 developmentPage，或拥有 appApiBase 的 appPage。即使只修复 Router 注入，普通外部实例的 `/projects/<project>/modules/<instance>/...` 仍不满足入口条件，无法在直接打开或刷新时得到 Shell。因此需同时修复服务端入口，不能把原报告的 404 仅解释为浏览器 Plugin 加载失败。

## 可复用边界及伴随校验

Runtime 对没有内置 routeGrants 的实例使用 moduleRouteBase()，把 Module 相对 path 拼接到编码的 Project/instance 基路径；Route Token、RouteActivation 及注册事务可直接复用。路由重复、Slot 注册失败会阻止整个实例提交。

放开普通包的显式 Router 能力后，应保证路径拼接不能被 URL 标准化绕过。原 validateRouteDefinition() 只拒绝字面 `..`、? 和 #，遗漏编码的点段和反斜杠；instance_id 原允许 . 和 ..。草案针对这些可导致 URL 归一化离开预期路径的输入增加拒绝。

Package resolver 会为仅供选中主题的禁用 Package 派生 themeOnly 实例。不能让新声明的 Router 能力沿此通道启用业务页面，应从 themeOnly 有效 capability 中移除 router.register。

## 修复原则

增加可声明的 router.register，只向有该有效能力的普通实例提供 router。App 的既有 Router/API 授权保持兼容。服务端仅为启动快照中获 Router 的 Project 实例命名空间提供 Shell，具体 route 仍由浏览器 Runtime 注册和匹配；其他路径保持 404。不得无条件扩大权限、硬编码业务包，或把展示用 presentation 服务误当作通用业务 Router。

本分析为代码因果核对；正式验证阶段将以真实 createViewServer、Manifest、设置接口和浏览器组合自动化验证，明确记录受支持 Node 22/Linux 与未实测平台。
