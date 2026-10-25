> 历史草案：后续已整理为requirements-revised.md及独立修订需求产物；Human确认依据见requirements-confirmation.md。以下“待确认”表述保留当时状态，不代表第2轮当前状态。

# 自由探索体验优化：需求范围修订草案

状态：技术方案讨论产生的范围收敛草案，尚未作为新一轮正式需求契约通过。原 requirements.md 的已评审正文保留。

依据：ACP 当前只用于旧正式评审；Human 提出本轮无需处理该部分。本轮保持自由探索 CLI 和已有 Run 图界面的范围，不新增 Runner 宿主。

| 条款 | 修订后的要求 |
| --- | --- |
| F1 | Continue 承接自由探索公共参数。入口自动生成前文 ID，普通调用显式执行 continue C；具体材料、正文、依赖、意见来源及修订对象仍按命令提供。不建设 ACP 接入或环境默认 ID |
| 前文生成及提示 | run start 自动创建初始 CommandState 并返回 contextId 和 continue C --help 提示；run status 查询原有记录，不查询一次新建一次；普通独立命令不改变前文归属 |
| AC2 | 普通调用可跨独立 Shell 显式延续同一个 C，不依赖进程环境或之前的 export；没有显式 ID 时不给出“已从 ACP 注入”的假设 |
| AC3 | 模型与 Store 支持同一个 Run 的多份 CommandState，公共参数和内部状态互相隔离；本轮不新增多 Runner 启动器、手动分配或管理命令 |
| 排除范围 | ACP Worker、正式评审会话、自由探索 Runner 启动及自动分配／注入、环境变量默认 ID，本轮均不改造 |

其余功能保持：六类 Continue 业务操作、普通读取和查询、移除 artifact create 与 --for、External 简短回执、长内容输出、图展示及交互。

技术讨论中已确认的辅助窗口取舍同步说明：state 只保留 lastArtifactId、reads；正常路径按候选规则提醒；识别失败和辅助保存异常允许遗漏或过期候选，业务真实产物及依赖不受影响。业务 report 失败不执行窗口结转；辅助 CAS 冲突不强行覆盖。

进入实现前在正式敏捷 Run 对齐这些修订，不把用户对技术方案的讨论视作已对本草案完成正式投票。

长内容阈值按 Human 最新意见固定：Artifact、External 正文超过 200 chars 时保留前 200 个字符并追加 ...；按字符而非 bytes 统计，英文字母与汉字都各算一个。JSON 回执仍保持合法、提示与正文区分；--out 完整导出原始字节，不受该阈值影响。对应 AC9 技术细节据此收敛。
