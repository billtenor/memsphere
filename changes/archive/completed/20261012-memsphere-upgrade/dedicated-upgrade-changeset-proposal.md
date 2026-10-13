# 系统记忆升级专用 ChangeSet：待纳入的修订要求

Human 在第二轮方案评审中提出：系统记忆升级使用专用 ChangeSet，例如单独切分支操作，并在 Skill 中引导用户配合。

## 要求与用户协作

系统记忆升级产生的 ChangeSet 仅包含本次升级所需的 System Memory 差异，不混入用户已有 Memory 修改，不复用、接管或改写用户正在协作的 ChangeSet。Managed 保持既有受控升级 ChangeSet；Embedded 建议在独立升级分支和 worktree 中操作，保留原工作区及其未提交修改。

Skill 需要解释升级准备、专用分支/worktree 的用途、校验结果和 ChangeSet 的查看方式，指导用户审阅差异并按项目现有方式集成。Agent 可在已授权范围内准备可审阅结果；涉及需要用户决定的基线、与已有工作冲突或最终合入时，具体说明需要用户配合的事项，不擅自 stash/reset 原工作区或合入。用户已明确授权的动作不反复询问。

专用 ChangeSet 的验收：原工作区存在合法用户 diff 与带评论/claim/scope 的 ChangeSet 时，独立升级仍不能修改它们；升级 ChangeSet 的 targets 全部属于本次 System 升级范围；原 worktree 用户内容、原 ChangeSet ID/targets/checkpoint/评论/claim/scope 与生命周期不变。审阅与集成路径明确，无变化不创建空 ChangeSet。

## 必须处理的实现事实

当前 Embedded CLI capture 按 Project、Git common repository 和 HEAD base revision 匹配 active ChangeSet，分支名及 worktree 路径不参与身份。因此仅创建不同分支或 worktree、但仍使用同一个 HEAD，不能保证专用 ChangeSet，会存在复用旧记录的风险。

修订方案必须解决独立候选/记录的创建、显式校验定位及后续重试的识别边界，不能把“切了分支”当作已完成隔离。优先使用现有受控候选与显式 ChangeSet 接口；若需要改变 ChangeSet 身份或新增命令/参数，应先在方案中列明影响并评审，不在施工中临时扩大协议。模型与登记依旧是当前 Project 共享状态，不因 Memory worktree 独立而承诺模型分支隔离。

## 流程状态

Human 已正式投要求修改并授权提交修订；意见已纳入 implementation-plan.md 及 implementation-revision-3.md。它替代方案中“允许将原用户 diff 纳入整体工作树证据”的设计方向。第二轮已提交方案是冻结评审快照，当前讨论不代作 Human 的通过/要求修改票；尚未施工。
