# 模型与数据 CLI：敏捷需求开发交付报告

Run：run-20261003-090655z-f1e492f6。日期：2026-10-05（Asia/Shanghai）。
候选分支：codex/model-data-cli；基线：2b7400b0d3bff6670982ebcd0a02f023a6859e34。

模型与数据 CLI 已完成实现和验证，Runner 已接受本轮实现验收。本报告提交产品负责人评审，交付尚待该评审接受，未创建 Git commit 或 PR。

## 交付内容

已实现 model、data 和 data store 命令，Agent 可完成发现模型、查看定义与登记、建立明确业务 Store、创建/读取/修改/删除数据、校验与导出内容的闭环。模型 read 仅 definition、registration、all，默认 definition；查询参数为 --path <path>，本轮使用 JSONPath；局部修改为 data edit，采用 JSON Patch。JSON 成功和错误回执、显式 stdin、dry-run 及 capability 拒绝规则一致。

模型与元模型统一 .json ID，系统模型及全部登记字段通用只读；全部来源禁止跨模型引用，保留本模型内部引用和递归。创建/更新/导入/安装/正常读取/绑定 Store 均须当前 Runtime 完整支持，不提供草稿、仅定义准入创建或整个模型的 revision。定义/Runtime 错误区分，超出支持范围明确拒绝，不弱化既有约束。

业务 Store 单独登记，支持 filesystem DataStore 和 filesystem-json ValueStore；目录相对 Registry Project 根解析，绝对目录按指定位置使用，全部执行相同配置、物理重叠和内容兼容检查，保护系统区域及 linked worktree 的 Memory。移除绑定保留目录、记录、锁及删除版本历史；已有直接 Store 绑定包括空 Store，会阻止模型定义变化和删除。

全部六种 list 及 Memory 子节点/Reviewer 入口统一 limit/cursor/items/nextCursor。filesystem JSON ValueStore 的所有记录写入口使用操作系统文件锁和原子条件检查，删除重建保持 revision 递增；DataStore 不伪造 revision、edit 或条件写。模型多文件操作共用 Project 锁及恢复服务，中断后下一条模型写请求先恢复，再预检新请求；读取和 dry-run 不自动修复。

中英 README、数据层文档、System Memory 源和副本、Skill、Reviewer 模板及依赖许可证同步。原型和市场第 06 示例改成本地定义；04/05 的原约束保留，含它们的整包导入明确拒绝且零发布。实际 Project 的五份系统登记和登记模型示例身份已统一，重复初始化无变化，10,679 份初始化前历史文件字节保留；9 个 run-domain 定义明确不支持，实际 Run 对应 raw 模型正常。

## 验证结果

完整 A1–A25 映射见 implementation-acceptance.md，实际实现和初始验证见 implementation-summary.md、initial-validation-report.md、verification-results.json；浏览器实测命令见 browser-verification.md，真实 Project 修正见 actual-project-audit.json。

实现第一轮正式评审发现 ACP 环境下旧 fake launcher 断言继承宿主变量，已真实复现并修正测试隔离，新增实际 Session Project/普通/冻结 Memory 访问验证。目录限制建议与既定绝对路径契约冲突，明确驳回并补真实 API/CLI 正向与重叠拒绝回归；没有更改产品标准。完整补充证据见 review/implementation-acceptance-round-1-fix-validation.md 和 review-verification-results.json。

本次最终实际门槛全部退出 0：

| 命令 | 结果 | 实际耗时 |
| --- | --- | --- |
| `npm test -- --test-concurrency=1` | 1,068 项；1,067 通过、0 失败、1 Windows 专属跳过 | 536.996 秒，含 pretest build |
| `npm run typecheck` | 通过 | 9.153 秒 |
| `npm run build` | 通过 | 10.816 秒 |
| `node scripts/project-smoke.mjs` | 通过 | 2.528 秒 |
| `node scripts/model-data-smoke.mjs` | 通过 | 12.911 秒 |
| `node scripts/model-data-package-smoke.mjs` | 实际打包、安装后运行 CLI，通过 | 18.916 秒 |

全量及独立检查在只含虚构标识、不含真实凭据的 ACP Session 环境中执行，已控制宿主变量。全量日志 SHA-256 为 d0e9009b1340d6b2dc0cd8f44f3ce0e8334b987a18289b65ca16d7ce6d4e5e3b；各命令、日志哈希及原失败/修复过程见 review-verification-results.json。最后 Session 定向 18 项、17 通过、0 失败、1 Windows 专属跳过；目录契约定向 3/3 通过，均纳入全量。

普通 `node dist/cli.js --project memsphere validate` 与变更级 `node dist/cli.js --project memsphere memory change validate` 均退出 0。最终 ChangeSet：change-20261005-031024825z-a1b5f8c3；validation passed；base 2b7400b0d3bff6670982ebcd0a02f023a6859e34；当前 content digest 57cd421178ab8068812af88bfd18e6f6f6cc0b675513e895f7edb5d345d8bffc。View：<http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3>。三份 System Memory 源与当前开发副本字节相同，校验后 Memory 未再修改；详见 review-memory-validation.json。此前报告所记旧 digest 作为历史保留，本报告使用当前最终证据。

## 验收结论

实现验收已接受：Review review-20261005-034612z-e11cf3b0，Round round-20261005-034612z-aa5a54fb。Human 架构师与架构 Agent approve，研发/测试 Agent 原建议票 request_changes 保留。Runner 完整读取正式意见，将研发宿主环境问题 accepted-fixed、测试绝对目录限制建议 rejected-invalid；当前全部门槛通过后已正式投 approve，Run 推进至本交付步骤。依据见 review/implementation-acceptance-round-1-runner-decision.md，不把 Runner 结论写成所有 Agent 均通过。

本报告供产品负责人 Agent 与 Human 审查本轮是否满足已确认需求。交付通过后按规范更新 change.md、归档需求、创建当前迭代 Git commit；GitHub PR 按后续 Human 决定处理。

## 后续范围与残留问题

本轮不扩展 JSON Schema Runtime、不支持跨模型引用、通用模型/Store 迁移、数据查询关联/事务/批量写入或完整 Web CRUD。04/05 和 9 个域模型的不可用是已批准的能力边界，不改写为可用，也不当作定义格式非法。

本地实测为 Linux / Node 22.16.0，Node 20/macOS/Windows 已配置 CI，但尚无本轮实机或远程 CI 通过证据。未承诺网络文件系统锁、整机断电持久性或外部手工修改协调；分页和数据扫描不承诺快照。正式发布或合并时继续观察平台 CI 的实际结果。

## 待确认项

没有新增产品或架构行为待决策。当前请求产品负责人对完整交付候选正式投票；归档、commit 和是否创建 PR 按 Run 的后续步骤执行。
