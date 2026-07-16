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
- `run-*-agent.sh` 负责从基线复制独立工作区，并启动对应 agent。
- agent runner 不应包含特定测试组的知识。

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

同一个基线可以派生多个相互独立的 agent 运行目录。runner 的输出、工作区和元数据保存在该基线的 `runs/` 下。
