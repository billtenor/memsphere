---
id: 20260829-module-view-extension-architecture
type: documentation
created: 2026-08-29
run_id: run-20260829-114314z-01ce53e6
completed_at: 2026-08-29
---

# Module 与 View 扩展架构

## 需求

将现有以 View 模块为一级扩展单元的技术架构基线提升为 Module 架构，补充 Project、Module、Memory、CLI、View、领域逻辑和持久化之间的关系，并明确 Module 的三层目录设计。

## 范围

- 一个 Project 可以组装多个 Module 实例。
- Module 可以按需包含 Memory、CLI、View 和领域数据能力。
- Module 采用 Domain、Application、Adapters 三层。
- Adapters 包含 CLI、View、Persistence 三类适配器。
- 契约由拥有需求的内层定义，不单设 Ports 层或目录。
- 既有 ViewHost、Slot、独立编译、整体重启、无状态和 DSH 取舍继续有效。

## 不做事项

- 不实现 Module Manifest、Module Runtime、SDK 或数据协议。
- 不修改运行时代码、CLI、API、Memory 或持久化格式。
- 不实现插件热更新、第三方沙箱或常驻用户后台服务。

## 验收标准

- 架构文档明确 Project、Module、Module 实例和四类软件能力的关系。
- 文档包含 `domain/application/adapters` 三层目录和依赖方向。
- CLI 与 View 复用 Application、Domain，并操作同一份权威数据。
- Port 不被描述成第四层，防腐层不与 Port 混同。
- 原有 View 扩展结论完整保留并归入 Module View 子架构。
- 仓库规定的完整验证通过。

## 实现

- 将 `docs/view-extension-architecture.md` 重构为 Module 与 View 扩展架构基线。
- 新增 Module 三层目录、契约归属、双入口、浏览器到 Node.js Application 的边界说明。
- 更新总体运行结构、安装组装、无状态数据边界和后续设计清单。

## 验收结果

- 敏捷开发 Run `run-20260829-114314z-01ce53e6` 完成需求、方案、实现与三方验收；研发、测试和架构评审均通过。
- `git diff --check`、关键术语正反向检查通过。
- `npm run typecheck`、`npm run build`、`memsphere validate` 通过。
- `npm test` 在具备本地端口和子进程权限的环境中完整通过：509 通过、0 失败、1 个 Windows 专属测试跳过。
- Module Manifest、Runtime、SDK 和 Persistence 协议作为后续独立迭代处理。
