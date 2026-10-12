# 流程记忆撰写质量验收

两个 case：001-complex-writing（复杂流程真实撰写）、002-seeded-review（合法问题流程真实 review）。仅两项都通过才认可本次引导修改有效。task.md 为公开业务任务，evaluation.md 仅供 Runner 评分，不复制或挂载到被测进程。

两个案例各仅涉及一份复杂业务 Procedure，验证步骤位于流程内部。启动策略测试只在本验收目录手动运行，不进入常规 CI，也不启动真实 Agent。

先检查启动策略、构建候选，再准备和启动：

```bash
node --test evals/procedure-writing-quality/runtime-policy.test.mjs
npm run build
node evals/procedure-writing-quality/prepare-case.mjs --case 001-complex-writing --output /tmp/procedure-writing-quality/A
bash evals/procedure-writing-quality/run-case.sh /tmp/procedure-writing-quality/A
node evals/procedure-writing-quality/prepare-case.mjs --case 002-seeded-review --output /tmp/procedure-writing-quality/B
bash evals/procedure-writing-quality/run-case.sh /tmp/procedure-writing-quality/B
```

run-case.sh --smoke-only <trial> 只验证运行包、隔离与当前 CLI，不启动模型。正式试验保存每次原始事件、stderr、最终回复、工作区和脱敏元数据，A/B 独立进程与 Project。失败不覆盖试验，不能泄露考点后重计为盲评通过。

依赖 Node 22+、已认证的 Codex CLI、Git 和本机 Bubblewrap。隔离失败显式停止，不降级到共享文件系统 Prompt 限制。当前 runner 只支持本轮实际验收的 Linux Codex 配置，不扩展通用跨平台 runner。

冻结快照的 workspaceFiles 摘要使用 `sha256:<hex>` 表示，避免文件名与裸摘要组合被凭据扫描误判；复核时按算法标识提取摘要并比对实际文件。原始 Agent 输出保持原字节。
