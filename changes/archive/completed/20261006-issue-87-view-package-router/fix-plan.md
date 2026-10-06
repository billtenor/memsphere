# Bug 修复方案

## 目标与批准基线

依据本 Run 已通过的 bug 理解摘要，解决普通可信本地 View Package 缺少 Router 声明/授权以及正式页面直达入口两个问题。现有代码为流程开始前形成的未提交草案；本方案审批通过后，将逐项核对、修订并验证该草案，而不把之前的实现视为已审批交付。

## 代码改动

- src/view/package-config.ts：新增显式 capability `router.register`，既有 capability 保持兼容；拒绝用于实例命名空间的 . / .. instance_id。
- src/module/package-registry.ts：以声明形成有效 capability，仅供主题的 themeOnly 实例去除 router.register，避免禁用业务实例通过主题选择获得页面授权。
- src/commands/view.ts：普通外部实例仅在拥有有效 router.register 时加入 router 服务。App 绑定实例保留原有 Router 与 API；普通 Package 不获 API。服务端对启动快照中获 Router 的实例基路径及后代路径返回 Shell，使用精确实例段边界，不把前缀相似或其他 Project 路径视为同一实例。
- src/view/view-runtime.ts：复用已有 moduleRouteBase、Route Token、query allowlist、冲突检测和事务；补强相对 route path，拒绝 URL 点段、编码点段/分隔符、反斜杠、NUL 和非法百分号编码，不新增任意全局 Route grant。
- docs/view-plugin-guide.{md,en.md} 和 docs/view-plugin-api.{md,en.md}：同步说明普通外部、builtin 和 App 能力边界、router.register、main.view@1:route:<route-id> 与匹配 contribution id、启用和重启，以及不同不可用状态的行为。

## 页面与失败行为

普通 Module route 始终位于 `/projects/<projectId>/modules/<instanceId>` 下。具体路径由浏览器 Runtime 注册，不在服务端执行任意 Package ESM 来提取路由。

未安装、禁用、无 Router 能力或服务端不能加载资源的实例不获得普通页面入口，返回 404。已授权且资源可用的实例路径返回 Shell；未知路由或浏览器加载/注册失败由 Runtime 显示局部路由错误及运行诊断，失败的事务不保留该实例的路由。保留现有 App 与 builtin 页面行为。

## 自动化测试计划

新增 test/view-package-router-browser.test.ts，以临时 Home/Project、真实 Package 与 createViewServer 验证：正式设置 validate/PUT 安装、启用和重启；直达、菜单、Header/list/main.view；source query 对象选择；关联跳转；刷新及 back/forward；未安装/禁用/未授权/未知实例或 Project 的路径；未知 route；冲突和越界加载失败后的原子清理。

新增的失败边界用例须明确区分：

- 配置已安装、启用且声明 router.register，但 entry 文件缺失，resolver 拒绝该 Package；其实例路径返回 404。
- entry 存在且可由 resolver 发现，但启动资源注册拒绝（例如不支持的 entry 资源类型），externalViewInstances 返回 loadError 且不含 Router allowedServices；其实例路径返回 404。这与前项不同，须检查 Home Shell 的 boot 数据证明触发的是启动资源注册失败。
- ESM 已由服务端成功注册，但浏览器 import 或 apply/注册失败，实例 namespace 仍返回 Shell，诊断 failed 且路由事务无残留。
- 分别验证 /./outside、/%2e/outside、/../outside、/%2e%2e/outside，另覆盖反斜杠、编码分隔符、NUL 与非法百分号编码。草案已用 decoded === "." || decoded === ".." 检查单点段，新增 case 验证该承诺，不据错误推断删除现有检查。

test/view-package-registry.test.ts 增加 themeOnly 有效 capability 验证。test/view-package-config.test.ts 增加 instance_id 点段验证。继续执行已有 View、builtin Memory/Run/Models/Settings、展示扩展、Project 切换与 App 测试，核对不同授权通道无回归。

验证命令：`npm run typecheck`、`npm run build`、`git diff --check`，及 `node --import tsx --test --test-concurrency=1 test/view-*.test.ts test/builtin-memory-view.test.ts test/builtin-run-view.test.ts test/models-builtin-view-browser.test.ts test/models-view-slots-browser.test.ts test/settings-builtin-view-browser.test.ts test/app-install.test.ts`。若评审或验证发现新缺口，补充有意义的针对性用例并重新验证受影响范围。

## 交付与边界

本修复不需要修改 Memory，因此不创建空 Memory ChangeSet。Run 产物保留正式步骤和 Review 证据；最终摘要列出最终代码、验证结果和未执行项。当前环境为 Linux/Node 22.16.0；Windows/macOS 及 CRAA 私有 Package 集成不能冒充已实测。无私有业务代码或数据，不硬编码业务包，不改变一般 API 权限；Git commit、push、PR 和 issue 状态另按用户授权及流程要求处理。
