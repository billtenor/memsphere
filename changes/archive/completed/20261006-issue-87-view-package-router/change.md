---
id: 20261006-issue-87-view-package-router
type: bug
created: 2026-10-06
completed_at: 2026-10-06
run_id: run-20261006-142737z-c8d2dca6
github_issue: https://github.com/billtenor/memsphere/issues/87
---

# 独立 View Package Router 授权与页面入口

## 需求

正式可信本地 View Package 缺少 Router 声明与授权，独立 Module 无法 active；普通外部实例页面也缺少服务端直达入口。支持通过显式公开契约新增自身 Project/instance 范围的业务页面，并说明与 builtin/App 的能力差异。

## 验收标准

正式设置接口安装、校验、保存、启用并重启后，实例 active，导航、Header、列表和正文可用。直达、刷新、对象选择、关联跳转、前进/后退一致；拒绝冲突和越界路由。未安装、禁用、无授权及服务端资源失败返回 404；浏览器加载失败和未知路由保留 Shell 错误与诊断。既有展示扩展、builtin 和 App 不回归，双语文档同步。

## 技术与测试方案

新增 router.register capability，普通实例仅按有效声明获得 Router，themeOnly 去除该能力，App API 保持原有授权。服务端按启动快照匹配实例命名空间，复用 Runtime 的 Route Token 与事务，补强 URL 路径与 instance_id 校验。

新增真实 Package/HTTP/Chromium 自动化覆盖完整接入、导航、三类失败边界与路径拒绝矩阵，补充主题专用 capability 和实例 id 用例，并回归已有 View、builtin、展示扩展与 App。

## 开发任务

- [x] 理解确认、根因与测试缺口分析。
- [x] 两轮修复方案评审并落实测试意见。
- [x] 核对代码候选、同步双语文档、补充自动化。
- [x] 正式验证与需求负责人/研发/测试最终验收。
- [x] 合并最新 master（dcfe4ec），无冲突。

## 验收结果

Memsphere Run 已完成，需求负责人、研发、测试及 Runner 均通过。正式本地验证：类型检查、构建、diff 检查和 210/210 项相关回归通过；具体证据与限制见 verification-summary.md、verification-record.md、verification-evidence.json 和 completion.md。

用户随后授权提交 PR 并跟进全部 CI。合并后的验证与远端 CI 属交付跟进，不改写已冻结的 Run Submission。Linux/Node 22 的公共接入实测不代表 CRAA 私有业务验收。
