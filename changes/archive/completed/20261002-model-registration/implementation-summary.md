# 模型登记功能实现摘要

Run：run-20261002-113512z-65600623。依据：需求契约第六轮、实施方案第三轮、tasks.md。研发、架构、测试评审角色仍使用已绑定 ACP Agent；Human billtenor 是产品负责人。

## 规范采用与需求映射

采用 statements/memsphere-repository-requirement-rules、development-rules、testing-rules、delivery-rules，以及 concepts/memsphere-framework、CONTRIBUTING.md。没有专门登记设计 Statement。Git stable tag 无返回，不承担历史版本兼容；原定义字节、identity、已有管理属性保护仍执行。

1. 管理模型：src/project/model-registration.ts 代码内置 canonical memsphere/model-registration，八字段 modelRef/name/description/package/package_name/tags/storage/store_id。先绑定 Runtime 再创建 filesystem ValueStore，避免自举循环。登记使用 UUID record ID，两区域唯一 identity 与条件语义校验；不增 domain、包实体或重复定义 ID。
2. 模型存储：src/project/models.ts 保留项目 DataStore models/json-schema/draft-07，增加独立导入 DataStore models/imported/json-schema/draft-07。定义按 store_id/modelRef 读取，source 原文字节保留。登记 ValueStore 的 ID 不参与定义解析。
3. 路径与初始化：src/project/model-storage-paths.ts 规范路径、symlink 别名及排除内部根；src/commands/project.ts、src/cli.ts 提供显式初始化，普通 GET 不写入。旧预览 identity 仅匹配已确认 schema，先备份，再修改受支持 $ref token，不能安全处理则拒绝。真实开发 Project 已显式初始化，created=8、retained=0、diagnostics=[]；备份位于 Project backups/model-registration/a22577de-0fdd-4a80-b225-b02eb088adb3/model-registration.json。
4. 市场：src/project/model-market.ts/model-market-assets.ts 内联发行订单包。真实预览/导入，完全相同 unchanged，修改/跨区域冲突整包拒绝。候选发布保证未完成数据不可见；失败给出待清理 IDs，授权的显式 cleanup 可恢复，已发布内容保留。
5. 设置：src/project/model.ts、config.ts、config-management.ts，modules/org.memsphere.settings/adapter/view/settings-view.ts 和 locales。先选择 ID，再编辑其 filesystem 目录；取消不保存，无效配置定位；有数据切换要求 migrateModelRegistrations 授权、revision 和 Project lock，目标完整后发布 config，原数据保留。
6. HTTP：src/commands/view.ts 的 Project scoped models GET、initialize/import/cleanup POST 使用 settings 权限、expectedRevision、同一 Project lock；返回初始化状态、诊断及冲突/残留信息。
7. 正式模型界面：modules/org.memsphere.models/adapter/view/index.ts/styles.ts、modules/shared/model-browser-state.ts；本项目/已导入的包分组，没有全部模型。包/tag/q AND 过滤及稳定 URL、默认八行模型信息表格、四行列表仅 tags（二项+N）、市场正式路由。模型信息/模型结构/原始定义顺序及中文存储文案按契约。保留 renderer、焦点、取消和 generation；解决 mount 中 route 更新的生命周期竞态。
8. 公共 SDK：src/view/view-sdk.ts/ui-primitives.ts/view-runtime.ts、src/module/builtin-catalog.ts 增加可选导航 group、徽标 title、登记响应上下文及模型市场 route grant；替换 renderer 接收登记、scope/tag/q 和 canonical selection，既有贡献无需新增必填字段。
9. 文档/Memory：README.md/README.en.md、src/skills/memsphere/SKILL.md、reserved-memory/system-memory/concepts/memsphere-framework.yaml 与本 worktree .memsphere/memory 对齐。examples/models/model-registration.json、既有原型数据/界面保留供设计追溯。

## 验证与证据

npm run typecheck、clean npm run build 通过。受影响后端/配置/HTTP/CLI 套件 51 项中 50 项首跑通过；CLI 测试与 clean build 同时运行导致 dist/cli.js 尚不存在，构建完成后重跑该独立测试 1/1 通过，未修改断言。

正式模型/设置浏览器、既有结构/原文/renderer 与内置 Memory，以及 npm pack 解压后真实 HTTP 预览/导入，56/56 通过。日志 /tmp/model-registration-affected.log、/tmp/model-registration-cli-recheck.log、/tmp/model-registration-browser-package.log；测试文件为 model-registration、model-storage-paths、project-models、model-market、model-browser-state、config-management、view-settings、project-model-registration-cli、model-market-package、model-registration-browser、models-builtin-view-browser、models-view-slots-browser、view-settings-browser、reserved-store。

