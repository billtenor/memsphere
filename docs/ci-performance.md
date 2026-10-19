# CI 分层与测试精简

## 必须守住的边界

测试按用户可观察契约和真实运行边界选择。删除、合并或下沉必须说明重复保护及覆盖代价；不得为隐藏失败而删断言、跳过测试或放宽验收。保留教程安全规则、数据发布/回滚、权限、并发与原生文件/进程保护。

`npm test` 仍构建并运行全部保留的 `test/*.test.ts`，每个文件使用独立临时 MEMSPHERE_HOME，文件内部串行；`--test-concurrency=N` 控制文件进程数。`--results=<path>` 或 CI_TEST_RESULTS 保存计划与实际结果。失败不停止其他文件，不转换为成功。`pretest:ci` 每个测试job构建一次，Windows安装包使用 `npm pack --ignore-scripts` 复用该job产物；不跨OS共享dist。

## 默认 PR / master push

统一Node22，Linux固定Ubuntu24.04（当前Playwright不支持Ubuntu26.04）。默认矩阵由 `scripts/ci-plan.mjs` 生成：

| 平台 | 套件 | 文件并发 |
|---|---|---|
| Linux | Browser UI / CLI & Packaging / Projects & Memory / Run, Data & SDK | 3 / 3 / 2 / 2 |
| macOS | Platform & Upgrade Contracts | 3 |
| Windows | Platform Contracts / Project Upgrades | 4 / 3 |
| Windows | 真实npm安装包、Run/View及四种Shell冒烟 | 独立job |

Linux对每个保留文件恰好执行一次，macOS和Windows对平台风险集增加执行，macOS同job包含全部升级测试，Windows升级单独分组。新增测试默认进入Linux和完整检查，不要求人工登记才会执行。39项平台清单位于 `scripts/test-plan.mjs` 的platformTests，缺失清单文件会使计划生成失败；平台差异新增时同时更新风险审计和清单。Chromium安装依据实际选集自动计算，不按文件名或job标题猜测。

默认CI与Security的整条workflow目标均为300秒（含排队）。原 `scripts/ci-budget.mjs` 保持285秒检查线，为清理预留15秒；测试/打包job仍5分钟超时。精简目的包括降低总消耗，不能只用更多runner换取墙钟时间。

## 每日 / 发布前完整检查

每天UTC02:30自动对默认分支运行full。GitHub Actions的CI工作流支持手动选择ref和profile（default/full，手动默认full）：

```bash
gh workflow run ci.yml --ref <branch-or-tag> -f profile=full
gh run list --workflow ci.yml --branch <branch>
gh run watch <run-id> --exit-status
```

必须核验run的head SHA为目标提交；仅看到某次历史full通过不足以证明当前版本可发布。发布前待发布SHA必须具备成功的full记录，失败或缺失不得声明可发布。当前没有自动发布流水线，此项是维护者的发布要求，不宣称已建立平台强制发布门禁。

full复用既有17个suite行：Linux4、macOS5、Windows8，再加Windows打包。每个OS对所有保留文件恰好执行一次；各行原有2–4文件进程数不变，单job10分钟有界超时。它验证跨平台质量，不适用PR五分钟反馈预算；该预算作业明确不适用，而不是伪报为成功。`Full cross-platform regression`必须等全部测试/打包成功才成功。

并发组包含default/full和PR号或ref。default继续取消同目标旧default运行；full不取消已运行的full，并与default互不取消，防止master push消掉每日回归。失败保持Actions失败状态，由相关模块维护者负责修复；本需求执行期间由Runner负责跟进。每日检查会延迟暴露未进入PR平台集的OS特有故障，这是降低逐PR重复成本的明确代价。full触发自身失败也必须处理。

## 平台风险与降频边界

审计src中process.platform、realpath、symlink和终止信号的81处匹配，并与测试交叉检查。平台清单不是对所有原生操作自动证明覆盖；后续变更需要更新相关映射。

