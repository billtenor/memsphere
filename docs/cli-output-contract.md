# Memsphere CLI 输出契约

普通命令的默认输出是 Agent 可读的 Prompt。需要用 jq 或程序取值时，使用同一命令的 `--output json`。它保留相同的业务事实、范围和动作。CLI 声明负责参数语法，仓库中英文模板负责输出说明与布局。JSON 成功回执由标准输出返回。执行错误以非零退出码和标准错误中的一个 `error` 对象返回。已声明的业务否定结果，例如 `validate` 的 `valid: false`，仍是业务回执。

## 动作与续读

| 字段 | 用法 |
| --- | --- |
| `nextAction.kind: "command"` | `launcher` 指定普通 CLI 或当前 Reviewer Session launcher，`args` 是命令的参数数组。根据上下文替换其中明确标注的输入占位符。 |
| `nextAction.kind: "choose"` | 从 `choices` 选择当前适用的动作，`more` 提供更多选择的查询入口。 |
| `nextAction.kind: "wait"` | 等待当前操作。`resume` 指定读取或恢复入口。 |
| `nextAction.kind: "human_confirmation"` | 收集对应 Human 决定，再按 `resume` 继续。 |
| `nextCursor` | 使用相同 Project、筛选和命令传给 `--cursor`。续读用实际返回的游标，包括带游标的空页。 |
| `details` | 读取当前对象的已授权详情。普通状态只返回下一步实际使用的摘要。 |

Reviewer 通过当前 Attempt 注入的 `MEMSPHERE_CLI` 执行参数。Bash 使用 `"$MEMSPHERE_CLI"`，PowerShell 使用 `& $env:MEMSPHERE_CLI`，CMD 使用 `"%MEMSPHERE_CLI%"`。

## 迁移

| 旧读取方式 | 公开入口 |
| --- | --- |
| 从 `run status` 读取完整运行快照、调度帧或产物 | 用 `run status` 的 `runId`、`stepId` 和 `nextAction` 继续。通过 `run show` 分页查步骤，再查询 Step、Artifact 或固定评审轮次。 |
| 从回执解析整段 Prompt 或命令字符串 | 读取 `nextAction.kind` 和 `args`。View/daemon 状态只提供运行状态、设置入口状态及计数。 |
| 用 `app show` 读取已保存的配置对象 | CLI 查配置 revision、配置定义和已登记的 Store 绑定。授权设置内容通过 View 的设置入口读取。 |
| 用 `memory list` 获取一个 Memory 的定义或冻结状态 | 列表返回逻辑引用、来源、可用摘要和游标。完整正文仍用 `memory read`。 |
| 从错误中直接读取底层错误或恢复命令字符串 | 按 `error.code` 处理，使用该错误声明的业务标识和可用恢复动作。 |
| 从 View 启停或 daemon 状态获取设置凭据 | 按回环设置入口访问，或由授权 Human 使用已配置的 `view.operator_token`。状态中的 `settingsAccess` 表示使用方式。 |

完整 Memory、固定 ChangeSet 材料和按权限明确请求的 Artifact 或契约正文使用各自的内容协议。`data export --out -` 保留原始字节流，文件导出回执提供文件定位。`validate` 和 `memory change validate` 仍支持 `--format json`。`memory list --output yaml` 是同一摘要的显式 YAML 表示。帮助和版本使用 Commander 固定入口。

新增或改动公开结果时，将字段类型、集合上限、有效动作、错误和协议例外放在对应领域的严格 schema，调用共用渲染边界。注册命令后同步校对原生路由及 Continue 入口的覆盖检查，测试中英文文本、JSON 字段及禁止公开的数据。固定样例预算用 `scripts/ci/check-cli-output-budget.py` 验证，要求 tiktoken 0.12.0 和 o200k_base。
