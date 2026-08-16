---
id: 20260817-native-project-memory-lifecycle
status: doing
type: feature
created: 2026-08-17
run_id: run-20260816-163437z-67d3cdbd
---

# Memsphere 原生 Project 分域与 Memory 生命周期

## 需求管理摘要

Memsphere 当前通过不同代码目录中的 `.memsphere` 实现数据分域，运行数据会随临时 Git worktree 分散和丢失，也无法自然支持个人 Memory、仓库 Memory 与跨仓库共享 Memory。本需求以不兼容升级引入独立 Project、Workspace Binding、Managed/Embedded Memory Store、只读 Mounted Project 和完整 ChangeSet 生命周期，并将 View 改为全局多 Project 服务。

当前已启动敏捷需求开发流程，状态为 `doing`。

## 需求

### 背景与问题

当前运行目录默认位于代码仓库或 worktree 的 `.memsphere`：

- 临时 worktree 被回收时，Memory、Run、Review 和 Archive 可能随之丢失。
- 把数据统一放在某个主 worktree 又会让多个 Agent 竞争同一批普通文件。
- 团队代码仓库未必适合管理个人 Memory；个人 Memory 又需要独立 Git 历史。
- 仅依靠代码目录区分 Scope，会让同一用户的 Memsphere 数据散落在多个仓库中。
- 仓库经验与个人职业经验可能需要共同读取，但它们属于独立演进、互不引用的 Memory Store。

Memsphere 需要原生 Project 分域。Project 是 Memory、ChangeSet、Run、Review 和 Archive 的持久数据空间，不等同于代码仓库或 Agent Workspace。

### Project 与 Workspace

- `project_name` 是 Project 的唯一标志，在本机全局唯一。
- 名称只允许小写 ASCII 字母、数字、`.`、`_` 和 `-`，首版创建后不可重命名。
- Workspace 是 Agent 当前操作的代码目录或 Git worktree。
- 一个 Workspace 只能绑定一个 Primary Project；一个 Project 可以绑定多个 Workspace。
- Git Workspace 按 Git common dir 绑定，因此同一仓库的 linked worktree 共享 Primary 和 Mounted 配置；非 Git Workspace 按规范化目录路径绑定。
- Binding 保存在全局 Registry，不修改业务仓库。
- Registry 按 Workspace 保存 `Primary Project + Mounted Projects[]`。
- 已有 Primary 时，绑定其他 Project 直接报错；用户必须先显式解绑并自行处理 Mounted 列表，不提供替换捷径。
- 日常命令根据 Binding 解析 Primary；`--project <name>` 只对本次命令临时选择目标，不修改 Binding。

### Memsphere Home 与 Project Root

Memsphere Home 使用操作系统标准用户数据目录：

```text
Linux:   $XDG_DATA_HOME/memsphere
         默认 ~/.local/share/memsphere
macOS:   ~/Library/Application Support/memsphere
Windows: %LOCALAPPDATA%\memsphere
```

允许使用 `MEMSPHERE_HOME` 整体覆盖，但不允许分别配置 Memory、Runs、Reviews 或 Archives 等子目录。

```text
<memsphere-home>/
├── config.json
├── registry.json
└── projects/
    └── <project-name>/
        ├── project.json
        ├── config.json
        ├── memory/
        ├── changes/
        ├── runs/
        ├── reviews/
        ├── archives/
        ├── evals/
        └── .runtime/
```

- Project Root 是可整体移动、备份和恢复的数据单元。
- `project.json` 只保存稳定身份和格式版本等清单信息。
- 全局 `config.json` 保存 View、语言、本机 Agent Provider 和 Debug 等机器设置。
- Project `config.json` 保存 Store 模式、Git 分支以及 Control Plane、Actor 和 Review 策略。
- Workspace 不创建配置文件。
- 只有 Memory Store 使用 Git；Config、ChangeSet、Run、Review 和 Archive 不自动提交 Git。

### Project CLI 生命周期

