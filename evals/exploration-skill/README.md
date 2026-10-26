# 自由探索 Skill 场景评测

每个 case 使用独立 Git workspace 和 `MEMSPHERE_HOME`。先构建当前源码，再执行：

```bash
npm run build
TRIAL=$(evals/exploration-skill/prepare.sh 007-free-start /tmp)
evals/exploration-skill/run-codex.sh "$TRIAL" --dry-run
evals/exploration-skill/run-codex.sh "$TRIAL"
```

`task.md` 是 Agent 输入，`evaluation.md` 只供评分者使用。运行证据位于 trial 的 `evidence` 目录；不要把它提交到仓库。

旧 `self-bootstrap-step0` 的 002/003/006 案例仅更新了不再成立的通用流程路由说明。它们的 task、fixture 和 evaluation 中没有该路由假设；原 `evals/prepare-case.sh` 仍依赖已删除的 `init --folder` 与旧 DSL 嵌套格式，不能作为当前 CLI 的可执行验收。
