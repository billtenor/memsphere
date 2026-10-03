# 模型登记初始验证报告

Run run-20261002-113512z-65600623；验证基准 requirements.md 第六轮与 implementation-plan.md 第三轮。验证前重新读取 statements/memsphere-repository-testing-rules，采用真实边界、故障/恢复、受影响+全量、Memory 变更级校验与 playwright-cli 实际交互要求。

## 最终执行结果

- npm run typecheck：通过，assets/typecheck.log。
- npm run build：clean build 通过；最终 npm test 的 pretest 再次完成 clean build。
- PLAYWRIGHT_BROWSERS_PATH=/data00/home/liuyanjun.lyj/.cache/ms-playwright npm test：889 项，888 passed、0 failed、1 skipped、0 cancelled。跳过是已有 Windows PowerShell/CMD/Git Bash 专用测试，在当前 Linux 不适用，本轮没有新增 skip。完整当前日志 assets/test-full.log。
- 受影响后端、路径、原模型、市场、筛选、配置/HTTP/CLI：51 项（首跑 50 passed，CLI 构建竞态后独立重跑 passed）。
- npm pack 解压后的编译资产、真实 HTTP 市场预览与导入，正式模型/设置浏览器、原结构/raw/renderer 回归、reserved-store：56/56 passed；assets/test-browser-package.log。当前全量再次覆盖发行集成测试。
- 路由与样式边界修复后的 contract：13/13 passed；生命周期目标回归：1/1 passed，增加列表 marker 卸载检查。
- node dist/cli.js --project memsphere validate：passed，当前 worktree Embedded Memory。
- node dist/cli.js --project memsphere memory change validate change-20261002-125134261z-335c30c6：passed，最终 digest fef746cfbbf6d6830affc17736076eb19b58b6e4cce3c64b39a2bf8347630ce6；View http://127.0.0.1:30000/projects/memsphere/changes/change-20261002-125134261z-335c30c6。
- git diff --check：passed。

## 首次失败、修复和环境边界

本轮首次全量 885 passed、3 failed、1 skipped：市场路由授权已新增而静态清单缺失；Plugin import 引号不符合现有源码检查；Module 样式引用 Host 私有分组 selector 并存在未限定列表 selector。市场路由测试补上新增入口而保留旧全部断言，Plugin 源码统一现有格式；分组样式移动到 Shell，标签 selector 限定独立模型列表 Feature。第二轮发现两块区域共用 data-models 导致卸载测试 strict ambiguity；列表改为独立 data-models-list，保留详情 marker，并扩展原卸载断言检查两个 marker 全部移除。最终全量全部通过。没有删减/跳过原断言或降低边界限制。

CLI 首跑在 clean build 删除 dist 时启动，MODULE_NOT_FOUND 是执行安排问题；构建完成后该集成 1/1 通过。真实 Shell 首次加载也在 pretest 重建资产期间短暂 500，构建完成后重载通过。普通 sandbox 禁止本地 listen，HTTP/浏览器在获准的非沙盒环境运行；没有遗留环境阻塞。上述不计作历史失败，真实首次本轮失败如实保留。

## 契约覆盖与实际 Shell

管理模型代码内置、八字段语义、两区域唯一 identity、损坏隔离、默认/自定义/祖先根剪枝、symlink、DataStore 正确绑定与原文字节、显式初始化及预览引用迁移均有模块/集成证据。设置验证选择 ID 后配置、草稿保留/取消、非法目录、权限/CAS、明确迁移与失败保持原配置。市场覆盖真实 import、unchanged、修改拒绝、失败候选不可见、残留授权清理及重复清理保护已发布定义。

浏览器覆盖包/tag/q AND、URL刷新/清空/无结果/焦点、列表仅 tags 及二项+N accessible overflow、默认信息顺序、结构展开与源内容、真实市场、中文/英文、窄屏、键盘、loading/error/empty、延迟请求与卸载，以及 portable renderer 回归。

playwright-cli 实际操作完整正式 Shell：预览/导入/重复无变更、包导航、搜索+标签+刷新、信息/结构/原文、窄屏。另连接真实 memsphere Project（非静态页/Fixture）验证 canonical 内置登记、订单包/tag/q，以及设置 ID 选择→详细目录编辑→放弃，原保存配置未变；窄屏设置无横向溢出。截图 assets/models-real-project.png、models-real-settings.png、models-real-settings-mobile.png。当前正式 Project Shell http://127.0.0.1:22531/projects/memsphere/models 。

