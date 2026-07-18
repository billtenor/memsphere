# memsphere Evals

本目录包含 memsphere 的测试集合和所有测试集合共享的 agent evaluation 基础设施。

## 目录结构

```text
evals/
├── README.md
├── prepare-case.sh
├── prepare-cases.sh
├── run-cases.sh
├── run-codex-agent.sh
├── run-traex-agent.sh
├── self-bootstrap-step0/
│   ├── README.md
│   ├── suite.md
│   └── cases/
├── self-bootstrap-step1/
│   ├── README.md
│   ├── suite.md
│   └── cases/
└── self-bootstrap-step2/
    ├── README.md
    ├── suite.md
    └── cases/
```

- 每个一级子目录代表一组测试，例如 `self-bootstrap-step0/`。
- 测试组负责定义 case、fixture、评分标准和组级通过策略。
- `prepare-case.sh` 负责将指定 case 准备成与 agent 无关的基线，并安装统一 memsphere Skill。
- `prepare-cases.sh` 负责一次选择并准备一组 case；省略 case ID 时选择 suite 的全部 case。
- `run-cases.sh` 负责用指定 Agent 并行运行已选择的全部 case，并生成统一结果清单。
- `run-*-agent.sh` 负责从基线复制独立 workspace，并在其中启动对应 agent。
- agent runner 不应包含特定测试组的知识。

每个 trial 是一个 memsphere scope，`.memsphere/` 位于 trial 根目录。baseline workspace 和所有 Agent workspace 都是该 scope 的子目录；Agent 的 cwd 和允许直接访问的工程范围仅限各自的 `workspace/`。Agent 通过 memsphere CLI 向上发现 trial scope，不应直接读取父目录中的 Memory 文件。

## 运行方式

先使用 `<suite-id>/<case-id>` 准备基线：

```bash
TRIAL="$(./evals/prepare-case.sh self-bootstrap-step0/001-create-bookkeeping-entry)"
```

然后选择一个 agent runner：

```bash
./evals/run-codex-agent.sh --model gpt-5.5 "$TRIAL"
./evals/run-traex-agent.sh --model gemini-3-flash "$TRIAL"
```

同一个基线可以派生多个相互独立的 Agent workspace，它们共享 trial scope 中的 Memory。runner 的输出、工作区和元数据保存在该 trial 的 `runs/` 下。

运行一组 case 时，先在准备阶段选择 case。省略 case ID 会准备整个 suite：

```bash
BATCH="$(./evals/prepare-cases.sh self-bootstrap-step0)"
```

也可以只准备指定 case：

```bash
BATCH="$(./evals/prepare-cases.sh self-bootstrap-step0 \
  001-create-bookkeeping-entry \
  002-request-missing-bookkeeping-data)"
```

随后只需执行一条命令。所选 case 默认并行运行，但仍各自使用独立的 Agent、workspace 和 HOME：

```bash
./evals/run-cases.sh --agent traex --model gemini-3-flash "$BATCH"
```

命令开始时会在 stderr 打印批次运行目录和每个 case 的状态文件；全部结束后，stdout 返回批次运行目录，其中的 `results.tsv` 汇总每个 case 的 Trial、RUN_DIR 和退出码。
