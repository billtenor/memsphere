---
id: 20261007-public-model-definition
type: feature
created: 2026-10-07
completed_at: 2026-10-07
run_id: run-20261007-042151z-c97a197e
issue: https://github.com/billtenor/memsphere/issues/90
---

# 公共只读模型定义展示

## 需求
独立 View Package/App 使用公共 UI factory 复用官方模型结构与原文，模型读取、爬取规则和路由保持独立。当前迭代覆盖共享组件/主题、renderer fallback、多实例、独立路由示例和文档。

## 向前兼容
结论：不需要向前兼容。本地与远端均未发现 stable Tag checkpoint。新增 ViewUi v1 方法，保持旧 renderer Slot、Route、API、数据层和模型文件行为。

## 验收标准
官方/外部默认数据与样式一致；无 Models 实例也能渲染；structure/source、raw/unsupported/不可用明确反馈；冻结 Slot 输入和异常回退；多实例、语言/主题、键盘/窄屏、卸载正常；文档与 Memory 同步；完成类型检查、构建、全量回归、Playwright 实操、Memory 双校验。

## 技术与测试方案
树表与组件样式迁入 Host UI；ui.modelDefinition 接受定义快照并提供默认渲染，Runtime 包装旧 Slot 并保证无候选时最后回退。Host locale 传入工厂，descriptor locale 优先。新 ESM 依赖由 View 资源服务提供。targets 示例显式声明 router.register 和 main.view contribution。实际方案和评审保存在 Run 的实施与验证方案产物。

## 开发任务
公共 factory、共享 CSS/资源、Runtime 集成、官方 Models 迁移、独立示例、双语文档/Memory/Skill、浏览器测试与完整验证。

## 验收结果
当前实现已通过 npm run typecheck、npm run build、npm test（140 文件全部通过）、Playwright CLI 正式 Shell 实操、memsphere validate 与 Memory 变更级校验。研发、测试、架构与产品 Agent 评审均已通过，Runner 已接纳交付报告。

Memory ChangeSet：change-20261007-050527596z-2020fc3e；validation passed；View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261007-050527596z-2020fc3e 。
