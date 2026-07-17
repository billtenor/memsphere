# memsphere 自举验收 Step 2

本目录保存 Schema 消费能力的自举验收 case，用于检查一个上下文干净的 Agent 能否通过统一 memsphere Skill 和 CLI，发现、读取并应用顶层 Schema Memory。

Step 2 不要求 Agent 编写或修改 Memory。它验证 Schema 是否能够作为独立的交付结构和格式约束被 Agent 正确消费。

## Case

```text
self-bootstrap-step2/
├── README.md
├── suite.md
└── cases/
    ├── 001-create-outline-release-record/
    ├── 002-create-nested-incident-review/
    ├── 003-create-table-device-inventory/
    ├── 004-apply-schema-asserts/
    ├── 005-request-missing-schema-field/
    └── 006-select-correct-schema/
```

每个 case 包含：

- `task.md`：发送给被测 Agent 的最小任务。
- `evaluation.md`：仅供父 Agent 使用的评分指南。
- `fixtures/.memsphere/memory/schemas/`：安装到 trial scope 的业务 Schema。

## 运行

准备整个 Step 2：

```bash
BATCH="$(./evals/prepare-cases.sh self-bootstrap-step2)"
```

使用 Codex 并行运行：

```bash
./evals/run-cases.sh --agent codex --model gpt-5.5 "$BATCH"
```

使用 TraeX 并行运行：

```bash
./evals/run-cases.sh --agent traex --model gemini-3-flash "$BATCH"
```

只准备一个 case：

```bash
./evals/prepare-case.sh self-bootstrap-step2/001-create-outline-release-record
```

## 可见性和判定边界

- Agent 只能通过 memsphere CLI 发现和读取 trial scope 中的 Memory。
- Agent 不得读取 `evaluation.md`、其他 case 或当前工程以外的文件。
- Agent 不得新增、修改或删除任何 Memory。
- 评分以 Schema 的 format、fields 和 asserts 为边界，不要求复现参考产物的具体措辞。
- Schema 未限制的内容允许 Agent 自由组织和补充。
