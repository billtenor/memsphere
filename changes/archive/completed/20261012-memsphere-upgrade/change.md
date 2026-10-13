---
id: 20261012-memsphere-upgrade
status: completed
completed_at: 2026-10-12
type: improvement
created: 2026-10-12
run_id: run-20261012-065205z-48f8d036
---

# Memsphere 升级路径与统一项目运行升级

## 问题与理想态

升级对象和操作路径分散，项目系统记忆与系统模型/登记分别操作，容易漏项或误判整体完成。理想态是 Agent 能从 Skill 发现完整升级路径，并通过一次项目升级调用同步处理这两类系统资源，结果清楚、保护用户数据、失败可定位并可重试。

## 当前范围

Human 已确认统一入口只自动处理项目系统记忆与系统模型/登记；CLI、Skill、View 与迁移的完整升级路径同时明确。具体需求、验收、后续范围与采用规范见 requirement-contract.md，具体方案待评审后形成。

## 向前兼容

结论：不需要向前兼容。无适用 stable Tag checkpoint；现有项目安全升级和用户内容/历史保护属于本轮需求。

## 参与与当前状态

Human 额外参与产品负责人和架构师，对应产品、研发、测试、架构 Agent 全部参与。Run 已启动，第三轮需求评审已通过，正在提交实施与验证方案评审，尚未实施。

## 需求评审修订

第一轮 Human 要求明确新命令及设计功能，产品 Agent 通过。第二轮需求契约明确 memsphere project upgrade 的调用方式、四项功能、目标选择、输出/退出结果、现有命令关系和验收；摘要见 requirement-revision-2.md。Run 和 Review 继续复用。

## 第三轮需求修订

第二轮 Human 与产品 Agent 均投要求修改。已纳入三类升级、新增 skill upgrade = init --force、Agent 协助入口及必须落实到 Skill 的要求，并接受产品 Agent 的固定测试门禁意见。修订摘要见 requirement-revision-3.md。本轮继续复用 Run 和 Review，提交第三轮需求评审，尚未实施。

## 方案评审

第三轮需求 Human 和产品 Agent 均通过，Runner 已接纳。实施与验证方案见 implementation-plan.md，明确修改清单、系统定义升级准入、部分失败重试、Skill 主说明与验证门禁，提交架构/研发/测试评审。

## 方案第二轮修订

第一轮 Human、架构和测试通过；研发指出 System 登记发行元数据与 Embedded 工作树证据归属问题。Runner 接受并修订，详见 implementation-revision-2.md，提交第二轮方案评审，尚未施工。

## 方案第三轮修订

第二轮 Human 要求 System 升级专用 ChangeSet、Embedded 独立分支/worktree 与单独 commit、Skill 引导配合。已纳入方案，明确专用记录隔离和显式重试、交付阶段及保护验收，并接纳架构旧 Run 回归建议。提交第三轮方案评审，尚未施工。

## 第四轮需求补充与方案评审

第三轮 Human 通过；研发/测试/架构提出通用入口防护、需求范围同步、master 语义、强校验和 JSON 错误路由意见。已全部接受，更新需求契约补充章节并将完整契约与修订方案合并上报，等待 Human 以需求负责人/架构师确认，未施工。

## 施工开始

Human 已确认第四轮完整需求补充与方案；Runner 接纳并留有全部意见处置。任务清单已上报，模型升级、专用 ChangeSet、CLI、Skill、Framework 与文档正在实现。当前类型检查和构建通过，受影响测试及最终验收尚在进行，不宣称完成。

## 最终验证与成果评审

145文件最终全量通过（1201pass/1既有平台skip），类型检查/构建/最终Store和Memory变更级校验通过；最终CLI验收9/9。sync锁重入与缺普通登记候选问题已修复并回归。验收材料见acceptance-material.md，提交研发/架构/测试成果评审，未交付或创建PR。

## 成果第二轮修订

Human首轮通过，架构故障注入指出Embedded记录创建失败窗口。已修复并增加2项回归，最终145文件全量零失败、CLI11/11，日志改可跟踪txt；在当前81f1会话工作区提交第二轮成果评审。

## 产品交付验收

第二轮研发/架构/测试均通过，无阻塞；Runner已逐条处置平台及维护建议并接纳技术成果。交付报告delivery-report.md，进入Human要求暂停确认的产品验收节点。未commit/PR/远端CI。

## 验收通过与归档

Human 明确回复“验收通过，请继续”，产品 Agent 同时通过，无阻塞意见；Runner 已接纳产品验收。最终全量 145 文件、1203 用例通过、0 失败、1 既有平台跳过，CLI 11/11。Memory ChangeSet change-20261012-134215362z-d42aa792 校验通过，checkpoint digest 20c05b7e67d38842973a207b599be1abcdf9b042b293ac0158a61462995e9d87；View http://0.0.0.0:30000/projects/memsphere/changes/change-20261012-134215362z-d42aa792。需求目录完成归档，随后提交本轮代码与 PR 并跟进最新 head 的 CI；最终合入由 Human 操作。
