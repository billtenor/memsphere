# 模型与数据 CLI：初始验证报告

Run：`run-20261003-090655z-f1e492f6`。日期：2026-10-05。候选为当前 `codex/model-data-cli` 工作树；未提交 Git/PR。最终全量已通过，独立门槛及发行验证结果在下节记录。

## 验证环境与方法

本地 Linux、Node 22.16.0、npm 10.9.2。依赖按 package-lock 安装；原生文件锁和 JSONPath 依赖使用固定版本。沙盒内 Node 子进程出现 EPERM，有包装返回 0 或仅输出文件级 TAP；这些结果全部排除。以下真实 Node/CLI/浏览器/构建验证在获准的沙盒外执行，观察实际 test case、失败数和退出码。

测试先覆盖受影响模块，再运行 `npm test -- --test-concurrency=1`；串行安排用于避免浏览器与真实进程套件过度争用，未选择文件子集。npm pretest 构建发行产物。临时 Home/Project 使用独立目录，未以真实 Project 的修正代替故障或并发测试。

## 已执行的定向验证

| 实际命令/范围 | 结果与主要证据 |
| --- | --- |
| `node --import tsx --test test/model-operation.test.ts` | 11/11 通过；独立 fork 与 IPC 屏障，在 pending 和三个文件写入点 SIGKILL；恢复自身再中断；不同新写请求先恢复后预检；读零写；外部新内容保留、路径/符号链接拒绝 |
| `node --import tsx --test test/model-service.test.ts test/model-command.test.ts test/config-management.test.ts` | 30/30 通过；真实 CLI/stdin/JSON 流、系统全字段只读、定义原文、Runtime 错误、修复坏定义、直接空 Store 保护、候选 check-data、配置保留和重叠拒绝 |
| `node --import tsx --test test/business-data-service.test.ts test/data-command.test.ts`（最终补充回归） | 37/37 通过，包含子测试；全部 JSON 根值、最终态 Patch、纯读/dry-run、Payload/MIME、解绑重登记、能力；真实 Git linked worktree Memory 拒绝登记；constructor/toString 正常，__proto__ 新旧一致拒绝；不兼容 raw ValueStore 明确不可用，四项能力为 false |
| 文件系统基础与 Factory/锁/版本相关八个文件 | 93/93 通过；openExisting 不建目录、持久记录协议、跨进程写与 CAS、删除历史、MIME 映射和原子发布；后续底层记录协议六项回归 6/6 通过 |
| `node --import tsx --test test/data-filesystem-process.test.ts test/data-command.test.ts`（补充并发和丢失回执回归） | 当次 23/23 通过，14 个独立 Factory 进程测试 + 9 个当时 CLI 测试；SIGKILL 已提交但回执丢失后完整可读，Factory 删除→CLI 重建后旧版本拒绝。最终 CLI 新增项由上行及全量覆盖 |
| 分页/旧 Memory/Reviewer/解析相关定向文件 | 91/91 通过；六种 list、Memory 子节点和冻结 Reviewer 的实际 CLI 翻页、过滤、scope/参数错误及 JSON/YAML/文本；另旧 Memory 59 通过、0 失败、1 Windows 专属跳过 |
| 模型/引用/定义校验/系统资源及装配相关定向文件 | 68/68、44/44、15/15 通过；原文、统一 ID、无跨模型引用、Runtime 不支持区分、初始化与恢复、Run/raw、模型市场和 View state/slots。具体用例均纳入最终全量，不累加为总数 |
| `node --import tsx --test test/archive-run-data.test.ts test/run-data-access.test.ts` 及相关修正回归 | 39/39 通过；修正 fixture 将模型 ID 错用作 Run Store ID，保留原归档/内容完整性断言 |
| `node --import tsx --test test/view-settings.test.ts` | 11/11 通过；实际 HTTP 的权限 401、旧 revision 409、默认八例 Runtime 拒绝 422、零发布；合规六例经真实 service 导入并由 View 读取；历史未完成导入的显式清理。成功导入不声称走默认包 HTTP |
| JSONPath/JSON Patch、数据 service/CLI 首次组合 | 32/32 通过；此后 service/CLI 增补由 37 项与全量覆盖；查询根、切片、递归、筛选、函数、特殊字段、空/null/数组；Patch 六操作、数组/根、特殊键、失败零保存 |
| `test/models-builtin-view-browser.test.ts` | 31 项通过；真实 View HTTP + Chromium，统一 ID、结构展示、内部引用与递归、完整 Runtime 不支持、市场与配置交互 |
| `node --import tsx --test test/reserved-store.test.ts test/skill-store.test.ts` | 12/12 通过；System Memory 源、安装和 Skill。此前命令还列了不存在的 prompt-registry 文件，不把它当作实际运行；正确 prompt-renderer 套件纳入全量 |

