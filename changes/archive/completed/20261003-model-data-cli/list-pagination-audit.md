# list 命令分页核对

日期：2026-10-04（Asia/Shanghai）。
Run：`run-20261003-090655z-f1e492f6`。

用户要求：“data store list 这个也没支持翻页。你再检查一下，凡事是 list 的都要支持翻页”。本记录核对源码和需求工作稿，尚未实现或运行新命令。

## 完整清单

现有主 CLI 在 src/cli.ts 注册三个名为 list 的命令，没有额外别名或动态注册的 list。加上本轮新增三个，全部纳入同一分页标准：

| 命令 | 当前情况和源码依据 | 本轮要求 |
| --- | --- | --- |
| model list | 本轮设计新增；前次已补 limit/cursor | 使用公共分页规则，先筛选模型，再排序分页 |
| data list | 本轮设计新增；底层 Store 已有分页，src/data/api/store.ts、src/data/extensions/shared/filesystem.ts:383 | CLI 暴露相同参数和边界，限定 Project/Store |
| data store list | 本轮设计新增；前稿遗漏分页 | 补 limit/cursor，先筛选 model/kind，再按 Store ID 分页 |
| project list | src/cli.ts:127、src/commands/project.ts:880；无分页参数，JSON 返回完整数组 | 补 limit/cursor，输出 items/nextCursor，保留项目状态及 Workspace 关系 |
| memory list | src/cli.ts:184、src/commands/memory.ts:75；无分页参数，顶层返回 memories/next_cursor，后者固定为 null | 补 limit/cursor，统一 items/nextCursor；目录、根子节点及 --node 子节点全部支持 |
| archive list [kind] | src/cli.ts:606、src/commands/archive.ts:17；文本全量输出，无分页参数 | 补 limit/cursor 和 JSON 输出，按筛选后的归档条目分页 |

## 查询模式与调用方

- memory list 无 reference：目录列表，按 kind/query 筛选。
- memory list <reference>：根的直接子节点。
- memory list <reference> --node <node-ref>：该父节点的直接子节点；保留声明顺序及完整节点引用，分页不重新编号。
- memory list --run：从同一 Run 的冻结 Memory 查询；游标不得跨 Run 或跨冻结内容使用。
- memsphere-review memory list：src/acp/cli-runtime.ts:87 起判断并转发主 CLI，继续限制项目和冻结 Run，使用相同分页实现。
- JSON/YAML 中原 memories/nodes/next_cursor 改用公共 items/nextCursor，父节点和 Memory 身份等上下文继续返回；同步 serializer、CLI 消费方、测试、帮助及 Skill。文本输出也必须给出本页和可复制的下一页游标。
- project list 查询 Home 登记表，Memory 目录可能包含其选定的多个项目，不能机械套用 model/data 的单 Project 范围；游标按各命令实际范围校验。

model market list 尚未实现且在后续范围，未来提供时也执行同一分页标准。run status 不带 --run 时会列出多个 Run，但不属于名为 list 的命令；本次不据此增加新命令或修改其状态查询职责。

## 统一验收

全部入口支持 --limit（默认 100、整数 1–1000）、--cursor、items/nextCursor；筛选在分页之前执行，无效或错用游标报错。空结果、末页、页大小变更、连续遍历、跨命令/范围/模式复用和所有输出格式在 A25 中一起验收。所有现有 list 都包含在清单内，不以历史行为或当前条目较少作为例外。
