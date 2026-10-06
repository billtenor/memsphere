# 创建和安装 App

简体中文 | [English](./app-guide.en.md)

本指南介绍如何创建 App、安装到 Project 并开始使用。App 安装管理与外部 CLI 登记已实现，以下示例已通过实际安装和使用验证。概念与接口分别见 [App 整体设计](./app-design.md) 和 [实现契约](./app-contract.md)。

作者交付一个包含 `app.json` 和自有资产的目录；使用者把这个目录安装到一个 Project，然后启用。安装器根据清单登记资产并建立归属，使用者不需要逐个安装其中的 Memory、登记 CLI 或添加 View Package。独立外部 CLI 的程序仍按其自身方式安装。

## 作者：创建一个最小 App

先做一个“写作约定”App：让 Agent 在不同 Project 中读取相同的写作概念。它只需要两个文件，不需要 CLI、View 或 Model。

```text
writing-app/
├── app.json
└── memories/
    └── concepts/
        └── writing-brief.yaml
```

创建目录：

```bash
mkdir -p writing-app/memories/concepts
```

将以下内容保存为 `writing-app/app.json`：

```json
{
  "schemaVersion": 1,
  "id": "org.example.writing",
  "name": "写作约定",
  "version": "0.1.0",
  "description": "向 Agent 提供项目写作任务的共同概念。",
  "assets": {
    "memories": [
      {
        "key": "brief",
        "path": "memories/concepts/writing-brief.yaml"
      }
    ]
  },
  "entrypoints": {
    "agent": ["concepts/example-writing-brief"]
  }
}
```

将以下内容保存为 `writing-app/memories/concepts/writing-brief.yaml`：

```yaml
!concept
syntax: memsphere-20260721-stable
names:
  - example-writing-brief
  - 写作任务说明
defines:
  - 写作任务说明是作者与 Agent 对一篇文稿的共同约定，包含目标读者、写作目的和预期交付形式。
```

这就是一个完整的最小 App 发行目录。`id` 用来安装和管理 App，`name` 用于展示，`key` 标识 App 内的一项资产，`path` 相对 `app.json` 所在目录。Memory 的逻辑引用来自 YAML 的类型与首个名称；`entrypoints.agent` 告诉 Agent 先读哪份 Memory。

作者可以把整个目录交给另一位使用者，也可以放进代码仓库供对方取得。首版安装本地目录；压缩包须先解压，不支持直接从市场或远端 URL 安装。目录应包含清单声明的文件；涉及代码的 App 应交付已构建的产物，安装者无需修改或重新编译 Memsphere。

## 使用者：安装到 Project 并开始使用

先按 [安装说明](../README.md) 安装 Memsphere。以下命令使用名为 `my-project` 的 Project；如果还没有这个 Project，先创建：

```bash
memsphere project create my-project
```

取得 `writing-app` 目录后，在它的父目录执行以下命令：

```bash
memsphere --project my-project app install ./writing-app
memsphere --project my-project app enable org.example.writing
memsphere --project my-project app show org.example.writing
```

| 操作 | 完成后应看到什么 |
| --- | --- |
| install | 安装版本为 `0.1.0`，初始停用；一份 Memory 已进入该 Project 并归属此 App；返回 App ID 和启用提示。 |
| enable | 依赖检查通过，App 已启用；本例只有 Memory，无需重启 View。 |
| show | 显示名称、版本、状态、自有 Memory，以及 Agent 入口 `concepts/example-writing-brief`。 |

然后让 Agent：“在 my-project 中，读取写作约定 App 的入口，按这个概念帮我整理写作任务说明。”Agent 使用已有 Memory 命令读取入口：

```bash
memsphere --project my-project memory read concepts/example-writing-brief
```

这份入口是 Concept，用来阅读；如果作者交付的是 Procedure 入口，则使用 `run start <reference> --name <任务名称>` 创建 Run。`app show` 的 `usage.agent` 提供各入口对应的阅读或启动命令。

同一个目录可以安装到另一个 Project。安装记录和配置分别保存；另一个 Project 不会因本次启用而自动启用。最小示例不产生业务数据；具有业务数据的 App 还需为各 Project 配置各自的数据位置。

## 完整业务 App：作者多交付什么

以费用管理为例，作者仍交付一个目录，但其中包含实际实现该业务的资产：

```text
expense-app/
├── app.json
├── config.schema.json       # 需要使用者填写的配置及说明
├── memories/                # 费用概念、规则和流程
├── cli/descriptor.json      # 外部 expense 工具的描述
├── view/                    # module.json 和已构建的界面
├── models/                  # model-package.json 和模型定义
└── backend/                 # 已构建的业务操作及共享业务实现
```

可运行示例见 [费用 App README](../examples/apps/expense/README.md)，包含构建、独立工具安装及实际业务命令。代码和 Memory 由作者编写或复用，`app.json` 只负责组合。

