---
id: 20260828-memory-change-validation-guardrails
status: done
type: feature
created: 2026-08-28
completed_at: 2026-08-29T09:26:43Z
run_id: run-20260829-075105z-cc35ed91
---

# Memory 变更级校验与 ChangeSet 交付门禁

## 需求

改进 Memory 编辑后的变更级校验引导和交付门禁，使 Agent 能稳定区分 `memsphere validate` 与 `memsphere memory change validate`，避免只完成正式 Store 校验却没有创建或更新 ChangeSet、也没有向 Human 提供 ChangeSet ID 与 View 链接。

该门禁同时适用于 Managed 与 Embedded Project：

- Managed Project 的 Memory 修改必须在受控 ChangeSet 候选上完成变更级校验，并按既有 publish 流程发布。
- Embedded Project 的 Memory 工作树修改必须创建或复用逻辑 ChangeSet，完成变更级校验后再通过正常 Git 流程集成。
- 两类 Project 的创建时机、候选位置和集成方式可以不同，但都不能用普通 `memsphere validate` 代替变更级校验。

本需求来源于 View 中文化迭代中的真实遗漏：正式 Store 校验已经通过，但交付报告未包含 Memory ChangeSet；直到 Human 主动索要链接后才补执行 `memsphere memory change validate`。关联证据为 ChangeSet `change-20260828-035525403z-9dd8d41d`，但本需求不纳入该中文化迭代实现。

## 验收标准

- 修改 Managed 或 Embedded Project 的 Memory 后，适用规则明确要求执行 `memsphere memory change validate [change-id]`；普通 `memsphere validate` 明确不能满足该门禁。
- 通用敏捷开发流程在实现验证、交付报告或 commit 前检查 Memory 交付差异；存在 Memory 差异时，交付报告必须包含匹配当前内容的 ChangeSet ID、校验状态和 View 链接。
- memsphere Skill 在靠前且醒目的位置提供 Memory 写入硬门禁，而不是只在 ChangeSet 详细说明中间接提及。
- `memsphere validate` 的命令帮助和成功输出明确说明其校验范围，以及不会创建或更新 ChangeSet，并提示 `memsphere memory change validate`。
- `memsphere validate` 保持原有职责，不因普通整体校验自动创建 ChangeSet，也不破坏 `--memory-root` 的无 Home、Registry 或 Binding 校验能力。
- 自动化测试覆盖 Managed 与 Embedded 两类 Project、CLI 提示、`validate` 无创建 ChangeSet 副作用、Skill/Memory/Procedure 规则一致性，以及交付报告门禁。
- Project System Memory、Reserved System Memory 和 `src/skills/memsphere/SKILL.md` 的重叠语义保持一致，并通过适用的完整回归。
- 不迁移历史 ChangeSet；Embedded 捕获新变更时，schema 不兼容但原始状态明确为 `completed` 或 `abandoned` 的旧记录不得阻塞新 ChangeSet，active、未知状态或不可解析记录仍必须阻断。

## 范围

- 修订 Memory 编辑、仓库开发、仓库测试和敏捷交付相关的 Statement/Procedure 规则。
- 修订 memsphere Skill 的 Memory 写入门禁和命令区分说明。
- 改进 `memsphere validate` 的 help、文本输出及适用的结构化诊断设计。
- 增加 CLI、ChangeSet、System Memory 同步和流程契约测试。
- 同时覆盖 Managed 与 Embedded Project 的变更级校验要求。
- 按 2026-08-29 Human 明确确认，覆盖旧终态 ChangeSet 不迁移且不阻塞新 Embedded 捕获的兼容边界；新的 ChangeSet 继续遵守既有 `store_type` 必填模型。

## 不做事项

- 不让 `memsphere validate` 自动创建、更新、发布或完成 ChangeSet。
- 不合并 `memsphere validate` 与 `memsphere memory change validate` 两个命令的职责。
- 不改变 ChangeSet schema/data model；`store_type` 在本迭代开始前已经是必填字段，本轮只增加旧终态持久记录在 Embedded 自动捕获路径中的兼容处理。
- 不改变 Managed publish、Embedded Git 集成、ChangeSet claim/comment 或生命周期语义。
- 不在当前 View 中文化 Run `run-20260827-140127z-439c5941` 中实施本需求。

## 关联需求

- `20260818-changeset-effective-validation`：已完成，提供 ChangeSet 有效 Store 校验入口。
- `20260822-changeset-experience-loop`：已完成，提供 Embedded ChangeSet 体验闭环。
- `20260823-changeset-active-lifecycle`：已完成，定义 ChangeSet active 生命周期。
- 重复需求：无。

## 技术与测试方案

### 技术方案

- 移除普通 `memsphere validate` 对 `checkpointWorkspaceChanges()` 的调用，使普通 Store 校验不再创建或更新 Managed ChangeSet recovery；只有显式 `memsphere memory change validate [change-id]` 才保存变更级 checkpoint/recovery 证据。
- `memsphere validate` 的 help、Project Store 文本输出和 JSON 输出明确校验范围、无 ChangeSet 副作用与变更级校验入口；stateless `--memory-root` 明确没有 Project/ChangeSet 上下文，不返回可立即执行的 ChangeSet 下一步。
- Managed `memory edit/delete/rename` 输出带实际 ChangeSet ID 的下一步命令；Embedded edit 保持不预创建 ChangeSet的现有行为。
- 在 Skill 前部增加 Memory 写入硬门禁，并同步 framework System Memory 的 Reserved 源与当前 Project 副本。
- 修订当前仓库 development/testing/delivery Statements 和 agile Procedure，在实现、验证、交付、commit 阶段按 Memory diff 条件要求变更级校验与 ChangeSet 证据。
- 修订官方 generic agile 与 general development/testing/delivery Memory，使其他项目导入官方流程后获得同样保护。
- 不增加 YAML syntax 关键字，不修改 ChangeSet 数据模型、publish、claim/comment、Embedded Git 集成或生命周期语义。
- `store_type` 必填及新建 ChangeSet 从 Project Store 写入该字段均为本迭代前既有行为；根据 2026-08-29 Human 的范围确认，Embedded 自动捕获改用 best-effort 列举，并仅忽略原始状态为 `completed`/`abandoned` 的旧 schema 不兼容记录。严格 list/detail 行为不变，active/未知损坏仍阻断。

