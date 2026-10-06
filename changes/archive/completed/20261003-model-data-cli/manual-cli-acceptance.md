# CLI 实际运行验收

2026-10-06，按 Human 澄清，以实际运行命令、观察输出和最终保存结果验收。全部 19 个新命令已逐条运行，未发现产品缺陷；这不代表所有参数组合都已穷举。

在 Linux / Node v22.16.0 上运行当前构建的 `dist/cli.js`，使用临时 Home 和真实 Project `cli-acceptance`，通过 CLI 创建模型、Store 和数据；没有使用 mock 或直接调用服务代替命令。共实际执行 54 次 CLI：45 次退出 0、9 次退出 1。除初次输入的相对 schema `$id` 被 Runtime 拒绝外，其余 53 次退出码符合预期。原始命令、时间、stdout、stderr、输入文件及落盘观察保存在 [manual-cli-acceptance.json](manual-cli-acceptance.json)。

## 逐命令结果

调用编号对应 JSON 记录中的 `commands[].number`，表格同时列出主要成功流程及相关错误分支。

| 命令 | 调用编号 | 实际观察 |
| --- | --- | --- |
| `model list` | 5, 6 | 每页 1 条，使用返回游标读取下一页，末页无游标 |
| `model read` | 7, 8, 10 | 读取 definition / all；JSON 与 YAML；修改后的定义和登记名称一致 |
| `model create` | 3, 4 | 创建两个模型，登记与定义实际保存 |
| `model update` | 9, 10 | 修改定义及登记信息；磁盘定义字节与输入文件一致 |
| `model delete` | 12, 14, 45, 48, 49 | 删除成功后文件消失且读取报缺失；仍绑定 Store 时拒绝删除 |
| `model validate` | 11, 36 | 定义及 Runtime 校验通过；检查 Store 中的 2 条记录无失败 |
| `data list` | 23, 24 | 每页 1 条，游标连续读取两条记录 |
| `data read` | 25, 26, 27, 31, 39, 41 | 完整值、默认 YAML、路径 $.count、修改后 revision；删除后报缺失；二进制元信息 |
| `data has` | 28, 38 | 创建后 exists=true；删除后 exists=false |
| `data create` | 21, 22, 40 | 写入两条 JSON 数据和一个二进制文件 |
| `data update` | 29, 31 | 完整替换成功，revision 从 1 增为 2 |
| `data edit` | 30, 31, 43 | 局部修改 count 成功，revision 增为 3；不支持 edit 的 Store 明确报错 |
| `data delete` | 35, 37, 39, 44 | 旧 revision 拒绝；当前 revision 删除成功，文件消失；dry-run 不改变字节或修改时间 |
| `data export` | 34, 42 | JSON 导出内容一致；二进制 stdout 原始字节为 00ff800a41，与输入一致 |
| `data validate` | 32, 33 | 已保存记录及候选值都校验成功 |
| `data store list` | 17, 18 | 每页 1 条，游标读取两个 Store |
| `data store read` | 19, 20 | 两个 Store 的路径及能力符合类型，分别检查 JSON 与 YAML 输出 |
| `data store create` | 15, 16 | 创建 filesystem JSON ValueStore 与 filesystem DataStore，目录按 Project Root 解析 |
| `data store remove` | 46, 47 | 解除登记成功，已有数据和 revision 历史文件保持原样 |

## 其他实际检查

- 调用 50–52 运行现有的 `project list`、`memory list`、`archive list` 分页入口；memory 返回下一页游标，archive 返回空列表。本次未验证这三项在多页数据下的完整遍历。
- 调用 53 重复运行 `project models initialize`，返回已有 5 个系统模型保留、没有新增。
- 调用 54 尝试修改系统模型，返回 `SYSTEM_MODEL_READ_ONLY`，退出 1。
- 磁盘检查确认模型定义更新、删除；数据更新和局部修改后的值及 revision；JSON 导出内容；二进制导出逐字节一致；dry-run 不改变文件字节和修改时间；Store 移除保留数据及 revision 历史。

## 运行中修正的验收操作

调用 2 首次使用了现有 Runtime 不支持的相对 schema `$id`，CLI 明确报 `MODEL_RUNTIME_UNSUPPORTED`，且未保存模型。换成受支持的绝对 URI 后创建成功；CLI 的模型引用始终是 `sales/order.json`，没有改动模型 ID 标准，也没有扩展 Runtime。

调用 13 中 CLI 正确返回“模型缺失”，临时验收记录器错误地解析空 stdout，导致记录器异常。修正临时记录器后调用 14 复验，结果正确。两次原始结果均保留，没有改产品代码。

## 范围及交付记录

本次补齐实际运行证据，没有新增单元测试，没有修改业务代码或 Memory，也没有重复完整自动化回归。自动化回归和安装包冒烟结果见 `output-format-verification-results.json`，不能用其测试数量代替本表逐命令验收。

本次平台为 Linux；未进行 Windows/macOS 人工验收。每个新命令均已运行成功流程，错误分支按上述表格记录；未穷举全部选项、输入和跨平台组合。

材料补充至同一 Run `run-20261003-090655z-f1e492f6` 的交付评审 `review-20261005-140919z-0e5efb80`。原冻结交付报告及已批准需求、方案和实现验收材料保持字节不变，本次讨论不替代产品负责人正式票。

当前 Memory Checkpoint：`change-20261005-031024825z-a1b5f8c3`，校验 passed，内容摘要 `076c3c71256feb93c6754b44fecaa97d0b461b2da54b15da7bc1321a10a1f04e`。[查看变更](http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3)。本次未改变 Memory。
