---
id: 20260818-memory-reference-storage-decoupling
status: completed
type: feature
created: 2026-08-18
completed_at: 2026-08-18
run_id: run-20260818-130233z-53a40edc
---

# Memory 引用与 Provider 路径解耦

## 需求管理摘要

本需求通过敏捷需求开发流程推进。当前迭代统一 Memory canonical/alias reference 语义，使物理文件路径退出引用和 System Memory 分类；同时修复 Managed Project bootstrap 重造哈希路径及 View 无法隐藏这些系统记忆的回归。不引入当前没有消费者的 `memory_id`。

## 整体目标

- `kind/names[0]` 是当前自然 reference，`names[1..]` 是同 kind 下可解析且不得冲突的 alias。
- Catalog、ChangeSet 和 Validator 使用一致的 reference/alias 解析规则。
- 文件路径只属于 File Provider，不参与 reference、System Memory 分类或规范名称 rename。
- Managed bootstrap 保留 manifest 安装路径；现有哈希路径 Project 无需重建即可恢复 View 隐藏。

## 当前迭代范围

1. 统一 canonical/alias reference 解析，并让显式 `kind/alias` 可用。
2. `!ref` 校验先解析 alias 到 canonical，再检查存在性、类型和循环。
3. ChangeSet create 支持内部显式安全路径，bootstrap 原样使用 manifest path。
4. semantic rename 保留物理路径，把旧 canonical 保留为 alias。
5. View 服务端按 kind 与 names 标记 `system`，浏览器不再比较路径。
6. 同步 System Memory、Skill、测试和兼容性说明。

## 后续范围

- 只有产生真实永久身份消费者时再评估不可变 `memory_id`。
- 跨 Project 永久引用、历史文件名整理迁移和 alias reference 规范化 lint。
- bootstrap 的进程级 Project 选择并发重构。

## 向前兼容

结论：需要向前兼容。

现有 Managed/Embedded Project、哈希或旧路径 Memory、canonical reference、alias 查询、历史 Run/Review/Snapshot、CLI 入口及当前 Memory YAML 均继续可用。本轮不新增 YAML 字段，不要求数据迁移。rename 后旧 canonical 通过 alias 继续解析。

## 验收标准

- 新 Managed Project 的 System Memory 路径集合与 manifest.install 精确一致。
- 现有哈希路径 System Memory 的 View payload 为 `system: true`，默认隐藏切换正确。
- `kind/alias` 可由 Catalog 和 Validator 解析，alias 形成的引用环仍可检测。
- rename 后文件路径不变，新旧 reference 均可解析，冲突在 Publish 前拒绝。
- 用户 Memory 不因路径相似被误判为 System Memory。
- 定向测试、typecheck、全量测试、build、Project smoke 和 `memsphere validate` 通过。

# Syntax 关键字变更

本轮不新增任何 Memsphere YAML syntax 关键字。

## 开发任务

- [x] 统一 reference/alias 解析。
- [x] 实现显式 bootstrap path。
- [x] 实现 semantic rename。
- [x] 实现服务端 System Memory 分类。
- [x] 同步 System Memory 与 Skill。
- [x] 补充定向和全量验证。
- [x] 完成 Agent Review。
- [x] 完成提需方验收。

## 实现结果

- Catalog、ChangeSet 和 Validator 共用逻辑 reference 解析原语；显式 `kind/alias` 会归一到 canonical reference。
- Managed bootstrap 将 manifest 的 `path` 作为内部显式 create path 交给 ChangeSet，不再根据 name 重造哈希文件名。
- rename 只更改逻辑名称：文件路径不变，旧 canonical 名保留为 alias。
- View API 为每条 Memory 返回 `system` 布尔值，按 kind 与 names 识别；浏览器不再依赖 path。

## 验证结果

- `npm run typecheck`：通过。
- 定向回归：Catalog/reference、ChangeSet/rename、Project bootstrap、reserved store、View API/browser/Project switch 全部通过。
- `npm test`：348/348 通过。
- `npm run build`：通过。
- `npm run smoke:project`：通过。
- 当前构建与已安装 CLI 对当前 Project Memory 执行 `memsphere validate --memory-root ...`：均通过。

## 验收结果

- 2026-08-18 提需方通过 `memorybase` 存量修复与新建 `test_1` Project bootstrap 实际检查，确认验收通过。
- `test_1` 验收后已移入系统回收站并从 Registry 清理，不作为交付数据保留。
