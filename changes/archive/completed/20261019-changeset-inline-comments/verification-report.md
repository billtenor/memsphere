# 初始验证报告

## 验证对象与规范

本轮最终源代码为合并 origin/master b8fa54c 后的当前工作区；精确文件 SHA-256 见 evidence/test-summary.json。采用 statements/memsphere-repository-testing-rules，先受影响测试、再全量，并在实际官方 View Shell 验证交互。浏览器驱动 View 测试属于集成测试，不称为单元测试。

## 实际自动化结果

| 命令 | 结果 |
| --- | --- |
| npm run typecheck | passed |
| node --import tsx --test test/builtin-memory-view.test.ts test/memory-changeset-collaboration.test.ts test/memory-diff.test.ts test/disclosure-state.test.ts | 35 passed, 0 failed |
| node --import tsx --test test/reserved-store.test.ts test/view-style-contract.test.ts test/view-global-style-contract.test.ts test/view-locales.test.ts | 27 passed, 0 failed |
| npm test | 149/149 文件，1247 passed，0 failed，2 平台条件 skipped，364.76 秒 |
| npm run build | 在 npm test 的 pretest 中实际执行并通过；最终构建随后用于真实 30000 Shell |
| node dist/cli.js validate | passed，当前 Project Store |
| node dist/cli.js memory change validate change-20261019-145538606z-5db05ae5 | passed，最终内容 digest 未变化 |
| git diff --check | passed |

两个 skipped 是 Linux 上不适用的 Windows PowerShell/CMD/Git Bash review 命令测试，以及 Windows 文件共享语义的 Run lock 测试；不是本轮新跳过，也没有修改跳过条件。Windows/macOS 的适用项目将在 PR CI 验证，当前未声称跨平台 CI 已通过。npm test 完整原始日志留在本机临时日志，仓库只保存非敏感结构化结果和源文件摘要，不提交个人路径或凭据。

## 实际 Shell 操作

使用 playwright-cli + Chromium，在当前构建的正式 http://localhost:30000 Shell，以隔离真实 Managed Project/ChangeSet 进行操作，无 mock 路由或独立前端端口。完整步骤、命令依据和结果见 evidence/playwright.md，截图见 real-shell-desktop.png、real-shell-narrow.png、completed-shell.png。

验证通过：Added hover 几何不变，章节 + 移入后可 click，评论提交后原行和侧栏均显示，原行编辑后两处更新，删除后两处消失；切换差异/完整内容和完整刷新后手动展开可读；主动收起后侧栏重渲染不强制展开；1920/500 内容无横向溢出；执行上下文 pageerror=[]。仅发布测试 Project，使测试 ChangeSet completed 后 + 和修改动作数量均为 0，已保存结构评论原行可见。未改动用户原有业务评论。

原始用户历史 ChangeSet 已 unavailable/changeset_not_found，因此使用明确标记的隔离真实记录，不以失效历史链接作为唯一证据。窄屏截图包含现有 Shell 长标题布局，本轮只断言评论和正文宽度，不宣称重做 Shell Header。

## 回归与错误归因

首次合并调查 25/26，失败来自新增双处评论展示与 master 无作用域选择器冲突；已修正选择器作用域并保留/增强原展开状态和编辑删除同步断言。修正后受影响 35/35 和全量均通过。没有未解决的本轮测试失败或环境阻塞；历史 Provider 阻塞未发生在本 Run，不作为本轮证据。

## Memory 最终证据

- ChangeSet: change-20261019-145538606z-5db05ae5
- 状态：valid / passed
- Base: b8fa54c912afbc49bdd01e7bd33b5d935e46ca1c
- Digest: ae7a2cf040b086915be9710853771f0082f5bd9cb8624b5e5de258209a8af348
- View: http://localhost:30000/projects/memsphere/changes/change-20261019-145538606z-5db05ae5

reserved 源与开发 Project 副本 SHA-256 相同（见 test-summary.json），Skill 同步，manifest 身份未改变。普通 validate 和变更级 validate 分别执行，没有互相替代。

## 尚未执行项与残余风险

独立实现验收、产品交付评审、commit/PR、远端最新 head 的全部适用 CI 尚未完成。不把本报告视为这些步骤的通过结论。无锚点/整体意见只有侧栏，不猜测；基线或删除内容无候选入口，终态与 claimed 只读 UI。测试 Project 仅用于可复验的真实验收，评审后准确清理其登记和目录。

## 第二轮最终验证

第一轮实现验收由测试 Agent 找到结构章节自身评论不随章节收起的问题，已接纳并修复。最终重新执行受影响 35/35、reserved/style/locale 27/27、typecheck、全量 npm test（149 文件，1247 passed，0 failed，2 Windows-only skips，364.76s，含 build）及真实 30000 Shell 全流程。新增结构评论保存/自身章节收起/侧栏保留/重新展开反例已通过。最终源 SHA 和当前 Memory digest 已更新，所有最终验收结果来自修订后代码，不用第一轮通过结果替代。