| 代码边界 | 逐PR平台保护（均为.test.ts文件） |
|---|---|
| project/resolver、workspace、registry，home、Git路径 | project-resolver、project-registry、home、git、model-storage-paths |
| Embedded repair的chmod CAS、literal pathspec、链接kind目录拒绝和写后回滚 | project-command（整个文件保留，非仅参数矩阵） |
| Report与快照补齐 | run-store、report-execution、run-memory-backfill（含Windows junction） |
| 原生锁、原子写入与跨进程记录 | file-lock、persistence、data-filesystem-process/open/revisions/json-valuestore/datastore/helpers、business-data-service |
| 模型事务、注册目录与备份还原 | model-service、model-operation、model-registration、example-relocation |
| Memory链接、Git隔离、受控更新 | memory-changeset、embedded-changeset、memory-sync、reserved-store、system-upgrade-changeset、reserved-models；另含3个project-upgrade文件 |
| App/Module包路径、外部CLI与资源 | app-install、view-package-registry |
| ACP进程、Shell、命令提示 | agent-review、run-output、run-rule-integration、run-model-artifact、windows-prerequisites、cli-errors |
| 服务、归档、配置 | view-service、archive-store、config-management |

其余Schema/语法组合、CLI消息与选项组合、View大部分浏览器场景逐PR在Linux运行，macOS/Windows全组合每日或发布前运行。保留文件内部有部分纯逻辑断言，本轮不为进一步减少毫秒级开销继续拆分。

## 本轮删减审计

基于master332b562（PR104合入），未修改产品行为或教程安全规则。

| 删除的独立用例 | 剩余保护 / 接受减少的约束 |
|---|---|
| view-host：document boots the builtin Module instances in catalog order | 启动metadata、locale、runtime、routeGrants、messages及SDK import-map断言合并到同文件真实HTTP的serves Host/SDK/Runtime用例；实际加载、失败与Retry保护保留。去掉特定内联源码调用名匹配。 |
| view-shell-layout：resizers expose separate accessible handles with bounded widths | aria边界断言迁入view-responsive的真实拖动、键盘、持久化与复位用例。 |
| view-shell-layout：Project Home and Project switching expose separate accessible controls | Home链接、独立菜单和无障碍属性断言迁入view-project-switch的真实导航和并发隔离用例。 |
| view-style-contract：share one canonical Procedure flow renderer | shared renderer样式边界检查并入官方样式用例；保留Memory/Run的嵌套流程及Human标记行为回归。接受不再锁定内部import、函数名和旧CSS名；不改变共享实现。 |

`product-positioning.test.ts`保持原样，尤其教程发布授权与系统/挂载Memory保护等独有安全规则。系统Memory API分类用例从view-responsive迁至无浏览器的view-browser HTTP集成，保留改名路径、system/user分类及响应字段断言，避免为fetch API启动浏览器及庞大Run fixture。

布局检查由60个几何点减为18个精确tuple，ChangeSet意见栏和扩展包交互仍单独保留：

- en/light：四类Memory和Run五路径分别1280px（5点）。
- en/light：长Concept、Procedure、Run三路径分别821/820/390px（9点）。
- en/light：Procedure和Run分别2560px（2点）。
- zh-CN/dark：Procedure和Run分别1280px（2点）。

原对称留白、主题Token、无溢出、宽屏利用和意见堆叠断言保留。接受不再每类Memory×主题×宽度全组合；测试验证18个tuple无重复。用例数量、文件数和几何组合分开计量，不能互相充数。

## 基线与测量

历史run39218044291：148文件×3OS=444次文件执行；17测试行+1打包job=18次完整构建；这18个job的completedAt-startedAt合计2849秒（47.48分钟），非CPU或账单时间，未含作业排队。预算计时244.1秒含排队，仅作历史对照。

集成最新master新增用例后，当前149个保留文件，默认执行233次（149+42+39+3），相对原444次基线减少47.5%；完整构建8次，减少55.6%。另有不构建的profile计划和结果汇总job，不能把它们漏记成“整个workflow只有8个job”。full成本单列，不能混算成PR节省。最终耗时以当前head实际CI为准，记录事件/profile、SHA和环境波动。