### 测试方案

- CLI 集成测试覆盖 validate help、Project Store 文本/JSON、stateless `--memory-root`、Managed edit/delete/rename 提示与 Embedded edit 现有行为。
- Managed active ChangeSet 测试比较普通 validate 前后的持久 candidate/recovery、checkpoint、元数据和状态，证明普通 validate 无 ChangeSet 写入；随后证明显式 change validate 才更新变更级证据。
- Embedded 测试继续证明普通 validate 不创建 ChangeSet。
- Skill/System Memory/当前仓库流程/官方通用 Memory 契约测试覆盖硬门禁、三类交付证据和多阶段检查。
- 依次执行受影响测试、`npm run typecheck`、`npm test`、`npm run build`、`memsphere validate`、最终内容上的 `memsphere memory change validate` 和 `git diff --check`。

## 向前兼容

结论：不需要向前兼容。

仓库当前没有名称包含 `stable` 的 Git Tag，不存在需求规范定义的稳定 checkpoint。实现仍保留两个 validate 命令入口、现有退出码和 JSON 字段，并保持 `--memory-root` 无 Home/Registry/Binding 能力。

## 开发任务

- [x] 启动敏捷需求开发 Run，完成需求契约和实施方案多角色评审。
- [x] 移除普通 validate 的 Managed recovery 隐式写入并增加分模式诊断。
- [x] 为 Managed edit/delete/rename 增加带 ID 的变更级校验提示。
- [x] 前置 Skill 硬门禁并同步 framework System Memory 源与 Project 副本。
- [x] 修订当前仓库 development/testing/delivery Statements 和 agile Procedure。
- [x] 修订官方 generic agile 与 general development/testing/delivery Memory。
- [x] 增加 CLI、ChangeSet、Skill、System Memory 和流程契约测试。
- [x] 运行针对性测试并修复失败。
- [x] 完成 typecheck、全量测试、build、两级 Memory 校验和 diff 检查。
- [x] 完成多角色实现验收、产品验收和需求归档。
- [x] 创建本轮 Git commit；SHA 记录于对应 Run 产物。

## 验收结果

- 针对性 CLI、ChangeSet、Skill、System Memory、流程契约与 Embedded 历史数据兼容测试通过。
- `npm run typecheck`、`npm run build`、`memsphere validate` 和 `git diff --check` 通过。
- 初轮 Review 发现 Managed recovery 与 checkpoint 元数据的提交顺序缺少失败原子性；已改为“准备新目录 → 可回滚替换 → 原子写元数据 → 清理备份”，并确认元数据原子写在返回异常但实际落盘时不会错误回滚 recovery。
- 增加复制失败、目录安装失败和元数据提交失败三类故障测试，均验证旧 recovery 保持可恢复。
- 第二轮 Review 进一步覆盖回滚 rename 自身失败的双故障窗口；现在聚合错误明确给出旧 recovery 备份路径和被拒绝的新 recovery 路径，且不会清理唯一可恢复副本。
- 增加安装+恢复双失败、元数据提交+恢复双失败两类故障测试，验证诊断路径上的旧/新内容均可读取。
- 第三轮 Review 补充发现元数据失败后首个 `destination -> rejected` rename 失败窗口；现在该分支保留标准路径中的新 recovery 和 `.previous-*` 中的旧 recovery，并以包含两个实际位置及两层原始错误的聚合诊断返回。
- 新增对应故障注入测试，解析诊断位置并验证新旧内容均可读取。
- 第四轮 Review 发现 rejected 清理首次失败后 finally 可能重试成功、使诊断承诺的副本消失；现以显式 `preserveRejected` 状态保证一旦报告保留路径，finally 不再删除该副本。
- 新增瞬时 rejected 清理失败测试，验证删除只尝试一次且诊断路径中的新 recovery 与标准路径中的旧 recovery 均可读取。
- 第五轮 Review 要求诊断区分“无旧 recovery”“旧 recovery 已恢复到标准路径”“旧 recovery 仍在 previous 备份”；现以 `hadPrevious` 与当前状态组合生成只指向实际存在位置的诊断。
- 新增首次 Managed recovery、无旧目录时的提交+清理失败测试，断言不虚构 `.previous-*` 路径且 rejected 新内容可读取；既有旧目录测试同时断言旧内容已恢复到标准路径。
- 最终全量测试共 509 项：508 通过、0 失败、1 项 Windows 平台限定测试跳过。
- 多角色实现验收在第六轮全票通过：研发、测试和架构师均 approve，Runner 已批准；此前各轮阻塞均已修正并增加对应故障回归。
- 最终 Memory 内容已通过当前构建的 `memory change validate`，ChangeSet 为 `change-20260829-083330378z-15dcbfaa`，Store 为 Embedded，内容摘要为 `f57d15c4f8821ec01669114d7397d04ea4d82b538a72d49d7614116c1e21af3d`。
- 兼容性补充：新 ChangeSet 继续强制写入 `store_type`；捕获 Embedded 新变更时忽略无法通过当前 schema、但原始状态已是 `completed` 或 `abandoned` 的历史终态 ChangeSet，损坏的 active 或无法判定状态的记录仍阻断。
