# 实现验收第一轮补充修复与验证

日期：2026-10-05（Asia/Shanghai）。Run：run-20261003-090655z-f1e492f6。
Review：review-20261005-034612z-e11cf3b0；Round：round-20261005-034612z-aa5a54fb。

本文记录第一轮已提交意见的实际处置，不改写原 Submission、正式 Vote 或原验证日志。本轮模拟 ACP Session 的完整回归及全部独立检查已通过，供 Runner 决策使用。

## 接受研发意见并复现

研发 comment-20261005-035653z-329a9ac8 指出：在真实 ACP Session 中执行全量测试时，旧 fake launcher 测试继承宿主 MEMSPHERE_CONFIG_PATH，Memory 命令自动注入 Session Project，断言仍使用无 Project 的参数列表，导致全量 1 项失败。

在修改测试之前，使用隔离临时目录中的 project.json/config.json 和虚构 Session 标识，实际复现旧用例退出 1，参数列表多出 `--project host-session-project`。复现命令为 `node --import tsx --test --test-name-pattern='Agent Review CLI launcher injects Session bindings without shell environment syntax' test/agent-review.test.ts`。日志 `/tmp/memsphere-acp-launcher-repro.log`、状态 `/tmp/memsphere-acp-launcher-repro.status.json`；环境说明 `/tmp/memsphere-acp-validation-environment.json` 不含真实凭据。

测试修正为显式清除宿主的 MEMSPHERE_* 变量，再注入每个 fixture 所需的 Home 和 Session 配置。保留系统进程环境，不修改产品 guard；全部 allowlist、Run/Assignment 绑定、普通和冻结 Memory 的既有拒绝断言保留。

新增真实 Session manifest 相关用例：Project 及普通/冻结 Memory 作用域注入、匹配参数、跨 Project/Run 和重复冲突参数拒绝、`--` 后字面参数不被当作权限选择、缺失/坏 manifest 拒绝。另用真实 CLI 与真实临时 Embedded Git Project 验证普通/冻结 Memory 列表和读取，只能看到对应内容；不以 fake 参数列表代替实际 CLI 证明。

新增真实 Session 用例及其一次定向复验因前置 Memory Store 和 Embedded Project fixture 不完整而失败。补齐全部 Memory kind，并采用实际 Git Embedded Project 和正确 cwd 后通过；没有删除或弱化真实用例。失败日志 `/tmp/memsphere-acp-launcher-fixed.log`、`/tmp/memsphere-acp-session-memory-fixed.log`，通过日志 `/tmp/memsphere-acp-launcher-fixed-final.log` 分开保留。该次定向 18 项：17 通过、0 失败、1 Windows 专属跳过。随后同文件其他 fake Provider/Client 的宿主变量也显式隔离；最后定向及完整结果以最终证据为准。

## 目录限制意见与契约依据

测试 comment-20261005-035001z-02c44d34 要求所有业务 directory 限制为 Project-relative。已批准的第八轮需求第 4 节明确允许绝对路径，要求相对路径从 Registry Project 根解析，再统一检查存储重叠和兼容性。该建议将改变已批准行为，按 rejected-invalid 记录，正式意见与票保留原样；详细依据见 implementation-acceptance-round-1-directory-disposition.md。

新增三项 API/CLI 回归真实通过：两种 Factory 的外部绝对目录创建、写入、已有配置读取、解除及重新登记保留内容和 mtime；`../outside` 从 Registry 根解析，对与绝对绑定相同的物理目录拒绝重叠，解绑后可正常使用；真实 CLI 为两种 Store 执行完整流程，共 14 次独立启动。

实际定向命令：`node --import tsx --test --test-name-pattern='absolute directories|parent-relative Store paths' test/business-data-service.test.ts test/data-command.test.ts`，3/3 通过，退出 0，约 11.36 秒。原有系统区域/linked Memory/别名/文件协议拒绝测试保留，并纳入完整回归。

README 中英、发行 Skill、framework 源及当前开发副本澄清“相对 directory 按 Registry 根解析，绝对 directory 按指定位置解析，两者使用同一重叠和兼容检查”。没有新增标准、旧内容豁免、产品代码变更或 Memory DSL 关键字。

## 最终门槛

完整回归在模拟 ACP Session 的宿主环境中执行，保留虚构 MEMSPHERE_CONFIG_PATH、Run、冻结 Memory Run、Assignment 和 Review 标识，验证用例不会因执行位置不同而失败。真实通过之前不将先前普通环境的通过结果作为本项修复证明。

最终全量 `npm test -- --test-concurrency=1` 退出 0：1,068 项、1,067 通过、0 失败、1 Windows 专属跳过，实际耗时 536.996 秒（含 pretest build），TAP 执行耗时 526.410 秒。日志 `/tmp/memsphere-model-data-acp-full-test.log`，状态 `/tmp/memsphere-model-data-acp-full-test.status.json`，日志 SHA-256 `d0e9009b1340d6b2dc0cd8f44f3ce0e8334b987a18289b65ca16d7ce6d4e5e3b`。最后定向 `/tmp/memsphere-acp-launcher-audited.log`：18 项、17 通过、0 失败、1 Windows 专属跳过，耗时 17.409 秒。

独立 `npm run typecheck` 退出 0（9.153 秒）、`npm run build` 退出 0（10.816 秒）；`node scripts/project-smoke.mjs` 退出 0（2.528 秒）、`node scripts/model-data-smoke.mjs` 退出 0（12.911 秒）、`node scripts/model-data-package-smoke.mjs` 退出 0（18.916 秒）。最后一项实际 npm pack/install 后运行已安装 CLI。各项均在同一合成 ACP 宿主环境执行，命令、退出码、日志及 SHA-256 见 ../review-verification-results.json；不以全量 pretest 代替独立构建结果。旧初始验证报告和第一轮 Submission 的历史结果保持原样。

`node dist/cli.js --project memsphere validate` 与 `node dist/cli.js --project memsphere memory change validate` 均退出 0。ChangeSet `change-20261005-031024825z-a1b5f8c3`，validation passed，当前 digest `57cd421178ab8068812af88bfd18e6f6f6cc0b675513e895f7edb5d345d8bffc`，base `2b7400b0d3bff6670982ebcd0a02f023a6859e34`。View：<http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3>。三份 System Memory 源及开发副本字节相同，校验后未再修改 Memory；结果另存 review-memory-validation.json。该 digest 替代先前普通环境报告所记录的旧 digest，旧报告作为历史保留。

## 审阅与决策边界

Human 本轮 approve、0 Comment 已受托提交；架构 Agent approve。研发与测试 Agent 的 request_changes 保留为正式意见，不改成通过或代其投票。Runner 在充分验证后分别以 accepted-fixed 与 rejected-invalid 记录依据，再独立决定本轮是否可接受。

产品实现和已确认行为均未改变，补充范围为测试环境隔离、已有契约回归和文字澄清。第一轮冻结验收材料 SHA-256 c61b3907c9c1741bce7628a68fd0f080e9964b21ca56e2ce53d374d4bc353281 保持原字节；补充证据及最终 Memory 内容另行明确列出。
