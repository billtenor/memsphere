# 开发计划

Run：`run-20261001-054855z-53c67dce`。基于已通过需求契约和三方技术方案，按依赖顺序施工，不更改 `src/data/api`。

1. [x] 元模型启动扩展：单独注册 Draft-07 元模型 Factory，复用 Serializer/Descriptor/Value；测试完整定义保留、元模型校验与业务 Runtime 的闭环。
2. [x] Project 配置：`modelsDirectory` 可选字段、默认/绝对/相对路径、Config Draft 的读/写/归一化/diff/CAS，解析路径透出；运行 config-management/Project/Settings 对应测试。
3. [x] Project 模型宿主：filesystem DataStore 单模型装配、完整分页、内置 raw 模型目录、lazy ModelBinding、单项失败隔离、模型与原始 JSON 同一读取快照；模块测试覆盖 101+ 项与新刷新读取最新文件。
4. [x] 只读模型 HTTP API：现有 Project 路由隔离下的列表与定义查询，非法 ID、404、JSON/Schema 错误、旧请求取消；真实 HTTP 测试 A/B Project 与配置切换无需服务重启。
5. [x] 正式 Module 与 Settings 分组：从原型抽取领域树表、接入真实列表/定义、删除正式页样例和演示态；Settings 沿用保存确认与放弃；固定文案双语与 Token 门禁。
6. [x] 测试与文档同步：typecheck、受影响自动化测试；README/数据实现文档/System Memory 源及开发副本/Skill 更新；Reserved Store、文档和 locale 测试。
7. [x] 正式 View 浏览器：独立临时 Home 的真实 ViewHost，桌面/窄屏、树/复制/筛选/URL/失败/快速切换/卸载/双语、目录保存/放弃/重载/Project 隔离。
8. [x] 功能实现摘要：逐项映射文件、diff、需求、行为、当前结果与未验证项；Memory 差异执行 change validate 并附 ID/状态/View 入口。
9. [x] 初始验证：重新读取测试规范，受影响与 npm test 全量回归、typecheck/build/validate/最终 change validate，记录本轮失败、历史失败和环境阻塞。
10. [x] 三方实现评审：提交完整成果，处理 Reviewer 意见并复跑受影响验证，直到通过。Review 第 2 轮 Runner 接纳；研发关于 URI 别名的建议按已批准范围正式拒绝，跨平台风险保留，不宣称三方一致通过。
11. [x] 产品验收与交付：交付第 2 轮由 Human、产品 Agent 通过，Runner 最终接纳；记录完成日期并归档需求。精确 Git commit 结果由 Run 的下一步骤产物记录，仅纳入本轮文件，保留 `.vscode/`、`review-summary.md` 等用户原有内容；是否创建 PR 仍由 Human 决定。

实现细节风险控制：流只消费一次，原始 JSON 与 Model 解析共享自有字节快照而非依赖 Payload 可重复读；Manager 缓存只在当次操作复用，刷新创建新宿主；跨模型依赖按现有 Factory 的精确 ModelRef 语义准备，不新增网络下载或别名规则。需要改变产品可见行为或公共接口时暂停相关施工并与产品负责人讨论，不借技术实现扩大范围。

现有受影响测试文件：`data-manager.test.ts`、`data-extension-registry.test.ts`、`data-json-schema.test.ts`、`data-json-serializer.test.ts`、`data-filesystem-datastore.test.ts`、`config-management.test.ts`、`project-resolver.test.ts`、`project-command.test.ts`、`view-settings.test.ts`、`view-project-switch.test.ts`、`view-browser.test.ts`、`view-locales.test.ts`、`module-manifest.test.ts`、`view-style-contract.test.ts`、`reserved-store.test.ts`，以及新增 Project 模型/元模型/API/树表测试。按实际影响追加对应浏览器集成套件，不跳过或弱化现有断言。

当前开发、验证、产品验收与需求归档已完成；Git 提交及 PR 的流程结果以同一 Run 后续产物为准，不将验收通过解释为已经创建 PR。