| 作者要完成的事 | 在 App 中如何表达 |
| --- | --- |
| 交付概念、规则、流程 | 在 `assets.memories` 列出 YAML，在 `entrypoints.agent` 列出起点。 |
| 提供人工界面 | 按现有 [View 插件指南](./view-plugin-guide.md) 构建 View Package，在 `assets.viewPackages` 声明包，在 `entrypoints.view` 声明实例。 |
| 提供数据模型 | 在 `assets.modelPackages` 声明模型包，用 `stores` 连接模型与实际存储。 |
| 让 Agent 使用外部工具 | 在 `assets.cliDescriptors` 声明描述文件；安装时自动登记，用 `cliBindings` 连接本 App 的配置。 |
| 连接前后端 | 在 `backend` 声明业务入口与操作，View 与 CLI 通过共享业务实现或服务使用同一份权威数据。 |
| 告诉安装者要填什么 | `configuration` 指向配置 Schema，随发行包提供配置示例和外部 CLI 的安装说明。 |

例如费用 App 的工具描述 `cli/descriptor.json` 可以是：

```json
{
  "schemaVersion": 1,
  "id": "org.memsphere.expense-cli",
  "name": "费用工具",
  "description": "创建、查询和更新费用记录。",
  "command": ["expense"],
  "help": ["--help"]
}
```

作者在 `app.json` 的 `cliBindings` 中声明以下绑定，并使 backend 和 Store 也使用同一个 `ledgerDirectory` 配置值：

```json
[
  {
    "cli": "org.memsphere.expense-cli",
    "args": ["--ledger", { "configKey": "ledgerDirectory" }]
  }
]
```

这样安装者填写一次账本目录，就能得到此 App 的固定调用上下文。可执行文件若在 PATH 中，无需再手工 `cli bind`；需要指定本机程序位置时才补充绑定。独立使用工具、不安装 App 的场景才需要手工 `cli register`。

## 完整业务 App：使用者多操作什么

作者应随 App 提供完整 README、可修改的配置文件示例及确切的工具安装命令。使用者先按该说明安装独立 `expense` 程序，再把以下配置保存为 `my-expense.json`，将路径替换为自己的账本目录：

```json
{
  "ledgerDirectory": "/absolute/path/to/my-ledger"
}
```

费用示例的 App ID 为 `org.memsphere.expense`，执行以下命令：

```bash
memsphere --project my-project app install ./expense-app --config ./my-expense.json
memsphere --project my-project app check org.memsphere.expense
memsphere --project my-project app enable org.memsphere.expense
memsphere --project my-project app show org.memsphere.expense
```

安装器统一处理自有 Memory、模型、View Package 和 CLI 描述。`check` 检查工具与配置条件；`enable` 建立入口。含 View/backend 的组合如返回 `restartRequired`，执行：

```bash
memsphere view restart
memsphere view status
```

打开命令返回的服务地址，在 View 选择 `my-project`，再点击“费用 / Expenses”。也可以在服务地址后拼接 `app show` 返回的页面路径，直接打开费用页。首次使用时 `restart` 也会启动服务。无需去 Home 设置逐项添加 App 的包。

`app show` 告诉 Human 在哪里打开费用界面，告诉 Agent 从哪份 Memory 开始，以及工具使用哪套绑定。Agent 可用以下命令取得结构化调用信息，再直接调用 `expense`：

```bash
memsphere --project my-project cli show org.memsphere.expense-cli --app org.memsphere.expense
```

Agent 按返回的信息传入固定参数，直接调用外部程序。费用示例中，Human 在 View 录入的费用可以通过 CLI 查询；CLI 写入后，View 刷新即可看到。两个入口使用同一账本和业务规则。

## 遇到问题时从哪里继续

| 情况 | 下一步 |
| --- | --- |
| 安装时发现同名 Memory 或冲突的资产 ID | 根据错误中的具体身份修正发行内容或依赖；安装不能覆盖已有资产。 |
| 工具未找到 | 按作者说明安装工具；已安装但不在 PATH 时，用 `cli bind` 指定程序位置，再检查。 |
| 配置不符合要求 | 根据配置 Schema 修正文件；已安装 App 使用 `app configure <id> --config <file>` 后重新检查、启用。 |
| 已启用但界面需要重启 | 根据命令返回的重启提示重启 View，再在目标 Project 查看入口。 |
| 想暂时停止使用 | `app disable <id>`，按提示处理 View 重启；Memory 归属、业务数据和已有 Run 保留。 |

首版仅安装可信本地目录，不提供远端下载、升级、卸载或已有 Memory 自动认领。Embedded 安装记录作用于当前有效 worktree，主 worktree 不会采用其他 worktree 的未合入候选。
