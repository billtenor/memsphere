# 上下文控制：开发计划

Run：run-20261022-130223z-496d73ae。
实施基线：review-20261024-093057z-cd0c398f 第4轮 round-20261024-111321z-5cbf4ff3 已通过；Human assignment-20261024-111321z-d6960ebe 已明确确认该轮固定附录A的完整需求补充。采用原第4版需求+该固定补充，不改写历史需求快照。

| 顺序 | 工作 | 完成判据 |
| --- | --- | --- |
| T0 | 当前工作区建立 codex/context-control-exploration，快进已调查 master；建立需求目录 | HEAD=1d4679b 基线，保留无关 graph 语法草案，记录本轮授权与产物 |
| T1 | JSON ValueStore 分层 ID，含 Project data 校验和重新登记 | 分层 CRUD/分页/CAS/删除重建与旧扁平元数据回归通过 |
| T2 | 五模型发行、项目注册和默认 Store 装配 | 干净项目可初始化，npm 包资产齐全，旧项目读取不自动初始化 |
| T3 | 新领域服务及 CLI | create/for/target、直接 report、标签、依赖、External、轻量 Review、修订、交付与取消闭环；单记录 CAS、业务 Run 锁、原 ID redo 有边界测试 |
| T4 | 既有 Run 模块的产物图与浮窗 | 从真实 Store 读数据；历史切换、badge、标题、浮窗和窄屏符合已确认原型 |
| T5 | 文档、Skill、System Memory 同步及实际验证 | 受影响测试、typecheck/test/build、memsphere validate；有 Memory 差异则最终 change validate；真实 Shell 浏览器验收 |
| T6 | 按 Procedure 上报实现摘要、验证报告与实现验收 | 汇总实际改动与测试证据，全部角色评审通过后继续交付报告；不预先代投未来 Human 票 |

约束：Store 只负责单记录 CAS，跨记录由业务层按 Run 编排；以保存 Artifact 为先，redo 相同实体 ID 补齐 Step，已完成直接沿用。无目标ID的新 CLI 请求不承诺重试去重。改绑保护、通用事务日志、自动回滚和补偿系统不在本轮。

采用 memsphere-repository-development-rules、memsphere-repository-testing-rules、memsphere-repository-requirement-rules、memsphere-repository-delivery-rules。无新增 YAML syntax 关键字。

完成实现验收后按交付规范归档需求目录，交付评审通过再创建本轮 commit；PR 仍由 Human 决定。
