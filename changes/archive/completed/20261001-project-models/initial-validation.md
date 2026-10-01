# 初始验证报告

本文件是初始步骤的历史验证证据；最新代码的完整验证、最终 Memory digest 和重报前复核见 [交付报告第 2 轮](delivery-report-round-2.md)，不能以本文件的早期结果代替后续修订验证。

Run：`run-20261001-054855z-53c67dce`。范围按已通过需求契约和技术方案；分域组织由 Human 明确留待后续讨论，不加入本轮。

## 执行结果

验证前重新读取 `statements/memsphere-repository-testing-rules`，按真实边界执行；本报告不是计划或模拟结果。

| 执行项 | 实际结果 |
| --- | --- |
| `npm test`（包含 pretest 构建） | 822 项，821 通过、0 失败、1 项既有 Windows-only 测试在 Linux 跳过；退出码 0。初始验证步骤再次运行得到相同结果。 |
| `npm run typecheck` | 主程序与 Modules 类型检查通过，退出码 0。 |
| `npm run build` | 独立构建通过；最终全量测试的 pretest 再次构建通过。 |
| `git diff --check` | 通过。 |
| `memsphere validate` | 通过。 |
| 受影响测试 | 数据/配置/Project/View 等受影响组 79/79；元模型及 Project 模型 11/11；最终正式模型真实 View 浏览器套件 14/14，通过并全部包含在最终全量回归中。 |
| Memory 最终差异校验 | `memsphere memory change validate change-20261001-065614910z-18de9f8c` 通过；源与开发副本一致。 |

## 验收标准检查

1. 默认/相对/绝对目录按登记的 Project root 解析；省略配置正常，目录不存在不报写入错误。配置模块及两个临时 Project 的实际 HTTP API 验证隔离。
2. filesystem DataStore 保存可读 JSON，ModelId 保留 `.json` 和 `/`；通过现有 Store/DataManager/JSON Serializer 加载，原文与解析共享一次内容快照，不依赖流可重复读取。包含 1001 个文件的分页、坏项隔离、刷新读取最新内容、路径遍历拒绝测试。
3. Draft-07 元模型独立扩展引导；完整 JSON 保留，HTTP/HTTPS 元模式标识按本地 Draft-07 校验。业务 Runtime 准备与订单反射闭环、精确依赖、不下载远端资源有模块测试。
4. 正式模型模块使用实际模型 API；不混入原型示例或元模型。四个实际内置 raw 模型与 Run 复用定义，raw 详情不伪造字段。
5. 树表逐层 object/array/数组元素、父对象 required、根和数组元素 `—`、全部展开/收起、焦点保留、原始定义与复制完整内容通过。高级 Schema 条件明确指向原文，不假装完整反射支持。
6. 筛选、URL 重开、单项错误、列表错误/重试、空目录、窄屏内部滚动、旧响应隔离和卸载重挂载均已实际验证。
7. Project 模型目录设置保存确认、放弃、必填错误、刷新切换，无自动搬运、无需服务重启；Home 与 Project 配置隔离。模型详情没有 Project 存储设置入口。
8. 中文与真实 Home 设置保存后的英文界面通过；在隔离临时 Home 的生产 ViewHost/Shell/Modules 运行，不修改用户配置。playwright-cli 操作结果 `passed`，pageerror 为 0；桌面、窄屏及英文截图已逐一查看。

截图：`assets/models-implementation-desktop.png`、`models-implementation-mobile.png`、`models-implementation-mobile-fields.png`、`models-implementation-settings.png`、`models-implementation-english.png`。详细文件映射见 `implementation-summary.md`，实现与验证设计见 `implementation-plan.md`。

## 失败与环境记录

- 开发期模块数量旧断言、非标准图标、空说明校验及卸载标记残留已修复，有对应回归；最终验证无这些失败。
- 既有 Artifact Review 保存辅助函数在点击后读取已移除按钮导致竞态；仅将角色查询移至点击前，保留全部断言，全量通过。不是本轮新增业务功能或跳过历史测试。
- 故障重试验证明确注入 503，检查后取消拦截；不是未修复产品错误。
- 当前真实 View 原先运行已安装旧版本，模型路由 404；使用工作区 `dist/cli.js view restart` 加载最终构建后，页面和 API 均 200。playwright-cli 在真实 Project 只读打开内置 Artifact 模型详情，正常，console error/warning 为 0；未写入样例或改变用户模型配置。
- 本机 Linux；未原生执行 Windows/macOS。1 项 Windows-only 跳过符合既有条件，不能宣称三平台实跑。无剩余环境阻塞。

## Memory 最终证据

- ChangeSet：`change-20261001-065614910z-18de9f8c`，active，validation passed。
- Base：`9766bdb6a85c42610a08fed1945a1e06303c5e98`。
- Content Digest：`59d901b23ad5a33cb2e5c94652e040716c9fdd07c4d921b1c3b007aebb1a9cb2`。
- View：[候选 Memory 差异](http://127.0.0.1:30000/projects/memsphere/changes/change-20261001-065614910z-18de9f8c)。校验之后没有继续修改 Memory。

结论：本轮功能与初始验证可提交三方实现评审，尚未三方实现通过或产品验收。所有任务改动仍未 stage/commit/push；`.vscode/`、`review-summary.md` 等用户原有文件不属于交付。

第 2 轮实现修订后的补充验证：`npm test` 824 项，823 通过、0 失败、1 项同条件跳过；元模型/Project 模型 13/13、typecheck、构建、diff check、Project validate、相同 digest 的最终 Memory ChangeSet validate 全部通过。新增 BOM 原文保留与原 Factory/宿主相对 `$id` 边界一致两项回归。详细意见证据和处理见 `implementation-revision-2.md`；本报告初次上报的冻结 Artifact 保留不变。
