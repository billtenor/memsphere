# 已确认：Memory 快照不包含 Git 占位文件

Run：run-20260929-121744z-d56a5df3。当前停留功能实现摘要，未上报为完成。

## 实际问题

当前开发 Project 的 Memory 目录已有 concepts/.gitkeep 和 statements/.gitkeep。820530e 的 writeRunMemorySnapshot 使用 cp 复制四个 Memory 目录，保留这些文件；新版通过 filesystem DataStore 按 ID 写入时，文件名必须匹配 contentTypeExtensions。

在临时目录构造合法 Procedure 和 concepts/.gitkeep，调用新 startRun，实际得到：`No contentType configured for filename: <runId>/memory/concepts/.gitkeep`。没有写入真实 Run 或修改历史内容。

同样的问题会影响旧 Run 中列入清单的未知后缀或无后缀文件：补齐工具可以发现原文件，但现有 Store 无法 get/delete 搬运它。不能通过改文件名满足映射，后者违反原布局要求。

## Human 结论

Human 明确“对呀，.gitkeep，感觉是可以丢弃的东西”。.gitkeep 仅是 Git 空目录占位，不是 Memory 内容；此前递归复制顺带保留它，没有领域用途。

撤回为 .gitkeep 增加默认 contentType 配置的提案，不修改 src/data/api、filesystem Store 的未知后缀行为或现有用户配置。

新快照与独立旧清单补齐工具排除普通 .gitkeep 文件，不删除来源 Project 的文件，也不将该决定扩大成跳过其他未知内容。补齐工具依旧默认检查、显式写入、不覆盖已有 files。

旧快照目录中的普通 .gitkeep 不再通过内容 Store 搬运；归档或恢复完成状态切换后，清理旧端时可删除其 Memory 目录内的这些占位文件并移除空目录。其他未知文件与符号链接仍保留并报错，不借此递归删除业务内容。

本项已确认，不再是待决项。剩余实现验证仍按原 Run 推进，尚未验收或提交。
