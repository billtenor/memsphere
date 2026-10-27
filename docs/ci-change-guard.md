# CI 修改保护

`CI change guard` 是独立的 PR 合并检查。普通源码、业务测试和文档修改自动通过；修改 CI 机制及配置时固定失败，等待 Human 检查必要性并手工放行。重新运行不会批准 CI 修改，也不会使对应红色检查变绿。

## PR 作者遇到失败时

点击 `CI change guard` 的 Details 查看本次运行日志。日志逐条列出实际命中的文件，例如：

```text
CI change guard: ".github/workflows/ci.yml" 等 CI 机制不允许在 human 未授权的情况下修改。请检查修改的必要性，或者请求 human 授权
```

请检查变更是否必需。不必要的 CI 修改应撤回；确需修改时请求 Human 查看差异。文件少时短状态描述直接包含文件及提示；超过 GitHub 140 字符限制时，状态明确提示数量与完整日志，完整路径逐条保留于日志，不用固定的 xxx 代替。

## Human 放行

1. 在 PR 的 Files changed 中确认 CI 修改合理，且其他合并要求已满足。
2. 在 GitHub PR 合并区域使用当前账号的规则 bypass 入口（具体文案随 GitHub 界面而异），绕过 `CI change protection` 规则并亲自完成合并。
3. 不关闭整个分支保护，不修改原有 `Protect master` 规则。`Merge gate / full regression` 仍需满足。

该操作是合并时的规则例外，失败状态保持失败；它不是提前批准后让 Agent 继续合并。Human 与 Agent 沿用共用账号凭据，不另做身份隔离；最终 bypass 与合并由 Human 按流程操作。

## 保护范围与维护

权威清单位于 `scripts/ci-change-guard.mjs` 的 `PROTECTED_FILES` 和 `.github/workflows/` 目录前缀规则，覆盖：

- 所有 workflow（包括新建文件）。
- CI 矩阵、测试选择/执行/分配配置与相关策略回归测试。
- CI 直接调用的构建、smoke、安全检查脚本，以及新旧门禁与清单自身。
- package.json、依赖锁文件、npm/Node 配置、TypeScript 构建配置、Gitleaks 配置及忽略项。

按整文件保护，package.json 的普通版本/依赖修改也需 Human 放行。业务源码和普通测试不整体锁定，也不审查普通测试的断言内容。新增、删除和改名均检查；改名检查原路径及新路径。新增 CI 直接调用的脚本需更新清单，回归测试检查 workflow/package scripts 的直接 scripts/ 脚本引用覆盖。新增本地 composite action（例如 .github/actions/）或其他目录、后缀的 CI 代码时，也必须同步扩展保护清单/前缀和回归；当前引用扫描不会自动识别这些未来形态。

## 工作方式与故障处理

可信 `master` 的 `ci-change-guard.yml` 使用 `pull_request_target`、master push 或手工运行触发刷新。它 checkout master，不 checkout PR，不安装 npm 依赖，只通过 GitHub API 读取 PR 文件并向 PR 当前 head 发布 commit status。发布 job 的名字与 status 不同，Ruleset 要求的是 `CI change guard` status（GitHub Actions 来源，integration ID 15368）。可信来源由受保护工作流固定 master checkout 保证，回归测试锁定该配置；授权修改工作流时，Human 应继续审查这个约束。来源应用限制不能区分 Actions 内部的不同 workflow，本轮按已确认的共用账号和 Human 最终合入约定运行，不增加恶意 workflow 防伪机制。

每次重新检查所有 open master PR，先撤销旧的绿色状态，再按实时 head/base 读取完整分页差异；差异计数不符、超过 GitHub 3000 文件上限、查询错误或持续变化都不会发布成功。此时显示 error 或保持 pending/缺失，查看日志解决 API/权限/数据问题后，在 Actions → CI change protection → Run workflow，使用 master 刷新。命中保护文件的 failure 属于正常结果；一个 CI PR 导致扫描 workflow 显示失败，不代表其他 PR 的独立 status 也失败。扫描期间关闭或改目标分支的 PR，其旧 head 上可能保留 pending；重新打开或重新指向 master 会触发重新结算，已退出 master 范围的 PR 不影响 master 合并。

脚本也支持只读诊断：设置 `GITHUB_TOKEN` 后运行 `node scripts/ci-change-guard.mjs`；只有显式 `--publish` 才写状态。不要在命令输出或日志中暴露 token。手工诊断不用于伪造 GitHub Actions 来源的必过状态。

## 首次安装和规则激活

1. 首装代码 PR 按现有检查交付，Human 合入前保持独立规则 disabled；否则可信 master 尚无新工作流，会卡住所有 PR。
2. Human 合入后确认 master 包含 guard，运行 master 上的 CI change protection，核对运行来源、当前 PR head、结果和日志。
3. 独立 `CI change protection` branch Ruleset 仅针对 refs/heads/master，仅要求 `CI change guard`（integration_id 15368，strict=false）。负责人原生 bypass 模式为 `pull_request` / For pull requests only。原有 Protect master 不增加任何 bypass。
4. 当前规则 ID 为 `25963440`，bypass 精确绑定 `billtenor` 的 User 主体（ID `10627561`），模式 `pull_request`。创建后已读回确认，无需使用管理员角色回退；激活前再次核对，不能扩大到 write/maintain 或其他账号。
5. 激活后读回规则，分别核验普通 PR 的 success 与 CI PR 的 failure。区分 API 配置证据、自动化回归和真实 Human bypass 合并证据，不以缺少现场样例宣称已实测。

首装激活需要主分支实际安装工作流；未完成合入/激活时，本功能尚未生效。guard 自身修复也会失败，后续通过同一 Human bypass 流程交付。