- `project create <name>` 创建独立 Project，默认使用 Managed Store。
- Embedded Store 必须显式使用 `project create <name> --embedded <path>`。
- `project clone <git-url-or-local-repo> --name <name>` 克隆已有 Managed Memory Git 仓库。
- `project register <project-root>` 登记整体移动或恢复后的完整 Project Root。
- `create`、`clone` 和 `register` 默认不改变 Workspace Binding；三者可以使用 `--bind` 顺便绑定当前 Workspace。
- 带 `--bind` 时若当前 Workspace 已有 Primary，必须在产生 Project 副作用前拒绝；不提供组合式 `--replace`。
- 不提供 `--no-bind`、`project move` 或 `project delete`。
- 用户自行移动 Project Root；旧注册地址失效后，`register` 可以更新路径。
- 同名 Project 的旧注册地址仍有效时，`register` 必须拒绝，不提供 `--replace`。
- 用户自行删除 Project Root；`project list` 将其标记为 `missing`，`project prune` 只清理 Root 已不存在的注册、Binding 和 Mount 记录。
- `project list` 提供 Registry 快速总览；`project show [name]` 提供完整本地健康检查，二者都不隐式联网或执行 fetch。
- 旧 `memsphere init` 直接删除，不保留别名、兼容逻辑或专门提示。

### Primary Memory Store 模式

一个 Project 选择一种 Primary Memory Store 模式。

#### Managed Store

- `<project-root>/memory/` 是独立的普通 Git 工作树，不使用 Bare Store。
- `project create` 初始化稳定 `master` 分支和空 Root Commit，确保首个 ChangeSet 也有 Base Revision。
- Root Commit 不加入 README、占位 Memory 或隐藏 Manifest，使用固定消息 `Initialize Memsphere Memory Store`。
- Git author/committer 使用 Memory 仓库或用户全局 Git 配置；缺少身份时创建或 Publish 失败并给出配置方法。
- `project clone` 要求目标仓库至少已有一个 commit；完全空的仓库直接报错，由用户人工处理。
- 用户可以使用只读 Git 命令查看 log、show 和 diff，但不支持手动修改正式工作树、切换受控分支、reset、rebase 或 force-update。

#### Embedded Store

- Memory 位于现有代码仓库，例如 `.memsphere/memory/`，不创建嵌套 Git 仓库。
- Memory 随代码 branch、commit 和 PR/MR 演进，Agent 直接编辑仓库内 YAML。
- Embedded Store 不使用 Managed ChangeSet 候选层。
- 首版只支持同一代码仓库的 worktree；跨多个代码仓库共享 Memory 必须使用独立 Managed Project。

### Mounted Project

- 一个 Workspace 可以在 Primary 之外挂载多个独立 Project，用于读取个人职业经验或组织通用经验。
- `project mount <name>` 和 `project unmount <name>` 只修改当前 Workspace 的 Registry 关系。
- Mounted Project 在 Workspace 的组合 Memory Context 中严格只读，不拥有当前 Workspace 的 Run、Review 或 Archive，也不成为隐式写入目标。
- 首版不提供 alias、权重、覆盖或跨 Project 合并。
- 搜索同时返回全部可见 Project 的结果，并标注 `project_name` 和 Revision。
- 精确名称只有一个命中时直接读取；多个 Project 存在同名 Memory 时直接报歧义，要求 `--project <name>`，不得按 Primary 或挂载顺序自动选择。
- 不允许跨 Project `!ref` 或跨 Project 依赖图。
- 显式使用 `--project` 时可以独立编辑一个未绑定或当前被 Mounted 的 Managed Project，但其 ChangeSet 只使用目标 Project，不继承当前 Workspace 的 Primary 或 Mounted Context。
- Run 启动时冻结 Primary 和全部 Mounted Project 的名称与 Revision；运行期间的发布、挂载或卸载不改变该 Run。

### Revision 与 Git 分支

