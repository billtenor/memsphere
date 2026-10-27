# 实施与验证方案

## 目标与边界

依据已获 Human 与产品 Agent 第二轮通过的需求契约，新增独立 CI 修改门禁。无评论授权、无标签、无外部服务、无账号隔离；Human 使用 GitHub 原生 PR bypass 并合并。既有 CI 的超时、矩阵、通过标准和 Protect master 规则不变。

## 实现

新增 `.github/workflows/ci-change-guard.yml`，监听针对 master 的 pull_request_target（opened/synchronize/reopened/ready_for_review/edited）、master push 与 workflow_dispatch。工作流 checkout `refs/heads/master`，persist-credentials=false；Node 22 直接运行仅依赖内置模块的 `scripts/ci-change-guard.mjs`，不运行 npm ci、不安装 PR 依赖、不执行 PR 代码。只授 contents:read、pull-requests:read、statuses:write。

使用独立 commit status `CI change guard`（来源 GitHub Actions，integration_id 15368），显式发布到 PR 最新 head SHA，避免 pull_request_target 的 job 所属基准 SHA 与 PR head 不一致。workflow job 使用不同名称，避免同名 check/status 双重约束。每次扫描所有 open master PR（与现有 full-health publisher 的刷新模式一致），全局串行且不取消，任何事件都以 API 实时状态为准；master push 或手工 refresh 也能刷新目标分支变化后的差异。

对每个 PR：先发布 pending，再读取完整分页 files，检查文件总数与 changed_files 一致，校验路径、rename 的 previous_filename 与 GitHub 3000 文件 API 上限。超限、返回缺失或错误均为 error，不返回 success。判定前后复读 PR，对 head/base SHA 变化作最多 3 次重算；仍变化则 error。读取列表/基础信息失败导致刷新工作流失败，不产生错误成功；缺失状态由 required check 挡住。只要命中保护路径就发布 failure，普通源码差异 success。

失败时逐条 JSON 编码输出所有命中文件（含改名前后受保护路径），普通日志前缀防止路径内容被解析成 workflow command。随后给出用户指定中文报错：实际命中文件列表 + “等 CI 机制不允许在 human 未授权的情况下修改。请检查修改的必要性，或者请求 human 授权”。短状态描述仅概括并指向 run 日志，完整路径在日志保留；逐条日志避免单行/摘要长度限制。指引只供 Human 手工绕过专属规则并合并，不建议 Agent 自行 bypass。

## 保护路径与引用对照

保护清单放在 guard 脚本中，不另增配置层：

- `.github/workflows/**`：ci、security、full-health、新 guard 及未来 workflow。
- `scripts/ci-plan.mjs`、`scripts/test-plan.mjs`、`scripts/run-tests.mjs`、`scripts/test-durations.json`：CI 矩阵、选测、执行与分配参数。
- `scripts/full-health.mjs`、`scripts/ci-change-guard.mjs`：现有与新增合并门禁及自身清单。
- `scripts/project-smoke.mjs`、`scripts/windows-package-smoke.mjs`：ci.yml 或 package.json 直接调用的 smoke。
- `scripts/security-check.sh`、`scripts/security-setup.sh`、`.gitleaks-privacy.toml`、`.gitleaksignore`：安全检查和本地安装入口。
- `scripts/check-reserved-models.mjs`、`scripts/build-view-assets.mjs`、`scripts/build-example-view-package.mjs`、`scripts/build-example-app.mjs`：package.json build 直接调用。
- `package.json`、`package-lock.json`、`npm-shrinkwrap.json`、`.npmrc`、`.nvmrc`、`tsconfig.json`、`tsconfig.modules.json`：CI 构建/依赖/运行时配置，当前不存在的标准配置文件新增亦保护。lockfile 纳入既有“相关配置”类别，采纳产品风险，不增加凭据防护范围。
- `test/ci-workflow.test.ts`、`test/test-plan.test.ts`、`test/full-health.test.ts`、`test/ci-change-guard.test.ts`：CI 策略和门禁回归自身（开发计划按方案评审意见补齐 test-plan 回归）。其余业务测试和源码不整体锁住。

自动化回归核对 workflow 与 package scripts 直接引用的 scripts 路径均在保护集合内，作为未来修改 workflow 时更新清单的提示。源码间接依赖不无限递归保护；普通产品代码更改仍由既有测试验证。

## GitHub 规则交付和首装

当前是 billtenor 个人公开仓库，操作账号为 billtenor 且有 admin 权限。创建独立 `CI change protection` branch Ruleset，目标仅 refs/heads/master、唯一规则为 required_status_checks(CI change guard, integration_id=15368)，strict=false。bypass 优先使用 GitHub 支持的负责人主体；个人仓库若不支持精确 User，使用仅负责人实际拥有的 repository admin 角色（需查询确认），模式 pull_request，不授予 write/maintain bypass。

先创建 disabled Ruleset 并核对读回的内容，既有 Protect master（19767795）不修改。代码 PR 合入前不激活规则；首装 PR 仍按现行 CI 检查交付，不伪造 bootstrap 成功状态。Human 合入后，在同一 Run 继续：核对 master 已包含代码，运行可信 master guard，核对正常/命中 PR 的状态证据，再激活规则并读回验证。若暂无适合验证的 PR，仅如实报告未实测项，不创建无关演示 PR，也不擅自合并。保留 disabled 规则可在首装失败时安全恢复；修复 guard 的 PR 以后由 Human bypass。

日常流程：普通 PR guard 绿则正常合并；CI PR guard 红，由 Human 在 PR 合并区域使用 bypass 并亲自合并。Protect master 的现有无 bypass 约束继续执行，特别是 Merge gate / full regression。共用凭据可使用 bypass 是 Human 已接受的边界，不作为阻塞。

## 开发任务与验证

1. 新增无依赖 guard 脚本及可信来源工作流，新增维护文档 `docs/ci-change-guard.md`。
2. 新增测试：普通变更通过，所有保护路径拒绝；新增/删除/双向改名均命中；多页超过100文件可正确命中；3000上限/计数不符/无 previous_filename/API异常不放行；head/base变化重新核算；命中文件完整中文报错；工作流无 PR checkout/npm install；直接引用覆盖性。
3. 真实只读 GitHub API dry-run 核实 open PR 差异，不使用个人 Token 发布假 Actions 来源状态；创建 disabled 独立规则并保存读回核验。
4. 先运行新增与 ci-workflow/full-health 受影响测试，再执行 npm run typecheck、npm test、npm run build、memsphere validate 与 git diff --check。全量失败分类处理，不改超时或减少测试。
5. 按 Run 完成实现验收与产品负责人交付评审，通过后仅提交本轮实现/测试/必要文档和需求结论，创建 PR 跟进全部现行适用检查。Human 合入确认后激活并核验独立规则，再清理本轮分支。

## Memory 与影响

采用 memsphere-repository-requirement-rules、development-rules、testing-rules、git-rules、delivery-rules。此次仅仓库 CI 治理，不新增 CLI/Memory/Run 产品语义，不改 System Memory、Skill 或语法；因此无 Memory 差异，不创建空 ChangeSet。必要操作说明写在仓库 CI 文档。保留原有未跟踪 .playwright/。

## 限制

GitHub 原生 bypass 是 Human 合并时使用的例外，不会把红色检查改绿，也不是提前授予 Agent 之后合并的许可。首次安装直到 Human 合入后才能可信运行并激活规则，此前不宣称保护已生效。所有线上实测与未实测项分别记录。
