# 第七轮需求契约修订摘要

日期：2026-10-04（Asia/Shanghai）。
Run：`run-20261003-090655z-f1e492f6`。
Review：`review-20261003-091025z-c55e8931`。
上一轮：`round-20261004-151001z-e9767035`（第六轮）。

Human 指出：“之前不是讨论过，要用 json path 这个语法吗？好像更完整是吧”。

Human 最终明确：“算了，还是统一叫 --path <path> 吧，jsonpath 只是其中一种实现，以后可能还有更多的实现”，并要求修改后发起新一轮 review。

第六轮 Human 已在 View 提交 approve；Runner 保留该正式记录，根据最新对话要求及全部评审意见投 request_changes，进入修订。完整依据见 review/round-6-revision-request.md，没有覆盖 Human 既有 Opinion。

## 修改

1. data read 的参数统一写为 --path <path>。path 是记录内的查询路径，本轮采用 RFC 9535 JSONPath 语法，支持字段、索引、切片、通配符、递归、筛选及标准函数。JSONPath 是本轮采用的实现，后续可支持其他实现；本轮不增加其他语法或切换参数。
2. 明确带 --path 的 value 固定为匹配值数组，区分无匹配、null、匹配到数组、记录缺失及语法错误；查询限于这条记录内部。
3. 同步命令示例、实现范围和 A8。data edit 的 JSON Patch 操作仍按 RFC 6902 使用 JSON Pointer path/from，多值查询不自动成为批量修改。

## 评审与验证状态

模型 ID 修正路径及 Runtime 约束保留两项待确认问题继续保留，未标记为已解决。

已核对 --path <path> 命名、本轮 JSONPath 查询语义、JSON Patch 路径、A1–A25、表格和命令示例；第六轮冻结产物保持原样。只修订需求及评审记录，没有修改业务代码、模型或 Memory，没有执行实现测试。第七轮是否通过由正式评审决定。
