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
