# memsphere

## 开始使用

安装 memsphere：

```bash
npm install -g memsphere
```

进入准备使用 memsphere 的工程，安装 Skill 并初始化：

```bash
cd <你的工程>
memsphere skill init --global
memsphere init
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

## License

This project is licensed under the Apache License, Version 2.0. See
[LICENSE](LICENSE) for details.
