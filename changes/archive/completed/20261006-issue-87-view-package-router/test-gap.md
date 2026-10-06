# 测试缺口分析

## 既有自动化为何未暴露问题

基线的 test/view-package-browser.test.ts 重点验证正式安装、主题、样式和 Memory/Run 展示替换。示例 Package 使用 portable presentation cells 与 presentation 服务，依赖已有 builtin 路由，不要求获得普通外部 Router 或新增自己的页面入口。它能证明“替换已有展示”可用，不能证明“新增业务 Module”可用。

test/view-host-composition.test.ts 和其他 ViewHost 测试直接构造 Host 实例或内置 routeGrants，验证 Router/Slot 事务及导航。它们绕过 externalViewInstances() 正式计算的普通外部服务 allowlist，不会发现安装路径的授权缺口。

App 验证使用 App 绑定实例，原实现本来就给予 App Router 与 appPage 页面入口，因此 App 成功也不能覆盖普通外部 Package。

Package registry/config 测试验证样式能力、Manifest、组合排序、资源隔离与选择，不验证普通 Router capability 与服务授权、themeOnly、正式 HTTP 页面入口的一致性。

文档测试验证双语章节结构和关键词，不能证明独立 Module 示例在正式 Package 授权下可以加载。

## 需要覆盖的组合边界

新增自动化使用真实 module.json + ESM、resolveViewPackageComposition、createViewServer、正式设置接口及 Chromium，不手工构造已授权 Runtime 实例。

1. 从未安装状态经设置 validate/PUT 保存，重启前路径仍 404，重启后实例 active 并能直达页面。
2. 从菜单进入独立页面，公共 Header/list/main.view 正常组合。
3. 对象 query 选择、关联跳转、刷新与浏览器前进/后退一致。
4. 未声明 router.register 的 Plugin 在 apply 前明确失败，其路径为 404；禁用/未安装/未知实例和其他 Project 路径不可借用授权。
5. 获授权实例的未知 route，以及 Plugin 路由冲突/越界加载失败，在 Shell 内明确报错；失败事务不留下自身路由。
6. 字面和编码点段、反斜杠等 URL 归一化风险输入拒绝；instance_id 点段不能通过配置校验。
7. 仅选择禁用 Package 的主题不授予新 Router 能力。
8. 保留既有正式展示替换、builtin、development、Project 切换与 App 用例作为回归保护。

## 验证边界与报告要求

自动化能够覆盖 SDK/Host/正式 Package 接入契约，不替代 CRAA 私有业务端到端验收。报告须区分受支持 Node 22/Linux 实跑、Windows/macOS 未执行，以及真实用户 Package 尚未复验。前一轮草案已完成的测试只作为历史证据；正式流程验证阶段应给出当前最终内容对应的验证记录。双语文档新增章节需同步英文版，不能通过放宽原检查解决。
