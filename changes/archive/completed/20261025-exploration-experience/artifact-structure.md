# 技术共创产物结构

共创Run：run-67ed4607-6fc0-4310-ba4b-8a9e0b201de0。只保留五类主干产物，旧稿与讨论管理产物作为历史留存，不删除记录。

| 当前产物 | 当前ID |
| --- | --- |
| 修订需求契约 | artifact-8f2e93fb-3e49-419b-9fc2-0b7ecd6208b2 |
| CLI与状态流转 | artifact-10b0780a-d948-4f7b-be40-8a62ab3e4288 |
| Run、CommandState模型与辅助读取 | artifact-82df6f49-5bd0-49d9-9b49-6a3439981c14 |
| 图展示与交互 | artifact-909ebbb0-76fb-401b-8afe-e4579b5c9eee |
| 实施与验证方案 | artifact-1bc88c83-437c-4a9d-a0d7-5eb20403cac6 |

当前实施方案依赖其余四份产物；CLI、模型和图设计分别依赖当前修订需求。三类External来源为原需求、Human输入和代码基线。依赖指向具体Artifact ID，修订通过revisedFrom留存，标签不改变真实依赖。

默认成果从完整submitted产物的依赖及修订关系推导，再应用Run.outputOverrides中的人工增删。report与redo不写Run。成果根为当前实施方案，实际可见闭包5份Artifact、3份External、14条边。空成果不回退全图，历史选择保留原上下游投影；无需在历史菜单选择最新版才能看到主干。

实现及真实Store已切换，View已重启。没有为隐藏历史而提前结束共创Run，原讨论、各轮Revision及Review保留。实施验收位于正式Run run-20261025-035719z-bcc49b1e，五类设计产物不替代正式评审票。
