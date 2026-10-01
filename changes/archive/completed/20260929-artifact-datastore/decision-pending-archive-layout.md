# 已确认：归档元信息与 Run status 同类管理

实施方案第六轮已通过。Human 在了解 .archive.json 既有职责后明确回复“可以的，处理方式和 run 的 status 保持一致吧”，确认它与 Run status 同属状态信息，本轮继续按原 JSON 文件方式管理，不进入四类内容 Store。此补充不修改历史冻结 Submission，也不是实现验收票。

现有 src/archive/store.ts 支持两种原位置：directory（runs/<id>/<id>.json）和 legacy-file（runs/<id>.json）。归档后状态文件都位于 archives/runs/<id>/<id>.json；现有 .archive.json 的 layout 字段保存恢复所需的原布局。

若迁移实现仍在“最后移动状态文件”之后才首次保存 .archive.json，发生状态移动成功、元信息保存失败，再次执行时源状态已不在，目标状态路径也不能区分原布局。按 directory 猜测会把旧式 Run 恢复到不同位置；原布局不能从 contractVersion 推导，因为新旧目录布局均可含同一版本的 Run 状态。

处理顺序：内容全部复制及校验成功，先保存既有 .archive.json（原字段、格式和位置不变），然后最后移动状态文件，再清理源内容。它仍是既有归档元信息，不是新增进度状态；是否完成切换仅由状态文件位置判断，未切换目标不出现在有效归档列表。元信息失败或状态移动失败均保留源，redo 复用已保存的同次记录；不新增字段、检查点或迁移协议。写入采用与 Run status 相同的临时文件替换方式。恢复沿用 directory 保留元信息、legacy-file 不保留的既有最终布局。

不取消 legacy-file 原位置保证，不合并两份状态文件，不新增字段；后续 Run 状态领域建模时再一起考虑。

补充验证：legacy 状态移动前/后中断，元信息保存失败与重复执行，恢复原根目录文件位置，以及切换前列表不展示半成品。
