---
id: 20260724-acp-provider-support
status: completed
type: feature
created: 2026-07-24
completed_at: 2026-07-25
run_id: run-20260724-033607z-fa0fb12f
---

# ACP Provider 扩展与配置管理

## 需求

在现有 Artifact Review Agent/ACP 执行框架中支持 Qwen Code、Kimi Code CLI
和 Codex，并将 ACP Provider 建设为配置中心中的独立配置资源。Actor 只引用
Provider 并选择可选模型；Provider 的固定身份、命令和 ACP 入口由系统管理，
共享参数、非敏感环境覆盖和超时由 Provider 配置统一维护。

配置中心应检测当前环境中 Traex、Qwen Code、Kimi Code CLI 和 Codex ACP
adapter 的安装状态、版本与可执行路径。未安装、待认证、模型无效、参数无效
和 ACP 协议失败必须保留可行动的稳定错误类别，不得统一表现为超时。

## 交付范围

- 建立四种内置 Provider 的 Catalog、探测、配置校验和启动适配。
- Qwen 使用原生 `--acp` 模式，Kimi 使用 `acp` 模式，Codex 使用已安装的
  `codex-acp` adapter；不通过 package runner 临时下载。
- Actor 配置仅保留 Provider 引用和可选 Model。
- 配置中心增加 ACP Provider 模块，展示安装状态、版本、路径、引用数和实际
  启动预览，并允许编辑安全的共享配置或恢复默认值。
- Provider 环境覆盖不得改变可执行搜索、用户与配置目录、动态加载、认证身份
  或 Memsphere 管理的运行环境。
- Agent Review Worker 保留 Provider 配置和运行错误的稳定分类。
- 更新 README、System Memory、安装副本和 Memsphere Skill。

## 验收结果

- Qwen Code、Kimi Code CLI 与 Codex ACP 均完成真实模型回合和 Artifact
  Review 投票验收；Traex 的现有行为保持兼容。
- 配置中心能够探测四种 Provider，并正确展示只读身份、Command、版本、路径
  和运行参数。
- 非法 Provider 参数稳定分类为 `agent_provider_arguments_invalid`，并有
  Worker 端到端回归测试。
- `npm test`：319/319 通过。
- `npm run typecheck`、`npm run build`、`memsphere validate` 和
  `git diff --check` 均通过。
- 实现与验证成果经过 7 轮 Review，最终所有 Reviewer 与 Runner 均通过；
  提需方验收通过。

## 后续范围

- 其他 Agent Provider、远程 ACP 和 MCP 原生工具注册留待后续需求。
- Provider 私有凭据、模型供应商配置和推理参数仍由各 Agent 自身管理。
- 当前无已知阻塞问题。