- Memory Store Revision 使用 Git commit SHA；单份 Memory Version 使用其 YAML blob SHA。
- Store Revision 表示相互引用的完整 Memory 一致快照，Run 必须记录精确 Revision。
- 不增加整个 Project 的统一 Revision。
- Managed Store 的 ChangeSet 不创建临时 Git branch；候选隔离由 ChangeSet 自身承担。
- 无共享远端的个人 Store 可以只使用 `master`。
- 分布式 Store 使用长期个人受控分支，例如 `users/liuyanjun`；组织正式 Memory 使用远端 `master`。
- `project clone` 未传 `--branch` 时使用远端默认分支；传入个人分支时可以通过 `--upstream origin/master` 指定组织上游。
- 分支配置写入 Project Config，Memsphere 不根据当前 checkout 临时猜测。
- `memory publish` 只在本地受控分支创建 commit，不访问网络。
- `memory push` 只执行正常 fast-forward Push，禁止 force push。
- `memory sync` 使用 merge 同步组织上游，不使用 rebase，保证已被 Run 引用的 Revision 长期可追溯。
- 无冲突时完整校验合并树后创建 Merge Commit；有冲突时不污染正式工作树，而是在 Agent Workspace 生成 Sync ChangeSet，解决后通过 `memory sync publish` 创建双 parent Merge Commit。
- PR/MR 创建首版交给代码托管平台或现有 CLI，Memsphere 不建设托管平台工作流。

### Managed ChangeSet 生命周期

Memory 创建、编辑、删除、重命名和 Publish 统一使用 ChangeSet，不建设第二套 Run 治理机制。

- 最小编辑流程为 `memory edit` 创建候选、Agent 自由编辑 YAML、`memory publish` 正式提交。
- 一个 ChangeSet 可以同时创建和修改多份 Memory，并允许编辑过程中追加目标。
- 删除和重命名必须使用两阶段 ChangeSet，不提供一键强制操作。
- 每个目标记录自身 `base_digest` 和加入时的 Store Revision。
- Publish 使用所有候选构造完整结果图；任一冲突或校验失败时全部不生效。
- 同一 Workspace 可以有多个未完成 ChangeSet，命令使用明确的 `change_id`。
- 一个 ChangeSet 严格属于一个 Project；Base Revision、依赖图、校验和 Publish 都不包含 Mounted Memory。
- 候选 YAML 位于 `<workspace>/.memsphere-work/changes/<change-id>/memory/`，让 Agent 在文件系统权限边界内直接编辑。
- Project `changes/<change-id>/` 保存权威元数据和一份尽力而为的最新候选恢复副本。
- 只有执行 `memsphere validate` 时，才把当前 Workspace 的候选覆盖保存到 Project；成功或失败都可以保存，其他命令不触发。
- 不提供显式 Checkpoint、watcher、后台同步、重试、候选历史或跨 Workspace 自动合并。
- `memory change resume <change-id>` 从最近一次 Validate 保存的副本恢复候选。
- 同一个 ChangeSet 不支持多个 Workspace 并发编辑；未 Validate 就删除 Workspace造成的候选丢失属于可接受边界。
- Procedure Run 可以调用普通 ChangeSet 命令，但 ChangeSet 不感知 Run，Run 结果不授权或阻止 Publish；未来也不建设专用联动协议。

### Managed Publish 与 STW

Publish 必须：

1. 读取当前候选并校验 YAML、名称、引用、Schema、Procedure 和完整依赖图。
2. 对更新目标执行 `base_digest` CAS，对新增目标确认名称和别名仍不存在。
3. 获取短时发布锁，原子更新正式 Memory 工作树。
4. 创建 Git commit，并把 SHA 保存为新 Store Revision。
5. 记录 ChangeSet 审计结果。

无关 Memory 的 Store Revision 变化不能制造假冲突；只要当前目标 blob 未变化，ChangeSet 仍可发布。

正式 Managed Memory 必须持续满足：

```text
HEAD branch == controlled_publish_branch
HEAD commit == published_revision
Git working tree == clean
```

检测到外部 YAML 修改或未受控 Git 变更时，不接纳外部修改，冻结被改 Memory 及其传递依赖者。已有 Run 继续使用冻结 Revision。

恢复只提供：

- `memory recover <memory> --restore`：恢复正式版本。
- `memory recover <memory> --create-change`：先把外部差异保存为合法候选，再恢复正式版本；候选仍需正常 Publish。

不提供直接采纳外部修改、强制 Publish 或 Memsphere 原生 Memory Revert。

