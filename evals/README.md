# memsphere Evals

本目录包含 memsphere 的测试集合和所有测试集合共享的 agent evaluation 基础设施。

## 目录结构

```text
evals/
├── README.md
├── prepare-case.sh
├── run-codex-agent.sh
├── run-traex-agent.sh
└── self-bootstrap/
    ├── README.md
    ├── suite.md
    └── cases/
```

- 每个一级子目录代表一组测试，例如 `self-bootstrap/`。
- 测试组负责定义 case、fixture、评分标准和组级通过策略。
- `prepare-case.sh` 负责将指定 case 准备成与 agent 无关的基线，并安装统一 memsphere Skill。
- `run-*-agent.sh` 负责从基线复制独立 workspace，并在其中启动对应 agent。
- agent runner 不应包含特定测试组的知识。

每个 trial 是一个 memsphere scope，`.memsphere/` 位于 trial 根目录。baseline workspace 和所有 Agent workspace 都是该 scope 的子目录；Agent 的 cwd 和允许直接访问的工程范围仅限各自的 `workspace/`。Agent 通过 memsphere CLI 向上发现 trial scope，不应直接读取父目录中的 Memory 文件。

## 运行方式

先使用 `<suite-id>/<case-id>` 准备基线：

```bash
TRIAL="$(./evals/prepare-case.sh self-bootstrap/001-create-bookkeeping-entry)"
```

然后选择一个 agent runner：

```bash
./evals/run-codex-agent.sh --model gpt-5.5 "$TRIAL"
./evals/run-traex-agent.sh --model gemini-3-flash "$TRIAL"
```

同一个基线可以派生多个相互独立的 Agent workspace，它们共享 trial scope 中的 Memory。runner 的输出、工作区和元数据保存在该 trial 的 `runs/` 下。