Playwright CLI 已实际操作正式 Shell 的市场预览/导入/重复无变更、包导航、搜索/标签/刷新恢复、信息/结构/原文与窄屏；assets/models-formal-desktop.png 和 models-formal-mobile.png 是当前界面证据。接下来核对真实开发 Project 正式 Shell 设置及最终全量测试。

Memory ChangeSet：change-20261002-125134261z-335c30c6；最终校验 passed（embedded），digest fef746cfbbf6d6830affc17736076eb19b58b6e4cce3c64b39a2bf8347630ce6。View：http://127.0.0.1:30000/projects/memsphere/changes/change-20261002-125134261z-335c30c6。memsphere --project memsphere validate 亦通过。

## 行为与剩余验证

本迭代新增显式登记初始化、持久管理属性和最小本地市场；模型原文继续 DataStore，系统登记代码提供。已迁移预览模型拥有备份，旧 .json URL 在正式页面归一 canonical。登记迁移保留原目录，不自动删除用户数据；异常与损坏显示诊断。

完整 npm test、真实 Project 最终 Shell 验证、成果评审、产品负责人验收尚待当前 Run 后续步骤，不宣称全部交付，也不归档、commit 或 PR。node_modules 仅为离线依赖链接，不纳入提交。

## 最终测试阶段补充

测试阶段新增 src/view/shell/layout.ts 的公共导航 group 样式，模型列表改为独立 data-models-list Feature；补齐市场 route 清单、保持 style-contract 的两块限定 Feature 与原生命周期测试全部卸载检查。完整最终证据见 initial-verification.md：全量888通过、0失败、1既有Windows条件跳过；typecheck/build/Project与Memory校验通过。正式真实项目为13项全部可用，详情/设置交互已完成。

## Human 实际查看后的界面修订

Human 明确要求市场独立分组、统一标签菜单，以及暂缓新增登记存储和初始化入口。已添加“发现”小字分组和分隔线，SDK使用可选separatorBefore，样式仍由Shell管理；标签用ui.select并采用独立Feature范围。modules/shared/model-browser-features.ts集中将modelRegistrationSetupEnabled设为false，设置和模型页面入口均隐藏；既有Store选择/配置、内部服务与显式CLI保留供以后开放。requirements.md已记录Human直接授权的调整，未来恢复不必删除重写实现。

设置浏览器迁移前置数据改由API建立并刷新revision，保留原草稿、取消、非法输入、迁移拒绝/通过及窄屏断言，同时断言两个暂缓按钮不存在。正式市场使用与设置一致的sessionStorage令牌，市场浏览器集成改为需要令牌的服务，验证已登录的真实导入/重复导入。

当前最终typecheck/build通过，npm test 889项：888passed、0failed、1既有Windows条件skip，日志assets/test-full.log。UI受影响12项通过；入口隐藏后的设置目标1项通过；授权市场三项通过。playwright-cli实际核对统一下拉展开/选择与发现分组；另以实际30000服务验证设置暂缓按钮不存在，存储ID和目录仍可用，截图assets/models-settings-rollout-hidden.png。

框架Memory源和Embedded副本、Skill及README已同步；ChangeSet仍为change-20261002-125134261z-335c30c6，最终passed，digest aa770be6e2e8296d337945311295b80a75c2b551088b6c6168de1e9898a4669c；View http://127.0.0.1:30000/projects/memsphere/changes/change-20261002-125134261z-335c30c6。Project validate通过。此前digest对应修订前内容，应以本节最终内容为准。

当前Run成果Review review-20261002-131811z-4f20c835仍未完成；研发、测试已提交通过，架构traex Attempt attempt-20261002-131811z-9d165dc1在2026-10-02T13:20:16.802Z以agent_idle_timeout失败。需Human在View重试；不能代投、跳过或沿用修订前票据宣称新内容已验收。恢复后应汇总此界面修订提交当前Run的新成果轮次。没有commit/PR。

## 设置只读信息对齐修正

Human 指出模型存储路径与登记模型信息缩进。根因是原生dd默认margin-inline-start；两块设置只读列表增加settings-model-info局部样式，标签和值统一左对齐、间距及窄屏换行，不修改配置值。30000正式服务已更新；实际浏览器测量每个dd与对应dt左边缘差小于1px，截图assets/models-settings-aligned.png。受影响设置目标测试通过；最终typecheck、clean build通过，全量888passed、0failed、1既有Windows条件skip，assets/test-full.log为此次最终日志。没有新增Memory差异，最后ChangeSet digest仍为aa770be6e2e8296d337945311295b80a75c2b551088b6c6168de1e9898a4669c。原架构Review失败待Human重试，未commit。