### View 与 CI

- 一个 `MEMSPHERE_HOME` 最多运行一个用户级 View 服务。
- `memsphere view` 不依赖启动目录，从 Registry 读取全部 Project；`--project <name>` 只指定首次打开项。
- 首版任意时刻只展示一个 Project，并提供 Project 切换；不做跨 Project聚合首页或历史 Revision 浏览器。
- `view status/stop` 管理全局服务。
- Run 详情最小展示冻结的 Primary/Mounted `project_name + Revision`，不追踪 Agent 实际读取过哪些 Memory。
- Embedded CI 复用 `memsphere validate --memory-root <path>`，该模式不读取 Registry、Binding 或本机 Project Config。
- CI 首版每次全量校验，支持带路径和行列号的文本诊断及 `--format json`；不实现增量分析、平台专用 Annotation 或仓库内 CI 配置文件。

### 不兼容升级

- 新版本不读取旧 `.memsphere` 分散目录，不提供 `project migrate`、`attach`、`import` 或兼容层。
- 旧 Memory 通过新 Project 的正常 ChangeSet 批量创建和 Publish。
- 新版本生效前清点当前用户需要继续访问的 Memory、Config、Run、Review、Archive 和脚本；仅针对当前存量数据编写一次性本地转换脚本，完成转换和校验后再切换 CLI，该脚本不进入产品 CLI。
- 不再需要迁入的数据和已结束历史目录由需求方明确确认后保留为离线备份。
- Memsphere 不删除或修改旧目录。

## 向前兼容

结论：不需要向前兼容。

本轮是 Memsphere 正式对外发布前的主动不兼容升级，当前使用者只有需求方本人。旧 CLI 保持可用期间，必须先清点存量 Memory、Config、Run、Review、Archive、脚本和活动任务；通过一次性本地脚本转换全部需要继续访问的数据，结束或明确放弃不再需要的活动任务，并验证新 Project 可读取和执行。只有完成该切换门禁后，才能启用新 CLI 并删除旧 `memsphere init`、cwd Scope 自动发现、分散 Root 配置和旧 `.memsphere` 运行时读取。这样变更生效时不存在仍依赖旧行为的数据或任务，不产生用户使用中断；一次性脚本不进入产品 CLI，旧目录继续作为备份保留。

## 验收标准

