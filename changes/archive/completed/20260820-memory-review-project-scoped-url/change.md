---
id: 20260820-memory-review-project-scoped-url
type: bugfix
created: 2026-08-20
completed_at: 2026-08-20
run_id: run-20260820-115550z-fe0e6cd8
---

# Memory Review Project Scoped 稳定 URL

## 需求

Memory Review 的旧 `/memory-reviews/<review-id>` URL 缺少 Project 与 Memory 上下文，重新打开时依赖 View 当前 Project，无法可靠恢复目标 Review。

规范 URL 改为：

`/projects/<project>/memories/<kind>/<memory-name>/reviews/<review-id>`

打开规范链接时先恢复目标 Project，再加载并校验 URL Memory 与 Review target。

## 当前范围

- Memory Review 规范 URL 携带 Project、Memory kind/name 与 Review id。
- 跨 Project 打开时在 scoped 数据加载前切换 Project。
- URL Memory 与 Review target 不一致时明确报错。
- 旧 `/memory-reviews/<review-id>` 不再进入 View SPA，返回 404。
- 深链 Project 切换复用未保存 Project 设置草稿确认；取消时保留当前页面、Project 与草稿。
- 同步 System Memory 与 Skill 说明。

## 后续范围

- Memory 重命名后的永久 UUID 或重定向。
- 其他页面的 Project scoped URL 统一。
- 跨 Project 聚合列表。

## 向前兼容

结论：不需要向前兼容。

Human 已明确接受已交付 `/memory-reviews/<review-id>` 的历史书签、分享链接和旧路径脚本失效。Review 数据与 Store schema 不变，无需迁移或重建；用户可进入所属 Project 的 Review UI 重新打开并复制规范长链接。

## 验收结果

- 规范 URL、跨 Project 恢复、Memory target 校验和旧短路径 404 已实现。
- 未保存 Project 设置草稿确认已覆盖手动和深链切换，取消不会静默丢失草稿。
- System Memory Reserved 源文件、当前 Project 副本和 Skill 已同步。
- `npm run typecheck`、受影响浏览器/Reserved Store 测试、`npm test`、`npm run build`、`memsphere validate` 与 `git diff --check` 均通过。
- 最终全量测试 383 项：382 通过、0 失败、1 项 Windows 平台条件跳过。
- 实现与验证经产品、研发、测试、架构师和项目负责人评审通过；过程记录见 Run `run-20260820-115550z-fe0e6cd8`。
