# memsphere 自举验收

本目录保存人工编写的验收 case，用于检查一个上下文干净的 agent 能否依靠统一 memsphere Skill 和已安装的 Memory 理解并正确使用测试提供的业务 Memory。

第一版有意保持简单：每次通过一个全新的子 agent 运行一个 case，并采用软隔离，包括临时工程根目录、临时 `HOME`、禁止读取工程外文件的明确指令，以及可审计的事件日志。

## 目录结构

```text
evals/
├── README.md
├── prepare-case.sh
├── prepare-cases.sh
├── run-cases.sh
├── run-codex-agent.sh
├── run-traex-agent.sh
└── self-bootstrap/
    ├── README.md
    ├── suite.md
    └── cases/
        ├── 001-create-bookkeeping-entry/
        ├── 002-request-missing-bookkeeping-data/
        ├── 003-reject-invalid-bookkeeping-entry/
        ├── 004-create-outline-meeting-note/
        ├── 005-create-table-expense-list/
        └── 006-select-correct-memory/
```

- `suite.md`：说明验收集合包含哪些 case，以及如何判断整个集合是否通过。
- `task.md`：当前 case 中唯一会发送给子 agent 的内容。
- `evaluation.md`：仅供父 agent 使用的参考答案和评分标准，绝不能复制到子 agent 的工作区。
- `fixtures/`：可选目录；其中 `.memsphere/` 复制到临时 trial 根目录，其他内容复制到 Agent workspace。
- `prepare-case.sh`：生成与 agent 无关的基线工程和提示词，并安装预置 Memory 与统一 memsphere Skill。
- `prepare-cases.sh`：一次选择并准备多个 case；未指定 case 时准备当前 suite 的全部 case。
- `run-cases.sh`：用指定 Agent 并行运行一批已准备的 case，并汇总结果路径与退出码。
- `run-codex-agent.sh`：从基线复制独立 workspace，启动一个干净的 Codex 子 agent，并保留执行证据。
- `run-traex-agent.sh`：从同一类基线复制独立 workspace，启动一个干净的 TraeX 子 agent，并保留执行证据。
- 后续接入其他 agent 时，为其增加独立 runner；case、fixture 和基线准备逻辑保持不变。

## 可见性边界

子 agent 可以看到：

- 生成后的任务提示词；
- 当前 case 中复制到 workspace 的可选 fixture 内容；
- 通过 memsphere CLI 访问的当前 scope Memory；
- `.agents/skills/memsphere/SKILL.md`；
- memsphere CLI 及其输出；
- 子 agent 在临时工作区内创建的文件。

子 agent 不得读取：

- `evaluation.md`；
- 其他 case；
- 源代码仓库中的 `README.md`、`docs/`、`src/` 或 `reserved-memory/`；
- 旧的 memsphere skills；
- 临时工程根目录以外的文件；
- trial 根目录中的 `.memsphere/` 文件；这些内容只能通过 memsphere CLI 访问。

只要读取了禁止来源，本次验收就记为 `invalid`，无论答案质量如何。

## 运行 case

准备一份 agent 无关的验收基线：

```bash
TRIAL="$(./evals/prepare-case.sh self-bootstrap/001-create-bookkeeping-entry)"
```

从该基线准备 Codex 的独立运行目录，但不启动子 agent：

```bash
./evals/run-codex-agent.sh --dry-run "$TRIAL"
```

启动 Codex 子 agent：

```bash
./evals/run-codex-agent.sh --model gpt-5.5 "$TRIAL"
```

启动 TraeX 子 agent：

```bash
./evals/run-traex-agent.sh --model gemini-3-flash "$TRIAL"
```

准备并并行运行整个测试组：

```bash
BATCH="$(./evals/prepare-cases.sh self-bootstrap)"
./evals/run-cases.sh --agent traex --model gemini-3-flash "$BATCH"
```

只运行指定 case：

```bash
BATCH="$(./evals/prepare-cases.sh self-bootstrap \
  001-create-bookkeeping-entry \
  002-request-missing-bookkeeping-data)"
./evals/run-cases.sh --agent traex --model gemini-3-flash "$BATCH"
```

准备脚本和 agent runner 默认从 `PATH` 中查找 `memsphere`，runner 分别从 `PATH` 中查找 `codex` 或 `traex`。runner 会把选中的 memsphere CLI 注入隔离运行环境。也可以通过 `MEMSPHERE_BIN`、`CODEX_BIN`、`CODEX_MODEL`、`TRAEX_BIN` 和 `TRAEX_MODEL` 覆盖。

脚本会打印结果目录，并有意将其保留在 `/tmp` 下，供父 agent 检查：

```text
.memsphere/
baseline/
  workspace/
prompt.md
setup.log
metadata.txt
runs/
  codex.XXXXXX/
    home/
    workspace/
    metadata.txt
    agent-events.jsonl
    agent-stderr.log
    final-answer.md
  traex.XXXXXX/
    home/
    workspace/
    metadata.txt
    agent-events.jsonl
    agent-stderr.log
    final-answer.md
```

基线只安装统一的 `memsphere` Skill，不安装旧的 `memsphere-edit`、`memsphere-review` 或 `memsphere-run`。后续将为 runner 增加完整 Skill 与只保留启动内核的两种模式，用同一组 case 分别验证快速使用能力和纯 Memory 自举能力。
