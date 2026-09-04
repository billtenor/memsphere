# 第三轮产品验收修订摘要：真实业务 Module 迁移

## 修改原因

Human 产品负责人指出此前交付只证明 Reference 原型页可使用公共组件，未充分证明 Memory、ChangeSet、Run 和 Artifact Review 的真实页面已经采用；原交付报告对业务迁移完成度表述过度。

## 本轮修改

1. Memory 的当前项目、最近使用、记忆市场、ChangeSet 列表和 ChangeSet 目标列表全部改为公共 `Content List`，不再由 Memory 自写列表 Header、搜索框、行、选中态和空态 CSS。
2. 保留隐藏系统记忆、关联 ChangeSet 展开、其他 ChangeSet、市场状态、ChangeSet 已查看状态和评审进度，并分别使用 Checkbox Field、Content List Toggle/details、Badge 与 Progress 表达。
3. Run 三种状态列表改为公共 `Content List`，归档/废弃作为标准尾部操作并继续使用公共 Confirmation。
4. Run 元信息改为公共 Badge + Card；运行时评审绑定改为公共 Disclosure，参与人和跳过评审改为 Checkbox Field。
5. Memory/ChangeSet 和 Artifact Review 的行内评论输入改为公共 Textarea Field。
6. 删除 Memory/Run 已退休列表 CSS，并将测试从 Feature 私有 class 改为公共组件 DOM；新增静态防回退门禁。
7. 新增 `business-migration-matrix.md`，逐项列明真实页面落点和领域保留理由。

## 边界

Memory Renderer、ChangeSet diff、评论锚点、Run 步骤树、Schema writing、Artifact Renderer 和 Artifact Review 双栏布局仍属于领域实现。本轮没有把这些奇特业务正文抽象成通用组件。
