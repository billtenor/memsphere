# 模型登记实现与验证验收材料

Run run-20261002-113512z-65600623；请以 requirements.md 第六轮、implementation-plan.md 第三轮为验收基准。完整实现摘要见 implementation-summary.md，当前验证见 initial-verification.md；二者与实际工作区源码/测试共同构成本轮成果，不能只批准本文。

当前 Workspace：/data00/home/liuyanjun.lyj/.codex/worktrees/26c0/vibe-mem。请主动查阅 git diff 和尚未提交的新增文件；未提交文件同样是实现的一部分。node_modules 是本机离线依赖链接，非交付文件。

## 实现对象与关键审查点

- src/project/model-registration.ts/model-storage-paths.ts/models.ts：代码内置八字段 Runtime 与 ValueStore 自举、UUID记录/唯一identity、语义条件、单条损坏隔离；原与imported DataStore绑定、保留原 bytes；扫描根/内部登记/备份/旧目录隔离、symlink规范化。
- src/project/model-market.ts/model-market-assets.ts：发行订单包与真实导入；完全相同 unchanged，修改/冲突拒绝，候选不可见和显式cleanup；检查异常回滚、发布后的cleanup失败反馈与已发布定义保护。
- src/project/model.ts/config.ts/config-management.ts，src/commands/project.ts/view.ts/cli.ts：显式初始化；selected store详细配置；有数据切换明确迁移、CAS/设置权限/Project lock；失败不切config，不删除原数据。
- modules/org.memsphere.models/adapter/view/index.ts/styles.ts、modules/shared/model-browser-state.ts：project/system/market上下文分组、包/tag/q AND与URL规范化、四行列表仅tags、默认模型信息表格、结构/原文renderer、真实市场；检查请求取消、页面卸载与路由挂载竞态。
- modules/org.memsphere.settings/adapter/view/settings-view.ts：选择ID后配置、草稿切换/取消、迁移确认与错误反馈。
- src/view/view-sdk.ts/ui-primitives.ts/view-runtime.ts/shell/layout.ts，src/module/builtin-catalog.ts与locales：可选分组/徽标title与可访问性，正式/替换renderer登记上下文，新增市场route grant，公共Shell样式与独立data-models-list Feature，固定中文/英文。
- README.md/README.en.md、src/skills/memsphere/SKILL.md、reserved-memory/system-memory/concepts/memsphere-framework.yaml及Embedded副本；examples/models最新定义/十三条草案和prototype仅作设计参考，不作为正式功能验证替代。

## 当前验证事实

最终 typecheck、clean build、npm test 全量通过（889项：888passed、0failed、1既有Windows专用条件skip）。完整日志 assets/test-full.log；发行tarball解压后真实HTTP预览/import已通过，正式模型/设置/原renderer/browser/reserved-store受影响批次56/56passed。首次失败及修复如实记录在initial-verification.md，未删除/弱化断言；样式边界及生命周期回归已修复且全量复跑通过。

真实开发Project显式初始化8条项目登记、零诊断；旧预览文件已备份、迁移为代码内置canonical，host现13项available、登记模型仅一项。正式完整Shell可在 http://127.0.0.1:22531/projects/memsphere/models 查看；实际交互和真实Project设置编辑/放弃、窄屏证据见assets/models-real-*.png。未对真实Project安装市场包或迁移登记目录；这些写行为由临时Project真实HTTP/浏览器集成覆盖。

Memory最终ChangeSet change-20261002-125134261z-335c30c6、embedded、passed，digest fef746cfbbf6d6830affc17736076eb19b58b6e4cce3c64b39a2bf8347630ce6；View http://127.0.0.1:30000/projects/memsphere/changes/change-20261002-125134261z-335c30c6。普通Project validate同样passed。

## Review要求

研发、测试、架构各自主动寻找反例与未覆盖边界；请区分亲自检查/执行、引用未复跑和残余风险。发现阻塞给出具体文件/行为与修正结果；非阻塞风险/建议也记录。尚未Human交付验收，没有commit/PR，不因摘要宣称通过。