1. Linux、macOS 和 Windows 能按平台规则解析 Memsphere Home，`MEMSPHERE_HOME` 能整体覆盖；不存在可拆分 Root 的旧配置入口。
2. Project 名称格式、全局唯一和不可重命名约束有单元测试；同名 create/clone/register 均稳定拒绝。
3. `project create` 能创建完整 Managed Project Root、普通 Git Store、`master` 和空 Root Commit；缺少 Git 身份时无半成品 Project。
4. `project clone` 能处理本地及远端非空 Git 仓库、个人分支和组织上游；空仓库与非法 Memory Store 不留下可用 Project。
5. `create/clone/register` 默认不修改 Binding，`--bind` 行为一致；已有 Primary 时在产生副作用前拒绝。
6. Git common dir 下所有 linked worktree 解析到同一 Primary 与 Mounted 列表；非 Git Workspace 使用规范化路径隔离。
7. bind、unbind、mount、unmount、register 和 prune 满足本文的数据保留与拒绝规则，冲突直接报错，任何命令都不会物理删除 Project Root。
8. Primary 与多个 Mounted 的搜索结果标注来源；唯一命中正常返回，同名命中稳定报歧义；跨 Project `!ref` 校验失败。
9. Run 启动后完整冻结 Primary 和全部 Mounted Revision，后续发布或挂载变化不改变已启动 Run 的读取结果。
10. Managed ChangeSet 支持多 Memory create/update、动态追加、delete 和 rename；任一候选失败时正式 Store 完全不变。
11. 不同 ChangeSet 修改无关 Memory 时可以先后发布；修改同一基础 blob 时后发布者得到明确冲突且不覆盖。
12. `memsphere validate` 成功和失败路径都能更新当前 Workspace 的最新候选恢复副本；其他命令不触发保存；`resume` 能恢复最近副本。
13. 未 Validate 即删除 Workspace 不承诺恢复；同一 ChangeSet 的跨 Workspace 并发不被产品支持或静默合并。
14. Publish 完整校验结果树、执行目标级 CAS、短锁、原子工作树更新和 Git commit；失败时 HEAD、工作树和 published Revision 保持一致。
15. 外部修改正式 YAML、手动切换分支或改变 HEAD 会触发 STW；受影响 Memory 及传递依赖者被冻结，未受影响 Memory 和历史 Run 仍可读取。
16. `recover --restore` 与 `recover --create-change` 都能恢复 clean 不变量，后者不会自动 Publish 外部修改。
17. `memory publish` 不访问网络；`memory push` 不 force；`memory sync` 无冲突时产生通过全量校验的 Merge Commit，有冲突时正式 Store 始终 clean 并生成 Sync ChangeSet。
18. Embedded Store 不创建嵌套 Git 和 Managed ChangeSet；同仓库 worktree 可用，跨仓库共享被拒绝并提示使用 Managed Project。
19. `memsphere validate --memory-root` 在没有 Home、Registry 或 Binding 的隔离 CI 环境中完成全量校验，文本和 JSON 输出、退出码符合契约。
20. 全局 View 能列出并切换至少两个 Project；切换后 Memory、Run、Review 和 Archive 不残留前一个 Project 数据；同一 Home 不启动第二套服务。
21. 在旧 CLI 仍可用时完成存量数据和活动任务清点、一次性本地转换、脚本更新及新 Project 读取/执行校验；完成后才切换当前 CLI。随后 `memsphere init`、旧 Root 拆分配置和旧 Scope 发现路径从 CLI、帮助、Skill、预置 Memory 和文档中移除，不提供兼容提示。
22. 自动化测试覆盖 Registry 并发写、Project 锁、路径越界、符号链接逃逸、非法名称、missing Root、STW、Publish 失败恢复和多 Project 数据隔离。
23. 完成实现后执行 `npm run typecheck`、全量 `npm test`、`npm run build`、Memory Store 校验及 Linux/macOS/Windows CLI smoke，并给出测试摘要。
24. 提需方依据 CLI、View 和测试摘要确认需求验收通过后，才允许归档到 `changes/archive/completed/`。

## 范围

- 原生 Project Registry、Root、配置分层和 Workspace Binding。
- Managed/Embedded Primary Store 与只读 Mounted Project。
- Managed ChangeSet、Publish、Git Revision、STW、恢复、Push 和 Sync。
- 全局单服务 View 的 Project 切换与单 Project 展示。
- Embedded Store 的无状态 CI 校验。
- CLI、Skill、预置 Memory、测试和文档对新模型的一致适配。

## 不做事项

- Mounted Project 的组合写入、跨 Project 引用、覆盖、权重或自动合并。
- Bare Git Store、非 Git Revision 后端或整个 Project 的统一 Revision。
- Config、Run、Review 和 Archive 的自动 Git commit。
- Memsphere 原生 Revert、强制 Publish、force push 或自动 PR/MR。
- ChangeSet 与 Procedure Run 的专用联动、审批门禁或第二套治理机制。
- 候选 watcher、后台同步、显式 Checkpoint、草稿历史或多 Workspace 候选合并。
- 跨 Project View 聚合、历史 Revision 浏览器和高级 Run Memory 使用追踪。
- 旧 `.memsphere` 的产品级迁移、兼容读取或自动清理。
- 本需求不建设 Eval、Artifact Review 或 Agent Dispatcher 的新业务能力；仅适配其存储与 Project 解析入口。

## 关联需求

- 强关联：`changes/active/20260716-reserved-memory-self-bootstrap/change.md`。该 Change 已收敛为 Managed Project bootstrap、受控更新和 Project Memory Catalog，不再把已删除的 init 或目录 Scope 作为未来入口。
- 关联：`changes/active/20260718-eval-cli-and-view/change.md`。该 Change 已将 Eval Store 和隔离执行环境收敛到 Primary Project；Eval 产品能力仍由原 Change 管理。
- 关联：其他依赖 `.memsphere/config.json`、`memoryRoot/runsRoot/reviewsRoot/archiveRoot` 或 cwd Scope 发现的 active Change，开发前必须逐项确认适配影响。
- 重复需求：无。

