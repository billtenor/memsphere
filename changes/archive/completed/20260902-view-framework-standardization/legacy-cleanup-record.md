# 上一 Run 越界改动清理记录

基线：`origin/master` / `2c2b1445f87d0b074f2835e99e7c4327fd8dd427`

## 归档

- 原需求 `20260902-view-memory-preview` 已标记 `cancelled`，原因记录为“以业务 Memory 页面代替框架 Reference，职责越界，由本迭代替代”。
- 原目录和 13 张过程截图已完整移动到 `changes/archive/cancelled/2026/20260902-view-memory-preview/`；没有覆盖同名目标。

## 删除的专用演示实现

- `modules/org.memsphere.memory/adapter/view/memory-detail-document.ts`
- `modules/org.memsphere.memory/adapter/view/memory-detail-feature.ts`
- `modules/org.memsphere.memory/adapter/view/memory-detail-page.ts`
- `modules/org.memsphere.memory/adapter/view/memory-detail-styles.ts`
- `scripts/view-memory-preview.mts`
- `test/fixtures/view-memory-preview/memory-detail.json`
- `test/view-memory-preview.test.ts`
- `package.json` 中的 `view:preview:memory`
- `src/commands/view.ts` 中的 `memoryDetailPreview` 开关、专用资产和注入路径
- build script 中仅服务 Memory detail stylesheet 的读取与校验循环

这些文件和入口仅属于已废弃原型，从未成为 master 的正式产品能力。

## 恢复到 master 的文件与断言

以下六个文件逐字节对照 `origin/master`，当前 `git diff --exit-code origin/master -- <files>` 返回 0：

- `modules/org.memsphere.memory/adapter/view/index.ts`
- `src/view/locales/en.ts`
- `src/view/locales/zh-CN.ts`
- `test/builtin-memory-view.test.ts`
- `test/view-responsive.test.ts`（随后仅因新 Shell 的真实窄屏契约调整了通用 viewport 断言，不涉及 Memory 业务断言）
- `test/view-settings-browser.test.ts`

恢复内容包括旧 Run 添加的四个专用 import、preview 配置、详情 renderer 分支、复制交互、Hero/Pill DOM、专用文案键和对应测试断言。master 已有的 Memory、ChangeSet diff review、路由、请求与最近使用行为均保留。

## 无遗留证明

在排除本记录、方案文档及 cancelled archive 后，对源码、文档、测试和 package script 搜索以下模式均无结果：

- `memory.detail.*`
- `memoryDetailPreview`
- `mem-memory-detail`
- `view:preview:memory`
- `memory-detail-(feature|styles|document|page)`

正式 Memory Module 没有为本次 Reference 演示新增代码；独立 Reference Module 位于 `modules/org.memsphere.reference/`。