## Human 实际查看后的界面修订

Human 明确要求市场独立分组、统一标签菜单，以及暂缓新增登记存储和初始化入口。已添加“发现”小字分组和分隔线，SDK使用可选separatorBefore，样式仍由Shell管理；标签用ui.select并采用独立Feature范围。modules/shared/model-browser-features.ts集中将modelRegistrationSetupEnabled设为false，设置和模型页面入口均隐藏；既有Store选择/配置、内部服务与显式CLI保留供以后开放。requirements.md已记录Human直接授权的调整，未来恢复不必删除重写实现。

设置浏览器迁移前置数据改由API建立并刷新revision，保留原草稿、取消、非法输入、迁移拒绝/通过及窄屏断言，同时断言两个暂缓按钮不存在。正式市场使用与设置一致的sessionStorage令牌，市场浏览器集成改为需要令牌的服务，验证已登录的真实导入/重复导入。

当前最终typecheck/build通过，npm test 889项：888passed、0failed、1既有Windows条件skip，日志assets/test-full.log。UI受影响12项通过；入口隐藏后的设置目标1项通过；授权市场三项通过。playwright-cli实际核对统一下拉展开/选择与发现分组；另以实际30000服务验证设置暂缓按钮不存在，存储ID和目录仍可用，截图assets/models-settings-rollout-hidden.png。

框架Memory源和Embedded副本、Skill及README已同步；ChangeSet仍为change-20261002-125134261z-335c30c6，最终passed，digest aa770be6e2e8296d337945311295b80a75c2b551088b6c6168de1e9898a4669c；View http://127.0.0.1:30000/projects/memsphere/changes/change-20261002-125134261z-335c30c6。Project validate通过。此前digest对应修订前内容，应以本节最终内容为准。

当前Run成果Review review-20261002-131811z-4f20c835仍未完成；研发、测试已提交通过，架构traex Attempt attempt-20261002-131811z-9d165dc1在2026-10-02T13:20:16.802Z以agent_idle_timeout失败。需Human在View重试；不能代投、跳过或沿用修订前票据宣称新内容已验收。恢复后应汇总此界面修订提交当前Run的新成果轮次。没有commit/PR。

## 设置只读信息对齐修正

Human 指出模型存储路径与登记模型信息缩进。根因是原生dd默认margin-inline-start；两块设置只读列表增加settings-model-info局部样式，标签和值统一左对齐、间距及窄屏换行，不修改配置值。30000正式服务已更新；实际浏览器测量每个dd与对应dt左边缘差小于1px，截图assets/models-settings-aligned.png。受影响设置目标测试通过；最终typecheck、clean build通过，全量888passed、0failed、1既有Windows条件skip，assets/test-full.log为此次最终日志。没有新增Memory差异，最后ChangeSet digest仍为aa770be6e2e8296d337945311295b80a75c2b551088b6c6168de1e9898a4669c。原架构Review失败待Human重试，未commit。

## 2026-10-03 流程状态更新

Human 已验收最终界面（human-acceptance.md）。当前安装技能允许 Runner 显式 retry，架构失败 Assignment 已重新派发。最终界面修订仍需新轮次角色评审覆盖；此前仅 Human 可重试的状态说明已失效。

## 最终角色评审与独立构建复核

2026-10-03，成果第二轮研发、测试、架构均 approve；无 blocking，架构记录一项构建可重复性 risk。三角色各自复跑全量时共用同一 dist 输出树，构建命令开头会 rm dist；并发输出竞争存在可能，根因未证明。各角色提交后，Runner 串行执行两次 npm run build 和一次 npm test（第三次 clean build），全部成功；最终仍为 888 passed、0 failed、1 既有 Windows skip，见 assets/isolated-*.log。当前单独构建可重复性已有验证；并发构建隔离作为后续工程改进，不声称已修复未确认根因。
