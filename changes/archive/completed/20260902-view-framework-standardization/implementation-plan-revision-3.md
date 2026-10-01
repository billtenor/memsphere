# 实施与验证方案第 3 轮修订摘要

- 补全四个旧 Memory detail 文件的完整仓库路径，并将 `modules/org.memsphere.memory/adapter/view/index.ts` 相对 master `2c2b1445` 的每组越界 hunk 分为明确删除/恢复项；明确 structured ChangeSet diff review 必须保留。
- 将旧 Change 目录的截图数量修正为 13，并改为“目录内全部 PNG”一并安全归档。
- 明确 `test/view-style-contract.test.ts` 先删除 Memory 专用内容，再在原路径建立领域无关契约测试；显式删除 `scripts/build-view-assets.mjs` 对旧 Memory stylesheet 的 import/循环。
- 根据现有 `RuntimeSlotTransaction`/`RuntimeSlotStore` 事实简化标准列表设计：不再新增第二个 Slot。`ViewUi.contentList(descriptor/provider)` 返回标准 `ViewMount` 并注册到原有 single `content.list`，因此复用现有注册期冲突、实例回滚和 diagnostics 语义，不引入跨 Slot 竞态。
- 明确非法 descriptor/provider 不回退、不部分渲染；不同 Module 的竞争使用现有 single Slot 后注册实例回滚规则，并新增相应测试。
- 根据产品验收校正，Reference Module 进入正式 builtin catalog，与现有 View 共用 host/port，并从一级菜单或 `/reference` 进入；不再启动独立预览端口。
