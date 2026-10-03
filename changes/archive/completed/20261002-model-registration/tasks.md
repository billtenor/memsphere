# 模型登记开发计划

Run run-20261002-113512z-65600623；requirements.md 第六轮通过；implementation-plan.md 第三轮研发/架构/测试全部通过并已接纳。

- [x] T1 后端：内置八字段登记模型、ValueStore project/imported 装配、唯一身份与条件校验；显式初始化和旧预览备份/引用迁移。
- [x] T2 存储：统一规范路径/别名与扫描排除，原/导入模型 DataStore 的稳定 ID 与 source 字节读取；配置 schema、目录迁移及失败保护。
- [x] T3 市场：编译内联订单包、真实预览/导入 API，重复/冲突/失败候选不可见；clean build + npm pack 发行验证。
- [x] T4 设置与接入：已有权限/revision 机制接入模型登记选择和所选 Store 可编辑配置；初始化 CLI/API、迁移确认及保存失败反馈。
- [x] T5 正式前端：公共 SDK 分组字段、包导航、搜索/tag/scope/q URL、四行标签列表、默认模型信息表格、市场预览/导入；中文/英文、键盘/窄屏及卸载。
- [x] T6 文档/Memory：framework 源、开发 Project 受控副本、Skill、README/en，最终 ChangeSet 校验。
- [x] T7 测试：按独立契约运行受影响模块/HTTP/CLI/正式浏览器测试，playwright-cli 实际交互；typecheck、npm test、build、memsphere validate、Memory change validate 全部门槛。
- [x] T8 交付：实施/验证证据进入 Run 成果评审，产品负责人验收后结果记录、归档与 commit；PR 按 Human 决定。

本轮职责：Runner 整体整合与正式模型前端，开发 Agent 分担后端与设置/HTTP 接入（互不覆盖文件，接口对齐）；已绑定研发/架构/测试 ACP Agent 保持流程评审角色，Human billtenor 为产品负责人。依赖使用本机已安装版本的工作树 node_modules 链接，不更新锁文件。T1–T5 实现不触发真实 Project 数据迁移；仅在临时 Project 测试通过后执行已确认的开发 Project 显式迁移。
