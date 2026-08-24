# memsphere

## 开始使用

安装 memsphere：

```bash
npm install -g memsphere
```

安装 Skill，创建一个持久 Project，并绑定当前 Workspace：

```bash
cd <你的工程>
memsphere skill init --global
memsphere project create my-project --bind
```

Managed Project 数据保存在操作系统用户数据目录，不会随临时 Git worktree 删除，并通过首笔 ChangeSet 安装内置 System Memory。Git 是必需依赖；Windows 用户请安装 Git for Windows，随后重新打开 PowerShell、CMD 或 Git Bash 等受支持 shell，确保 `git` 已在 `PATH` 中。运行 Memsphere 不要求先进入 Git Bash。

代码仓库已经包含一套 Memory 时，可以把它登记为 Embedded Project：

```bash
memsphere project create my-project --embedded .memsphere/memory --bind
```

Embedded Project 会把 Git 主 worktree 记录为 `repository_path`，并把 Memory 位置记录为仓库相对的 `memory_path`。View 固定展示主 worktree；普通 CLI 在 linked worktree 中运行时，会读取和校验该 linked worktree 内的 Memory，不会回退到主 worktree。

查看当前 Project 与 Workspace 关系：

```bash
memsphere project list
memsphere project show
memsphere validate
```

Managed Project 中修改 Memory 时，先创建 ChangeSet，再校验 ChangeSet 应用到正式 Store 后的完整结果，确认 View 预览后发布：

```bash
memsphere memory edit concepts/Example
# 编辑命令输出的 Candidate Root 中的 YAML
memsphere memory change validate [change-id]
memsphere memory publish --change <change-id>
```

Embedded Project 直接修改当前 Git worktree 中的 Memory，然后执行同一个校验命令；它会依据当前 `HEAD` 捕获 Memory 差异，不会创建完整快照，也不会提交 Git：

```bash
memsphere memory change validate
```

两种 Project 都只保存一份稀疏、内容寻址的当前验证内容；再次校验会原子替换它，不创建供用户选择或回滚的额外快照。命令会输出 ChangeSet id 和稳定 View 地址 `/projects/<project>/changes/<change-id>`。View 顶层只并列 Memory 与 Task；ChangeSet 是 Memory 编辑子功能，从 Memory 列表的“修改中 · N”展开进入。

验证成功的 active ChangeSet 可以在正式集成前直接启动 Procedure Run：

```bash
memsphere run start <procedure-name> --change <change-id> --name "<run-name>"
```

该 Run 从 ChangeSet 的 base revision 与当前 checkpoint 物化四类完整候选 Memory，保存 Run 级不可变快照，并冻结 ChangeSet id、checkpoint digest 和 base revision；ChangeSet 后续再次校验不会改变已经启动的 Run。执行时可用 `memsphere memory list --run <run-id>` 和 `memsphere memory read <reference> --run <run-id>` 读取同一快照中的 Concept、Statement、Schema 与 Procedure。不传 `--change` 时，Embedded 仍读取当前 worktree，Managed 仍读取 `published_revision`。

Embedded 的标准命令不需要额外选择参数：同一 Project、Git repository 和 base revision 下会持续复用同一个逻辑 ChangeSet，linked worktree 路径变化不会生成新对象。ChangeSet 的生命周期只有 active、completed、abandoned：普通 commit、push 或创建 PR 后仍为 active，候选提交合入 `master` 后才自动成为 completed；Managed 使用 `memsphere memory publish` 后直接成为 completed。ChangeSet candidate 和当前验证内容都只包含目标文件，不应直接传给 `memsphere validate --memory-root`；该参数仍用于校验包含四类目录的完整 Memory Store。

Memory 详情的“修改”会在简单确认后创建一个新的持久 ChangeSet。用户不能在 View 直接编辑 YAML，只能把已有 Memory 加入 ChangeSet，并在结构位置旁通过 `+` 逐条提交修改意见。Comment 直接绑定 ChangeSet，状态只有 pending、processing、completed；不再存在独立 Memory Review 或 ChangeSet Review。Human Actor 与稳定 Browser user UUID 只用于归因，不构成身份认证。

用户在 Agent 对话中提供 ChangeSet id 后，Agent 在对应 worktree 接手并处理 Comment：

```bash
memsphere memory change claim <change-id>
memsphere memory change validate <change-id>
memsphere memory change finish <change-id> --comment <comment-id> --reason fixed
```

已有处理者时 `claim` 默认拒绝；只有用户明确要求强制接手才使用 `--force`。不合理的 Comment 不修改内容，使用 `--reason rejected` 完成，并在 Agent 对话中说明判断。没有实际差异且所有 Comment 已完成时使用 `memsphere memory change complete <change-id>`。`finish` 会释放 claim；View 不提供“交给 Agent 处理”按钮，也不会因提交 Comment 自动创建 Task。

Embedded Project 中使用同一条编辑命令时，CLI 会返回当前 worktree 中的实际 YAML 路径；修改后使用普通 Git 工作流集成，不执行 `memory publish`：

```bash
memsphere memory edit concepts/example
# 编辑输出的 Edit 路径
memsphere memory change validate
```

新建一个 Agent 会话，然后告诉 Agent：

```text
请使用 memsphere，启动 memsphere 教学流程-第一章。
```

## Windows

原生 Windows 支持基线为 Windows 10/11 x64、Node.js 20 或更高版本，以及 [Git for Windows](https://git-scm.com/download/win)。Memsphere 的 Memory 仓库和 publish 流程依赖 Git，Agent Review 还会使用 Git for Windows 随附的 Git Bash。

用户和 Agent 可以在以下命令环境中运行 Memsphere CLI：

- Windows PowerShell 5.1
- PowerShell 7（`pwsh`）
- `cmd.exe`
- Git for Windows 随附的 Git Bash

Windows Terminal 是终端宿主，可以选择上述任一 shell。MSYS2、Cygwin 不属于当前支持范围；WSL 按独立 Linux 环境使用，不要与 Windows 原生 Node.js、Provider 或工作区混合运行。

View 使用当前 Windows 原生 `node.exe` 在后台运行，不需要从 Git Bash 启动。ACP 不统一 Agent 的命令 shell，因此 Agent Review 使用 shell-neutral 的受限 `memsphere-review` 会话命令。Provider 的“已安装”检测与 Windows 支持等级是两类信息；只有真实 Windows ACP 端到端验证完成后才会标记为 `supported`。

## 运行期更换 Review 参与者

如果 Human 已完成前序流程、不再参与后续 Artifact Review，可以查看当前 Run 冻结的 Actor 和 Slot Binding：

```bash
memsphere run binding show --run <run-id>
```

把未来尚未创建 Review 的 Slot 换绑到 Agent：

```bash
memsphere run binding update --run <run-id> \
  --slot '<procedure-name>::<slot-name>' \
  --actor <agent-actor-id>
```

可重复传入 `--actor` 绑定多人，或使用 `--skip` 跳过未来该 Slot。换绑只能使用 Run 启动时冻结的 Actor，并保留审计记录；已经创建的 Review、Round 和 Assignment 不会改变。

## License

This project is licensed under the Apache License, Version 2.0. See
[LICENSE](LICENSE) for details.
