# 第六轮需求契约修订摘要

日期：2026-10-04（Asia/Shanghai）。
Run：`run-20261003-090655z-f1e492f6`。
Review：`review-20261003-091025z-c55e8931`。
上一轮：`round-20261004-144618z-5e3ad255`（第五轮）。

Human 要求：“data list 都有翻页查询的能力，为啥 model list 就没了呢？这个补一下”。

Human 随后讨论数据局部修改命令名，并以“edit 不错”接受 data edit。

Human 再要求：“data store list 这个也没支持翻页。你再检查一下，凡事是 list 的都要支持翻页”。

Human 已明确“要求修改，请提交新一轮 review”。Runner 已受托提交第五轮 request_changes 和两条 blocking Comment；授权及原话见 review/round-5-human-authorization.md。

## 修改

1. 所有 list 统一 --limit 和 --cursor，默认 100、范围 1–1000、items/nextCursor、结束判定及游标校验规则；分页本身不创建快照，各命令明确定义固定顺序。
2. 明确模型先筛选、再排序和分页，翻页保持 Project 和筛选条件一致；非法或错用游标报错，允许调整每页条数。
3. 补充模型和 Store 翻页命令示例；data list 同步明确游标只能用于同一 Project 的同一 Store。A25 覆盖全部 list 命令、Memory 查询模式和 Reviewer 入口。
4. 数据局部修改命令由 data patch 改名为 data edit，统一命令表、dry-run、并发与能力说明、示例及 A8–A10。明确 update 整条替换、edit 局部修改；JSON Patch 输入格式及 --patch/--patch-file 参数保持不变。
5. 补齐 data store list 分页，并把现有 project list、memory list、archive list 的分页同步纳入本轮；Memory 顶层/子节点、冻结 Run 和 memsphere-review 均覆盖。源码及调用方清单见 list-pagination-audit.md，不保留旧列表的分页例外。

## 第五轮产品 Agent 意见的状态

以下两项尚未解决，已明确列入第六轮需求的待确认项：

1. 已有 Project 的模型 ID 修正路径，包括持久化定义、登记、Store 和 Run 数据的一致修改，以及冲突、中断和恢复安排。
2. 市场第 04/05 例及当前 Project 9 个 run-domain 模型所含 Runtime 不支持约束的保留方式，需要明确能力扩展或等价定义改写的范围和验收。

本次提交完成 Human 提出的分页与命名修改，并如实保留这两项未决问题，未将其标记为解决。

## 验证与状态

已核对六个 list 的全部入口、Memory 各查询模式、Reviewer 入口、data edit 命名、A1–A25、表格和命令示例语法。第五轮冻结产物保持原样。

本次只修改需求与评审记录，没有修改业务实现、模型或 Memory，没有执行实现测试。第六轮是否通过由正式评审决定。
