# 实施与验证方案第2轮修改记录

Human本轮approve已正式记录并保留。三位Agent均request_changes；Runner阅读全部意见后要求修改，未接纳方案进入实施。

| 意见 | 修订 |
| --- | --- |
| outputs先于Step完成导致故障读取无效根 | 所有对外Run／根／图读取先在短锁内redo；失败明确RECOVERY_REQUIRED，成功后才返回快照；无新增恢复身份 |
| 在用模型无法由通用更新直接切换 | 明确project models initialize的专用受限升级模块，复用现有Project锁和model-operation前后快照／回滚，验证旧Runtime→新Runtime及元数据保留 |
| Context Control与Home模型资源混淆 | 五实体仍用context-control manifest；Home CommandState放唯一home_models资源区，经同一catalog／Runtime装载，不自动安装到Project |
| 部分report原样重试产生重复 | 错误披露原Artifact／Step身份及run status恢复指令；不承诺新请求去重，测试原样report重试、另一写操作及重启恢复三条路径 |
| 当前评审无法读取确认原始记录 | 随第3轮冻结本Run第1／2轮Human原始Assignment及对话逐字片段，不要求访问其他Run，不伪造正式需求通过票 |
| Statement引用缩写 | 列全四个canonical reference及采用项 |

上述为方案修订；未运行尚未实现的业务功能测试，未切换真实模型Store或页面。