## 技术与测试方案

实现按六层收敛：平台 Home 与持久化原语；Project Registry、Workspace Binding 与解析器；Managed/Embedded Git Store；ChangeSet、Publish、STW、Recover 与远端同步；Run/Validate/View 的 Project 化；最后删除旧入口并完成一次性数据切换。Registry、Project 创建和 Publish 使用跨进程锁，JSON 使用原子替换；候选文件限制在 Workspace changes 目录且拒绝路径穿越和符号链接；Managed 发布以目标 blob CAS 和受控分支不变量保证原子性，Run 使用启动时的 Project Revision 快照。

测试映射如下：

- Home、名称、Registry、Binding、Git common dir、并发锁、路径和符号链接由 `home`、`project-registry`、`project-command` 测试覆盖。
- Managed/Embedded、组合读取、歧义、跨 Project 引用、ChangeSet、Publish、STW、Recover、Push/Sync 由 `project-memory-provider`、`memory-changeset`、`memory-sync` 测试覆盖。
- Run Revision 冻结、无状态 CI 校验和诊断位置由 Run Store、`validate-command` 与 validation 测试覆盖。
- View Project 切换、数据隔离和配置分层由 `view-project-switch`、View Settings 的单元与 Playwright 测试覆盖。
- 发布入口和实际编译产物由全量 `npm test`、`npm run typecheck`、`npm run build` 与 `npm run smoke:project` 覆盖；GitHub Actions 在 Linux、macOS、Windows 分别执行同一门禁。
- 当前旧数据使用一次性本地脚本切换，脚本不进入产品；切换后用正式 CLI 验证 Project、Binding、Memory、Validate 和活动 Run，旧目录保持不变。

## 开发任务

- [x] 设计并实现跨平台 Memsphere Home、Registry、Project Root、配置分层和 Project Resolver。
- [x] 实现 project create/clone/register/list/show/bind/unbind/mount/unmount/prune 命令及锁和原子更新。
- [x] 实现 Managed/Embedded Store、Git Revision、受控分支和 Git 身份规则。
- [x] 实现 Managed ChangeSet 的 create/update/delete/rename、候选恢复副本、resume 和原子 Publish。
- [x] 实现正式 Store 不变量检测、STW 和两种 recover 路径。
- [x] 实现分布式 Managed Store 的 push、merge sync 和 Sync ChangeSet。
- [x] 改造 Run 的多 Project Revision 冻结与读取解析。
- [x] 改造 `memsphere validate` 的 Project 模式、候选保存和无状态 `--memory-root` CI 模式。
- [x] 将 View 改造为 Home 级单服务、Project 路由和单 Project 切换界面。
- [x] 删除 init、旧 Scope/Root 配置和旧格式兼容入口，更新 Skill、预置 Memory、帮助和核心文档。
- [x] 在旧 CLI 环境下完成当前存量数据清点、一次性本地转换脚本、切换验证和备份记录。
- [x] 适配现有 Run、Review、Archive、Eval 和测试夹具的 Project Root 解析。
- [x] 补齐自动化测试、三平台 Smoke 和回归摘要；人工验收证据由提需方在最终验收步骤确认。

## 验收结果

功能实现与自动化验证已完成，当前等待流程内复审、最终验收测试和提需方验收。本地 `npm run typecheck`、`npm test`（338/338）、`npm run build`、`npm run smoke:project`、`npm run security:check` 和 `memsphere validate` 全部通过。测试集从早期检查点收敛为 338 项，是因为删除了验证已淘汰 Reserved Scope 安装与导入行为的十个用例，并改由 Project bootstrap、Project Catalog 和禁止旧入口回归测试覆盖。GitHub PR #2 的最新 CI 中，Linux 完整回归与 Project Smoke、macOS Project Smoke、Windows Project Smoke、Gitleaks 四项检查全部通过；三平台持久化修复由 commit `b8fc88c` 承载。
