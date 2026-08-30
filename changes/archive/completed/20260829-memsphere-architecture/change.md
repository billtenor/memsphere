---
id: 20260829-memsphere-architecture
type: documentation
created: 2026-08-29
run_id: run-20260829-123908z-b5342e34
completed_at: 2026-08-29
---

# Memsphere 总体架构

## 需求

形成 Memsphere 总体架构基线，明确 Memsphere Core、Project 与 Module 的边界，补充 Memory、CLI、View、领域逻辑和持久化之间的关系，并明确 Module 的三层目录设计。

## 范围

- 一个 Project 可以组装多个 Module 实例。
- Memsphere Core 提供 Project、Memory、Run、Review、ChangeSet、Module Composition、CLI Host 与 View Host 等稳定平台能力。
- Memory 保持为 Project 级语义资产，沿用既有结构独立组织，不进入 Module 目录或打包生命周期。
- Module 可以按需包含 CLI、View 和领域数据能力。
- Module 采用 Domain、Application、Adapter 三层。
- Adapter 包含 CLI、View、Persistence 三类适配器。
- Memsphere 内置 Module 的源码统一放在仓库根目录 `modules/`，与 `src/` 中的 Core 分离。
- 契约由拥有需求的内层定义，不单设 Ports 层或目录。
- 既有 ViewHost、Slot、独立编译、整体重启、无状态和 DSH 取舍继续有效。

## 不做事项

- 不实现 Module Manifest、Module Runtime、SDK 或数据协议。
- 不修改运行时代码、CLI、API、Memory 或持久化格式。
- 不实现插件热更新、第三方沙箱或常驻用户后台服务。

## 向前兼容

结论：不需要向前兼容。

本轮只修正尚未合入 master 的架构文档定位和路径，不修改稳定 checkpoint、运行时行为或公开 API。

## 验收标准

- 架构文档明确 Project、Memory、Module、Module 实例和四类软件能力的关系。
- 文档包含 `domain/application/adapter` 三层目录和依赖方向。
- 文档明确内置 Module 的源码目录及其与 Core 的边界。
- CLI 与 View 复用 Application、Domain，并操作同一份权威数据。
- Port 不被描述成第四层，防腐层不与 Port 混同。
- 原有 View 扩展结论完整保留并归入 Module View 子架构。
- 仓库规定的完整验证通过。

## 实现

- 将原 `docs/view-extension-architecture.md` 重命名并重构为 `docs/architecture.md`，作为 Memsphere 总体架构基线。
- 新增 Memsphere 的系统定位、总体边界，以及 Core、Project、Module 的全景关系。
- 新增 Module 三层目录、契约归属、双入口、浏览器到 Node.js Application 的边界说明。
- 明确 Memory 保持为 Project 级资产，将外层目录统一命名为单数 `adapter/`，并为内置 Module 约定仓库根目录 `modules/`。
- 更新总体运行结构、安装组装、无状态数据边界和后续设计清单。

## 验收结果

- 敏捷开发 Run `run-20260829-114314z-01ce53e6` 完成初始架构内容；定位修正 Run `run-20260829-121532z-a9ade5bc` 将其提升为 Memsphere 总体架构文档；边界修正 Run `run-20260829-123908z-b5342e34` 将 Memory 保持在 Project 层并统一 `adapter/` 命名。
- `git diff --check`、关键术语正反向检查通过。
- `npm run typecheck`、`npm run build`、`memsphere validate` 通过。
- `npm test` 在具备本地端口和子进程权限的环境中完整通过：509 通过、0 失败、1 个 Windows 专属测试跳过。
- Module Manifest、Runtime、SDK 和 Persistence 协议作为后续独立迭代处理。