上述局部执行次数有重叠，不作为全量测试数量相加。正式结果以最终全量 TAP 为准。

## 首轮全量失败及处置

首轮 `npm test -- --test-concurrency=1` 实际执行 1,049 项：1,025 通过、23 失败、1 Windows 专属跳过；退出 1，总耗时 517.451 秒，TAP 耗时 506.201 秒。保留原日志 `/tmp/memsphere-model-data-full-test.log` 和同前缀 `.status.json`。

其中 21 项 archive-run-data 失败来自测试在模型 ID 增加 .json 后，仍将模型 ID 拼接为 Run Store ID。正式 Store ID 和目录应保持原样；修正三份 fixture/测试采用明确的模型与 Store 映射，原完整性断言保留，39 项定向回归通过。

另两项 view-settings 仍期待含不支持规则的八例整包成功，以及旧导入实现生成的 staging。按第八轮批准契约改为默认整包明确拒绝、文件零变化；合规资源覆盖成功路径，真实历史未完成状态覆盖 cleanup。没有删除测试、跳过断言、弱化 04/05 约束或扩展 Runtime。11 项定向回归通过。

## 最终门槛与发行验证

最终 `npm test -- --test-concurrency=1` 退出 0：1,062 项，1,061 通过、0 失败、1 项 Windows 专属跳过；总耗时 519.256 秒，TAP 耗时 508.546 秒。独立 `npm run typecheck`、`npm run build`、`node scripts/project-smoke.mjs`、`node scripts/model-data-smoke.mjs`、`node scripts/model-data-package-smoke.mjs` 均退出 0。安装包验证先 npm pack、安装到临时目录，再执行已安装 CLI 与原生锁。确切退出码、耗时和日志摘要写入 `verification-results.json`。最终全量日志为 `/tmp/memsphere-model-data-full-test-final.log`，状态为 `/tmp/memsphere-model-data-full-test-final.status.json`，不覆盖首轮证据。

完整实际浏览器命令与模型侧测试组合见 `browser-verification.md`。模型 ID 调整影响的实际 View 交互已用 playwright-cli 操作：统一系统 ID、raw/JSON 模型显示、正常结构、不支持错误、模型市场 422 零发布、旧 ID 422；不依赖 mock。真实开发 Project 的初始化与 raw Run 状态/产物读取已验证，10,679 份初始化前既有历史文件字节不变，见 `actual-project-audit.json`。

## 最终 Memory 校验

实际执行新构建 `node dist/cli.js --project memsphere validate`：通过，检查当前 worktree Memory Store。另执行 `node dist/cli.js --project memsphere memory change validate`：通过。

- ChangeSet：`change-20261005-031024825z-a1b5f8c3`。
- Store：embedded；生命周期 active；validation passed。
- Base Revision：`2b7400b0d3bff6670982ebcd0a02f023a6859e34`。
- Content Digest：`e62d52dda1c709b34a59320245f3fa899f6092e8b550ade9c5c82e7d4a654022`。
- View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3 。

三份 System Memory 源与工作树副本一致，没有新增 identity 或 DSL 关键字。此后若修改 Memory，须再次执行变更级校验并更新以上证据。

## 未验证项和限制

本地未执行 Node 20/macOS/Windows，已在 CI 配置这些平台的 native lock、真实进程条件写、CLI 和安装包验证，尚无远程 CI 通过声明。未测试网络文件系统；不承诺网络锁、整机断电后持久性或外部手工修改协作。

模型 SIGKILL 覆盖共同服务的写入 pending、file-0/1/2，以及恢复 pending、file-0；initialize/市场另测共用服务、拒绝、回滚及幂等，维护恢复另测拒绝和原字节保护。没有模型 committed 后丢回执的专项 SIGKILL、合规历史包成功恢复，或每个业务入口逐个 SIGKILL 的声明。纯读与 dry-run 检查目录、文件、字节和 mtime；读取没有自动恢复。分页/数据检查无快照，JSON DataStore 无 revision/edit，这些均为已批准边界。

正式研发、测试、架构和 Human 验收尚待进行，本文不把自动化通过当作正式接受。
