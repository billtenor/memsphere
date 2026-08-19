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

查看当前 Project 与 Workspace 关系：

```bash
memsphere project list
memsphere project show
memsphere validate
```

Managed Project 中修改 Memory 时，先创建 ChangeSet，再校验 ChangeSet 应用到正式 Store 后的完整结果，最后发布：

```bash
memsphere memory edit concepts/Example
# 编辑命令输出的 Candidate Root 中的 YAML
memsphere memory change validate <change-id>
memsphere memory publish --change <change-id>
```

ChangeSet candidate 是只包含目标文件的稀疏目录，不应直接传给 `memsphere validate --memory-root`；该参数仍用于校验包含四类目录的完整 Memory Store。

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
