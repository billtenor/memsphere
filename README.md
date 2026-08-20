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

Managed Project 数据保存在操作系统用户数据目录，不会随临时 Git worktree 删除，并通过首笔 ChangeSet 安装内置 System Memory。Git 是必需依赖；Windows 用户请安装 Git for Windows 并在 Git Bash 中使用 Memsphere。

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

Managed Project 中修改 Memory 时，先创建 ChangeSet，再校验 ChangeSet 应用到正式 Store 后的完整结果，最后发布：

```bash
memsphere memory edit concepts/Example
# 编辑命令输出的 Candidate Root 中的 YAML
memsphere memory change validate <change-id>
memsphere memory publish --change <change-id>
```

ChangeSet candidate 是只包含目标文件的稀疏目录，不应直接传给 `memsphere validate --memory-root`；该参数仍用于校验包含四类目录的完整 Memory Store。

Embedded Project 中使用同一条编辑命令时，CLI 会返回当前 worktree 中的实际 YAML 路径；修改后使用普通 Git 工作流集成，不执行 `memory publish`：

```bash
memsphere memory edit concepts/example
# 编辑输出的 Edit 路径
memsphere validate
```

新建一个 Agent 会话，然后告诉 Agent：

```text
请使用 memsphere，启动 memsphere 教学流程-第一章。
```

## License

This project is licensed under the Apache License, Version 2.0. See
[LICENSE](LICENSE) for details.