实际 Project 显式初始化创建8条项目登记，diagnostics=[]，备份 receipts 已保存于 Project backups/model-registration/a22577de-0fdd-4a80-b225-b02eb088adb3。host 当前13条全部available，canonical登记仅 memsphere/model-registration 一项，builtin=true/storage=builtin。原 JSON Schema definitions 未重新序列化。

## 结论与未执行项

已确认实现验收条款均有当前验证证据；没有尚未解决测试失败。未执行 Windows 平台专用测试（既有条件跳过）、远程市场/包升级/编辑等后续范围。尚未进行研发/测试/架构成果 Review 和 Human 产品验收，不宣称流程交付完成；没有 commit 或 PR。

## Human 实际查看后的界面修订

Human 明确要求市场独立分组、统一标签菜单，以及暂缓新增登记存储和初始化入口。已添加“发现”小字分组和分隔线，SDK使用可选separatorBefore，样式仍由Shell管理；标签用ui.select并采用独立Feature范围。modules/shared/model-browser-features.ts集中将modelRegistrationSetupEnabled设为false，设置和模型页面入口均隐藏；既有Store选择/配置、内部服务与显式CLI保留供以后开放。requirements.md已记录Human直接授权的调整，未来恢复不必删除重写实现。

设置浏览器迁移前置数据改由API建立并刷新revision，保留原草稿、取消、非法输入、迁移拒绝/通过及窄屏断言，同时断言两个暂缓按钮不存在。正式市场使用与设置一致的sessionStorage令牌，市场浏览器集成改为需要令牌的服务，验证已登录的真实导入/重复导入。

当前最终typecheck/build通过，npm test 889项：888passed、0failed、1既有Windows条件skip，日志assets/test-full.log。UI受影响12项通过；入口隐藏后的设置目标1项通过；授权市场三项通过。playwright-cli实际核对统一下拉展开/选择与发现分组；另以实际30000服务验证设置暂缓按钮不存在，存储ID和目录仍可用，截图assets/models-settings-rollout-hidden.png。

框架Memory源和Embedded副本、Skill及README已同步；ChangeSet仍为change-20261002-125134261z-335c30c6，最终passed，digest aa770be6e2e8296d337945311295b80a75c2b551088b6c6168de1e9898a4669c；View http://127.0.0.1:30000/projects/memsphere/changes/change-20261002-125134261z-335c30c6。Project validate通过。此前digest对应修订前内容，应以本节最终内容为准。

当前Run成果Review review-20261002-131811z-4f20c835仍未完成；研发、测试已提交通过，架构traex Attempt attempt-20261002-131811z-9d165dc1在2026-10-02T13:20:16.802Z以agent_idle_timeout失败。需Human在View重试；不能代投、跳过或沿用修订前票据宣称新内容已验收。恢复后应汇总此界面修订提交当前Run的新成果轮次。没有commit/PR。

## 设置只读信息对齐修正

Human 指出模型存储路径与登记模型信息缩进。根因是原生dd默认margin-inline-start；两块设置只读列表增加settings-model-info局部样式，标签和值统一左对齐、间距及窄屏换行，不修改配置值。30000正式服务已更新；实际浏览器测量每个dd与对应dt左边缘差小于1px，截图assets/models-settings-aligned.png。受影响设置目标测试通过；最终typecheck、clean build通过，全量888passed、0failed、1既有Windows条件skip，assets/test-full.log为此次最终日志。没有新增Memory差异，最后ChangeSet digest仍为aa770be6e2e8296d337945311295b80a75c2b551088b6c6168de1e9898a4669c。原架构Review失败待Human重试，未commit。

## 最终角色评审与独立构建复核

2026-10-03，成果第二轮研发、测试、架构均 approve；无 blocking，架构记录一项构建可重复性 risk。三角色各自复跑全量时共用同一 dist 输出树，构建命令开头会 rm dist；并发输出竞争存在可能，根因未证明。各角色提交后，Runner 串行执行两次 npm run build 和一次 npm test（第三次 clean build），全部成功；最终仍为 888 passed、0 failed、1 既有 Windows skip，见 assets/isolated-*.log。当前单独构建可重复性已有验证；并发构建隔离作为后续工程改进，不声称已修复未确认根因。
