# 测试 Agent 目录限制意见：驳回依据

日期：2026-10-05（Asia/Shanghai）。
Run：run-20261003-090655z-f1e492f6。
Review：review-20261005-034612z-e11cf3b0。
Round：round-20261005-034612z-aa5a54fb。
Comment：comment-20261005-035001z-02c44d34（traex3）。
处置：rejected-invalid。

已批准的第八轮 requirements.md 第 4 节明确写道：

> directory 是存放数据的目录，没有默认值，也不从 Store ID 推测。相对路径以所选 Project 根目录解析，绝对路径按指定位置解析，再检查目录是否可用及是否与其他存储重叠。配置文件本身的路径仍相对命令 cwd。

冻结需求的 SHA-256 为 d7293a0552a4c7fb4016402e72cbb42d04089a0b7088f4768778b48704762724，未修改。已通过的实施方案第 4 章要求相对目录以 Registry 根解析，并执行路径归一化及重叠检查；没有撤销需求允许绝对目录的规则。`memory_path` 的仓库相对规则专门用于 Embedded Memory，不适用于业务 Store 的 directory。

`resolve(root, directory)` 对绝对目录保持指定位置，对相对目录以 Registry Project 根解析，符合该契约。随后 `canonicalPath` 与双向重叠检查禁止覆盖模型、登记、备份、Memory（包括 linked worktree）、Run、Archive、内部目录或其他业务 Store；目录内容/Factory/MIME 兼容性另行检查。业务数据可以在经明确配置且兼容的外部目录，不承诺每个目录都位于 Registry 根内部。

该意见只以“绝对目录或 ../outside 可越出 Registry 根”为阻塞理由，没有提供绕过重叠检查或目录协议的反例。禁止所有绝对路径、套用 memory_path 校验会改变已批准行为，Runner 不据此修改实现或需求。对路径边界的具体反例仍按同一契约审查。

为防止后续重复误读，补充实际 API/CLI 正向用例，验证两种 Factory 的隔离绝对外部目录创建、已登记加载、解除后重登记及数据保留，并用相对目录命中同一物理位置的重叠拒绝验证边界。此为已有契约的测试证据，不新增例外或改变产品范围；最终命令和结果记于本轮修复验证记录。
