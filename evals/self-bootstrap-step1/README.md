# memsphere 自举验收 Step 1

本目录保存 Statement 消费能力的自举验收 case，用于检查一个上下文干净的 Agent 能否通过统一 memsphere Skill 和 CLI，发现、读取并应用顶层 Statement Memory。

Step 1 不要求 Agent 编写或修改 Memory。它验证 `asserts`、`suggests`、树状 `sections`、多份 Statement 联合应用，以及规则冲突、信息不足和适用性判断。

## Case

```text
self-bootstrap-step1/
├── README.md
├── suite.md
└── cases/
    ├── 001-follow-flat-asserts/
    ├── 002-respect-suggestion-boundary/
    ├── 003-apply-hierarchical-statement/
    ├── 004-apply-multiple-statements/
    ├── 005-handle-assert-conflict/
    ├── 006-request-missing-evidence/
    └── 007-select-relevant-statement/
```

每个 case 包含：

- `task.md`：发送给被测 Agent 的最小任务。
- `evaluation.md`：仅供父 Agent 使用的评分指南。
- `fixtures/.memsphere/memory/statements/`：安装到 trial scope 的业务 Statement。

## 运行

准备整个 Step 1：

```bash
BATCH="$(./evals/prepare-cases.sh self-bootstrap-step1)"
```

使用 Codex 并行运行：

```bash
./evals/run-cases.sh --agent codex --model gpt-5.5 "$BATCH"
```

使用 TraeX 并行运行：

```bash
./evals/run-cases.sh --agent traex --model gemini-3-flash "$BATCH"
```

## 可见性和判定边界

- Agent 只能通过 memsphere CLI 发现和读取 trial scope 中的 Memory。
- Agent 不得读取 `evaluation.md`、其他 case 或当前工程以外的文件。
- Agent 不得新增、修改或删除任何 Memory。
- 违反任意适用 `asserts` 时失败；不遵循 `suggests` 不能单独判定失败。
- Statement 未限制的表达方式和补充内容允许 Agent 自由发挥。
- 规则冲突或信息不足时，正确说明并暂停可以通过，无需强行生成最终产物。
