---
id: 20261031-concept-memory-writing
type: memory
completed_at: 2026-10-31
created: 2026-10-31
run_id: run-cceb4436-7771-4dbb-8c97-4987cb560d77
---

# Memsphere Concept 与撰写规范

Concept 的目的在于实现概念理解的一致性；原 Memsphere 定义被大量命令、路径和实现描述淹没。本次将它改为产品含义、边界及必要关系，新增可供编写和评审复用的 Concept 撰写规范。

## 向前兼容

结论：需要向前兼容。仅修改记忆正文并新增 Statement，保留现有 canonical name、别名、安装路径与 YAML 结构；不改变语法或运行协议，已有冻结 Run 保留原记忆。Concept Schema 的版本说明改为引用现有语法版本规则。

## 内容归属

- 产品含义与软件资产分工：保留于 memsphere-framework，并指向 memsphere-personalized-software。
- Memory 发现、引用、快照与工作区规则：已有 memsphere-memory-access-rules；编辑和发布路径已有 Skill、构建 Procedure 与仓库规范。
- CLI、模型与数据使用、升级、ACP、Windows、运行入口：已有 Skill 的相应章节及 CLI Help；模型产物细节另见 docs/model-artifact.md，上下文控制见 docs/context-control-exploration-cli.md 和 docs/procedure-graph-syntax.md。
- View 与 Runner：已有相应概念、Skill 及 View SDK 文档。本次不顺带改写这些记忆。
- 存储布局、模板构建、清单版本、界面控件等实现说明不继续作为产品概念定义；本次不新建一个汇总实现细节的记忆。原“全部 list 命令统一分页”不符合当前 CLI，不搬运。

撰写规范按是否澄清理解歧义取舍内容，并区分概念边界、独立规则、步骤及内容结构；不设篇幅或条数配额。Concept 与 Skill 提供入口，manifest 安装该 Statement，发行源与开发 Project 副本保持一致。

## 验证

已通过本次相关检查：product-positioning 与 reserved-store 测试、类型检查、构建、Project Store 校验以及变更级校验。测试验证撰写入口可发现、安装清单完整、发行源与项目副本一致；语义取舍由本次内容审阅确认，机器校验不证明自然语言质量。

此前按旧规范启动的全量回归遇到 daemon 集成测试文件监听器 EMFILE 错误，随后主动中断；该轮不视为通过。按用户要求，测试规范现改为依据实际变更风险选择检查，纯正文修改不默认运行类型检查、构建或全量回归；manifest 修改仍需 Reserved Store 检查。

ChangeSet：change-20261031-142958242z-23a545aa，passed。View 路径：/projects/memsphere/changes/change-20261031-142958242z-23a545aa。

验收原始日志位于 /tmp/concept-target-tests.log、/tmp/concept-typecheck.log 和 /tmp/concept-full-tests.log，不纳入代码提交。实现与相关验证完成，PR 集成及 CI 状态另行检查；自由探索 Run 保持开放。

## 自动化测试清理

按现有测试规范删除以关键词、固定句子、章节数量或引用次数推断语义正确性的测试：产品定位、教程、Skill 路由、文档说明、README 引导，以及安装测试中夹带的正文断言。保留 Memory 解析与安装副本一致性、manifest 校验、Skill 安装与升级、Git 行为、发布元数据及文档中可执行示例的解析与运行验证。

受影响的 product-positioning、reserved-store、skill-command、package-release、git 测试通过。此次不改运行代码，不追加全量回归。私有评测材料保存在 evolution，不纳入本仓库。
