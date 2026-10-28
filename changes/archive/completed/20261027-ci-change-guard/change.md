---
id: 20261027-ci-change-guard
type: enhancement
created: 2026-10-27
completed_at: 2026-10-27
run_id: run-20261027-132814z-7a6d7855
---

# 当前迭代需求契约

## 整体目标

阻止普通 PR 自主修改 CI 基础设施并合入 master。涉及 CI 的变更固定产生失败的 CI change guard 检查；仓库负责人可在 GitHub PR 合并界面绕过该专属规则并亲自合并。失败检查保持失败，不引入授权评论、标签、审批服务或额外 GitHub App。

## 当前迭代范围

- 增加独立 CI change guard：完整读取 PR 相对目标分支的变更路径，普通变更通过，受保护文件新增、修改、删除或重命名失败；列出命中的文件。
- 失败描述使用用户指定文案：“xxx 等 CI 机制不允许在 human 未授权的情况下修改。请检查修改的必要性，或者请求 human 授权”。xxx 必须替换为所有实际被修改且命中保护范围的 CI 文件路径，不得固定显示 xxx，也不得只以抽象机制名称代替文件路径。明确授权操作为 Human 在 GitHub PR 上手工绕过 CI 修改保护规则并合并，不提供 Agent 自行绕过或修改参数使检查通过的指引。
- 初始保护范围覆盖 .github/workflows/**、CI 规划/测试选择/执行脚本、full-health 合并门禁、CI 直接调用的冒烟和安全检查脚本、相关测试/安全配置、package.json，以及门禁自身与保护清单。实施方案列出实际路径，按文件保护，不做 package.json 字段级例外；普通测试内容不整体纳入该门禁。
- 校验运行可信目标分支的代码，不执行 PR 内脚本；不得通过在同一 PR 修改或删除校验逻辑使门禁通过。读取差异失败或不完整时不得返回成功。
- 在 master 上新增独立 Ruleset，仅要求 CI change guard；仅负责人对应的可用 bypass 身份可绕过，模式为 For pull requests only。
- 保留现有 Protect master Ruleset 的约束及无 bypass 配置，特别是 Merge gate / full regression 检查。绕过 CI 变更保护不豁免现有规则。
- 提供维护文档、自动化回归、GitHub 规则配置与核验记录。代码先通过 PR 交付，由 Human 合入后激活独立规则并验证，避免首次安装缺少主分支 workflow 卡死本轮 PR。
- 用户已明确接受 Agent 与本人共用 GitHub 账号凭据。本轮沿用现有身份，不做身份隔离、额外凭据核查或防止 Agent 使用 bypass 的技术限制；由流程约定最终绕过与合入由 Human 操作。共用账号具备 bypass 能力不构成本轮阻塞或未完成项。

## 后续范围

GitHub 身份/凭据迁移、额外权限隔离、字段级保护、测试断言删改审查、独立 GitHub App、自定义批准命令和授权状态管理均不在本轮实现范围。

## 交付物

可信来源的校验工作流及必要脚本、保护清单、有效行为回归测试、操作文档、代码 PR、独立 Ruleset 配置及激活核验结果。单次运行原始证据保存于 Run，不随代码提交。

## 验收标准

1. 普通源码 PR 的 guard 成功；修改 workflow、超时配置、测试矩阵/执行器、package.json 或 guard 自身时 guard 失败。
   失败输出包含实际命中的路径、上述 human 授权提示，以及由 Human 在 GitHub PR 上手工绕过该专属规则并合并的操作说明。
2. 新增、删除、改名和超过单页的文件列表均纳入判断；查询失败不会错误放行。
3. PR 内改变 guard 或保护清单不能改变本 PR 校验结论；特权校验不运行 PR 代码。
4. 独立规则只限制 CI change guard，负责人仅可通过 PR 绕过；既有 Protect master 配置保持有效。
5. 负责人可在 GitHub 绕过专属规则并合并 CI 变更 PR；不执行 bypass 时，该失败 PR 不能正常合并。不要求区分共用账号下的人与 Agent。核验区分实际操作与 API 配置证据，不为演示制造无关变更或擅自合并。
6. 受影响测试、npm run typecheck、npm test、npm run build、memsphere validate 通过；不弱化既有测试、超时或合并检查来消除失败。本轮首次安装代码按主分支现行检查交付，规则生效后命中保护范围的 guard 失败是设计结果，交由 Human bypass。
7. Run 中产品负责人绑定产品 Agent 与 billtenor；研发、架构、测试仅绑定各自 Agent。产品负责人正式评审与最终 Human 合入确认按流程执行。

## 向前兼容

结论：不需要向前兼容。本轮新增仓库治理约束，不改变 Memsphere CLI、Memory、Run 或业务数据格式；不承担 stable Tag 历史版本中的 CI 参数兼容责任。保留现有 master 合并保护与 CI 的执行标准。

## 采用的 Memory

- memsphere-repository-requirement-rules：明确范围、验收和向前兼容结论。
- memsphere-repository-development-rules：避免过度设计；检查是否存在需同步的用户或 Agent 可见语义。
- memsphere-repository-testing-rules：必要回归、完整验证，不弱化检查。
- memsphere-repository-git-rules：提交范围、原始证据及忽略规则边界。
- memsphere-repository-delivery-rules：验收记录、需求归档与交付要求。

## 已确认事项与初始现状

产品负责人已在需求第二轮正式投通过；共用账号和报错使用实际文件路径的意见均已纳入。GitHub Ruleset bypass 可选主体与首次安装激活顺序由实施方案核实；bypass 配置限定负责人对应的可用角色或主体，不能静默扩大到普通写权限角色。用户已接受共用账号的 bypass 能力，不再将身份隔离作为待确认项。

已读取远端规则：Protect master（19767795）为 active，针对 refs/heads/master，bypass_actors 为空，必过检查为 Merge gate / full regression（GitHub Actions integration 15368）。工作区原有未跟踪 .playwright/ 不属于本轮交付。


## 实现与验收结果

已完成可信 master CI change guard、保护清单、真实文件路径中文授权报错、Human bypass 操作文档和15项自动化回归。独立规则25963440已创建并读回，精确User billtenor(10627561)可仅通过PR绕过，现为disabled；原Protect master(19767795)保持active且无bypass。

- 受影响四文件：37通过；最终guard单文件：15通过。
- npm run typecheck、独立npm run build、memsphere validate：通过。
- Runner全量npm test：173文件，1472通过、2项既有Windows专用项按平台跳过、0失败，670.60秒。研发Reviewer另行全量复测：173文件、0失败，658.82秒。
- 实现验收review-20261027-141604z-fb4a00cc，第一轮研发/测试/架构均approve，Runner已通过。无阻塞意见；文档清单、维护边界与pending行为说明已对齐。
- 无本轮Memory差异，不创建空ChangeSet；最终暂存diff和忽略规则检查通过。

需求归档只表示实现、本地验证与Agent验收已完成，不表示Run或线上激活完成。产品交付评审、commit/PR、远端CI、Human合入、可信master运行、规则激活和实际PR红绿/Human bypass现场证据、Human结果确认及分支清理仍按同一Run后续步骤推进，未完成前不宣称门禁已上线。

原始证据保留在本次任务独立目录 当前Codex任务的独立 ci-change-guard-evidence/ 目录（完整本地路径见Run），结果与实现指纹已上报Run；原始日志不提交Git。

## 用户确认的CI测试目录整理

用户进一步明确要求将CI专用测试归入test子目录。本轮将ci-workflow、test-plan、full-health、ci-change-guard四个测试迁到test/ci/，同步相对导入、递归测试发现和整个目录的CI保护。普通/完整CI使用共享发现逻辑；测试文件数量、各套件成员、执行矩阵、并发和超时标准不变。验收为四个文件集中放置、全部173个测试仍被发现和执行、未来嵌套测试不会漏跑、原断言保留。

## CI脚本目录整理

按用户明确要求，将CI计划、测试计划/运行器/耗时数据、两个门禁和项目/Windows smoke共8项迁到scripts/ci/。通用构建、迁移、开发安全检查和README业务smoke保留根目录。同步工作流、npm scripts、相对导入、文档和目录级保护；直接脚本引用覆盖检查支持子目录。npm命令接口、173测试文件、全部套件成员、default/full矩阵和并发/超时不变。迁移后CI专用39项通过，后续最新提交全量结果记录于PR及任务证据。
