---
id: 20260824-tutorial-onboarding-restructure
status: doing
type: feature
created: 2026-08-24
run_id: run-20260824-112234z-cc114a0a
---

# Memsphere 内置语义与教学第一、二章重构

## 需求

merge 后的 README 将 Memsphere 定位为“AI 时代个性化软件的运行环境”：软件可以从自然语言开始，在真实使用中逐步生长为可复用、可验证、可管理、可持续演化的资产。Memsphere 不是另一个 Agent，而是运行在不同通用 Agent 之上，为个性化软件提供相对稳定的语言、运行环境和资产管理方式。

README 同时定义了从 Prompt 到 Skill、再到 Memsphere 的适用边界，规划 Memory、个性化 CLI、数据和界面四类协作资产，并把 Token 算力与确定性算力协同作为软件持续演化方向。当前版本首先实现 Memory，并提供 Project、Run、Artifact、Review、ChangeSet、View 和 Skill 接入作为第一块地基。

当前 bundled System Memory 与 Skill 仍主要把 Memsphere 描述为维护、检索和遵循 Memory 的框架。这个描述没有覆盖新版产品定位，也无法支持教学流程在答疑时依据 Memory 准确解释个性化软件、四类资产、两种算力及“当前能力与未来方向”的边界。因此，本需求不能只重写教学文案，还必须审计全部内置 Memory，并修改所有承载产品身份、Memory 定位、Agent 入口或教学语义的内容，使 README、System Memory、Skill 和两章教学使用同一套产品定义。

本需求确立教学流程的渐进式重构方向，并交付“memsphere 教学流程-第一章”和“memsphere 教学流程-第二章”的重构。第一章帮助首次使用者从一个真实需求理解个性化软件如何开始生长，判断需求适合 Prompt、Skill 还是 Memsphere，理解完整愿景和当前能力，并在当前教学 Run 和 View 中观察一次实际执行。第二章承接第一章给出的个性化软件起点，让用户把一次真实经验沉淀为候选 Memory，通过 ChangeSet、校验和候选 Run 验证形成第一次可控演化闭环。

当前迭代不建设第三章或第四章。实施必须分阶段进行：先完成并验收第一章，再开始重构和验收第二章；不得为了同时推进两章而削弱第一章质量。第二章完成前，第一章不得主动把用户导向仍未可用的第二章；第二章完成后才可以恢复两章之间的正式学习入口。第二章不得继续把用户导向尚不存在的第三章或第四章。

## 目标与设计决策

- README 是本轮 Memsphere 产品定位的事实基线；System Memory 和 Skill 可以补充当前实现细节，但不得缩窄、替换或误读 README 的产品定义。
- “全部内置 Memory”表示 manifest 中每一份 System Memory 都必须逐份审计并留下结论；所有受新版定位影响的 Memory 必须修改，纯结构、语法或执行契约在确认没有产品身份陈述后可以保持内容不变，不进行无语义价值的机械改写。
- 新增独立 Concept `memsphere-personalized-software`，稳定定义个性化软件、Prompt/Skill/Memsphere 边界、四类软件资产及当前与未来的关系；`memsphere-framework` 引用并落实 Memsphere 在 Agent/LLM 之上的运行环境与资产管理职责。
- 第一章的首要成功标准是用户理解自己为什么需要或不需要 Memsphere，并完成一次可观察的当前版本入门闭环，而不是听完全部术语。
- 使用 README 的“个人研究助手”作为贯穿案例，并允许 Human 提供自己的重复需求替代案例；四类 Memory 不再组织成四段必经的独立问答课程。
- 直接利用当前教学 Procedure 自身的 Run 作为实践对象，让用户在 View 中找到本次 Run、当前步骤和已产生的 Artifact；第一章不额外创建练习 Procedure 或额外 Run。
- 准入检查区分 Managed 与 Embedded Project。共同检查 Node.js、Git、CLI、Skill、Primary Project Binding、当前 Project、`memsphere validate` 和 View；按 README 只解释“Memory 是否跟随代码仓库”这一首要选择。`project repair` 只在实际 System Memory 故障排查时按适用 Memory 处理，不作为第一章必经教学。
- 第一章必须明确区分完整方向和当前版本：Memory、个性化 CLI、数据和界面是完整软件资产模型；当前版本首先实现 Memory，不能把 Memsphere 管理 CLI 或通用 View 表述为个性化 CLI、数据与界面已经成为完整的一等资产。
- 第一章只建立完成入门所需的最小心智模型。Mounted Project、完整 ChangeSet 生命周期、候选 ChangeSet Run、Artifact Review、ACP Provider、运行期 Slot 换绑、Run abandonment 与 Archive 等内容不进入第一章主线。
- 保留自由讨论能力，但减少为了推进目录而设置的机械确认。Human 仍可在任一阶段提问，Agent 必须读取当前 Memory 后回答；不再要求每一个名词都单独进入 `while`。
- 第一章结束时提供已完成内容、仍有疑问和可立即使用的下一步建议；在第二章完成重构前，不输出“请启动第二章”的行动指令。
- 第二章不沿用当前以 Artifact Review、评审席位和参与者配置为主的课程结构，而是围绕“真实经验 → Memory 候选 → ChangeSet → validate → 候选 Run → Human 决定是否发布”建立第一次可验证的个性化软件演化闭环；Artifact Review 与参与者配置移至后续章节方向。
- 第一、二章按两个独立里程碑实施和验收。第一章通过后才能开始第二章；第二章不得反向扩张第一章的最小心智模型。

## 当前迭代范围

- 新增并安装 `memsphere-personalized-software` Concept，定义个性化软件及其资产生长模型。
- 更新 `memsphere-framework`、`memsphere-memory` 及其他受影响的 Concept，使 Memsphere、Memory 和四类 Memory 在新版产品模型中的位置一致。
- 逐份审计 manifest 中全部内置 Concept、Statement、Schema 和 Procedure，形成内置 Memory 影响矩阵；修改所有有冲突、遗漏或会误导 Agent 的内容，记录无需修改项的理由。
- 同步更新 Memsphere Skill 的源码摘要，使 Agent 的入口说明不再把 Memsphere 缩窄为纯 Memory 框架。
- 重写 `memsphere-tutorial-chapter-01` 的 `defines`、`goals`、全局约束和 `flow`，形成短而完整的首次使用路径。
- 第一章主线包含以下阶段：
  1. 环境与 Project 准入。
  2. Prompt、Skill 与 Memsphere 的定位及 Human 真实场景。
  3. Memory、个性化 CLI、数据与界面的软件生长模型，以及两种算力协同。
  4. 当前版本能力、四类 Memory 和 Managed/Embedded Project。
  5. 在 View 中观察当前教学 Run、Action 和 Artifact。
  6. 生成适合 Human 当前场景的个人软件起点建议。
- 第一章纯教学 Human checkpoint 不超过 4 个，分别用于真实场景、软件生长模型、当前能力和 View 实践；环境授权或排障不计入。
- 重写 `memsphere-tutorial-chapter-02` 的 `defines`、`goals`、全局约束和 `flow`，从当前 Artifact Review/参与者配置课程调整为第一次经验沉淀与验证课程。
- 第二章主线至少包含以下阶段：
  1. 复核第一章产出的真实场景与个性化软件起点；没有可用输入时帮助 Human 选择一条真实、低风险、可验证的经验。
  2. 判断经验应沉淀为 Concept、Statement、Schema 还是 Procedure，并解释选择依据。
  3. 通过适用的 Memory 编辑流程创建候选内容和 ChangeSet，不直接覆盖已发布 Memory。
  4. 运行 `memsphere memory change validate`，根据诊断修正候选内容。
  5. 使用 `memsphere run start --change` 对候选 Memory 进行一次真实但低风险的试跑，观察 Run 与 Artifact。
  6. 汇总验证证据、风险和差异，由 Human 明确决定发布、继续修改或保留候选，不替 Human 自动发布。
- 第二章的写操作必须限定在 Human 已确认的目标 Memory/ChangeSet；不得修改 System Memory，不得用虚构练习替代 Human 的真实经验，不得把候选验证等同于发布。
- 同步修改 bundled `reserved-memory`、当前工程 `.memsphere/memory`、manifest 与相关安装/repair 测试，保持 System Memory 身份、路径和内容一致。
- 更新或补充针对第一、二章教学契约的自动化测试，避免后续产品迭代再次把课程退化为过长的功能目录、破坏真实演化闭环或产生后续章节断链。
- 如两章相关 README 入口或测试断言因新教学契约需要调整，可在本 Change 内同步修改；不扩展 README 为完整教程。

## 验收标准

1. `memsphere-tutorial-chapter-01` 仍保留 canonical name `memsphere-tutorial-chapter-01` 和别名“memsphere 教学流程-第一章”，现有 README 启动语句继续可以唯一解析并启动该 Procedure。
2. 新增 bundled Concept `memsphere-personalized-software`，其定义至少覆盖：个性化软件可以服务个人、团队、组织或行业；从自然语言开始并在使用中持续演化；Prompt、Skill、Memsphere 的适用边界；Memory、个性化 CLI、数据和界面四类资产；当前版本与未来方向的边界。
3. `memsphere-framework` 明确说明 Memsphere 不是 Agent，而是运行在通用 Agent 之上的个性化软件运行环境和资产管理层；它引用或一致应用“个性化软件”Concept，并保留仍然有效的当前实现细节。
4. `memsphere-memory` 明确说明 Memory 是 Agent 进入个性化软件的入口，是当前版本首先实现的语义资产，不等同于完整的 Memsphere 或完整软件；Concept、Statement、Schema、Procedure 的现有语法和职责保持准确。
5. manifest 中每一份 bundled System Memory 都出现在影响矩阵中，并被标记为“修改”或“无需修改”；修改项说明与新版定位的关系，无需修改项说明其纯结构、语法或执行契约为何不受影响。验收不得以文件是否产生 diff 代替逐份审计。
6. 全部 bundled System Memory、工程 Memory 和 Skill 不得再把“维护、检索和遵循 Memory 的框架”作为对 Memsphere 的完整定义；不得把规划中的个性化 CLI、数据或界面表述为当前已经完整实现。
7. 第一章准入实际检查 Node.js、Git、CLI、Skill、Primary Project、Project 类型、`memsphere validate` 和可访问的 View；Windows 专项只在 Windows 出现，`project repair` 不作为必经教学。
8. 第一章让 Human 基于一个真实需求判断 Prompt、Skill 或 Memsphere 是否适用，并明确 Memsphere 与通用 Agent、LLM 和硬件的层次关系；即使结论是不需要 Memsphere，也视为有效教学结果。
9. 第一章使用“个人研究助手”或 Human 真实场景解释四类软件资产、两个入口、数据公共底座和 Token/确定性算力协同；明确软件不要求第一天拥有全部资产。
10. 第一章一次性说明 Concept、Statement、Schema 和 Procedure 的职责与协作，明确当前版本还提供 Project、Run、Artifact、Review、ChangeSet、View 和 Skill 接入，并严格区分这些当前能力与完整资产愿景。
11. Human 能通过实际 View 地址打开当前 Project，按本次 Run 的用户可读名称找到教学 Run，并观察当前步骤和至少一份已上报 Artifact；教学内容正确区分 Procedure 名称、Run 名称和 Run ID。
12. 第一章主线不实际执行 Memory edit/publish、ChangeSet 处理、Artifact Review、Provider 配置、运行期换绑、Run abandon 或 Archive；Human 主动提问时可以基于当前 Memory 回答，但不得把相关专题重新变成必经步骤。
13. 第一章中用于纯教学导航的 Human 学习选择 Action 不超过 4 个；环境授权、必须由 Human 完成的外部操作和用户主动提问不计入该数量。
14. 第一章最终产物按 Human 的真实场景给出 Prompt、Skill 或 Memsphere 起点建议；适合 Memsphere 时说明最先需要的 Memory、第一条 Procedure 驱动请求，以及未来可能生长的 CLI、数据和界面；不把未来能力冒充当前交付。
15. 第一章完成而第二章尚未完成时，不要求或推荐用户启动第二章；第二章可用后，第一章只提供可选的第二章入口，不把继续学习设为完成第一章的条件。
16. `memsphere-tutorial-chapter-02` 保留 canonical name `memsphere-tutorial-chapter-02` 和别名“memsphere 教学流程-第二章”，但其目标和主线改为第一次真实经验沉淀与候选 Memory 验证，不再以 Artifact Review、评审席位、ACP Provider 或参与者配置为主线。
17. 第二章必须基于 Human 的真实经验选择正确 Memory 类型，通过受控编辑流程产生 ChangeSet，完成 validate 和 `run start --change` 候选试跑，并正确区分候选内容、已发布 Memory、普通 Run 与候选 ChangeSet Run。
18. 第二章发布、继续修改或保留候选的最终选择由 Human 明确作出；Agent 不得未经确认发布或覆盖 Memory。第二章结束时汇总产物、验证证据、未解决风险和 Human 决定，且不推荐不存在的第三章或第四章。
19. bundled `reserved-memory`、`.memsphere/memory`、manifest 和 Skill 源码保持一致，Managed `project repair` 可以为现有 Project 安装新增 System Memory 并更新受影响内容，不修改用户 Memory。
20. 测试覆盖新增 Concept 的 canonical identity/alias、manifest 安装、全部内置 Memory 影响矩阵、README/System Memory/Skill 核心定位一致性、第一章主线阶段和 Human checkpoint 上限，以及第二章 Memory 类型判断、ChangeSet、validate、候选 Run、Human 发布决策和后续章节断链保护。
21. `memsphere validate`、`npm run typecheck`、相关定向测试、`npm test`、`npm run build` 和 `git diff --check` 全部通过；如存在平台限定跳过项，验收记录必须说明。
22. 分别通过一次真实启动的第一章 Run 和第二章 Run 进行人工体验验收：第一章可完成准入、定位判断、软件生长模型、当前能力、View 实践和个人起点建议；第二章可完成真实经验选择、候选 Memory 构建、校验、候选试跑和 Human 决策；两章均无循环卡死、无意义重复、产品边界误导或未经授权写操作。

## 不做事项

- 不创建“memsphere 教学流程-第三章”或“memsphere 教学流程-第四章”。
- 不实现个性化 CLI、数据或界面成为一等资产的产品能力；本轮只定义其稳定语义和演进方向。
- 不在第一章发起真实 Artifact Review，不安装或配置 ACP Provider，不配置 Human/Agent Reviewer。
- 不在第一章创建、发布或废弃用户 Memory，也不为了教学创建额外 Procedure、ChangeSet 或 Run。
- 不在第二章教授或配置 Artifact Review、评审席位、ACP Provider、Human/Agent 参与者；这些内容保留为后续章节主题。
- 不在第二章使用纯虚构练习替代 Human 的真实经验，也不未经 Human 明确决定自动发布候选 Memory。
- 不修改 Project、ChangeSet、Run、Artifact Review、View 或配置中心的产品实现。
- 不为了制造 diff 而给纯结构 Schema、YAML 语法或无产品身份陈述的执行 Procedure 添加无关叙事。
- 不为旧版教学 Run 迁移执行状态；历史 done、abandoned 或 running Run 继续遵循其启动时保存的 Procedure 快照和现有兼容规则。

## 后续演进方向

以下方向只用于维持第二章之后的课程路线一致性，不属于本 Change 的交付承诺：

- 第三章：Artifact 质量与协作。介绍 Artifact/Schema 契约、Review Slot、Actor Binding 和 Decision Policy，并真实完成一次 Human Artifact Review；Agent Reviewer 作为可选增强。
- 第四章或专题教学：ACP Provider、Agent Actor、运行期 Slot 换绑、Mounted Project、System Memory repair、Run abandonment/Archive 和 ChangeSet 冲突处理。

后续章节在实际立项前必须重新核对当时的产品模型，不直接把本文路线图转换成实现任务。

## 向前兼容

结论：不需要向前兼容。

当前仓库不存在名称包含 `stable` 的 Git Tag，因此没有需要从稳定 checkpoint 延续的旧教学流程兼容责任。尽管如此，本需求仍主动保留现有 System Memory 的 canonical name、别名、物理安装路径和两章既有启动入口；新增 Concept 通过 manifest v3 安装，既有 Managed Project 使用受控 `project repair` 升级，用户 Memory 不被覆盖；既有 Run 使用启动时保存的 Procedure 快照，不做迁移。

## 关联需求

- 重复需求：无。
- 强关联已完成需求：
  - `20260817-native-project-memory-lifecycle`：定义 Managed/Embedded Project、Primary Binding 和 System Memory bootstrap。
  - `20260818-view-settings-scope`：定义 Memsphere Home 与 Project 双 Scope 配置归属。
  - `20260819-run-name`：要求单次 Run 使用用户可读名称，并与 Procedure 名称、Run ID 区分。
  - `20260821-system-memory-repair`：提供 Managed Project 的 System Memory repair 入口。
  - `20260822-changeset-experience-loop`、`20260823-changeset-active-lifecycle`：构成本轮第二章候选 Memory 验证闭环的基础。
  - `20260822-run-abandonment`：定义 Run abandoned 与 Archive 分离，后续作为高级教学内容。
  - `20260819-runtime-review-slot-rebinding`：定义运行期 Review Slot 换绑，后续作为高级协作教学内容。

## 技术与测试方案

开发前先形成 manifest 全量内置 Memory 影响矩阵和第一章最终流程草图，再按照同一交付意图更新相关 Memory 并完成第一章实现与验收。第一章通过后，再形成第二章最终流程草图并实施第二章。实现优先修改 bundled `reserved-memory` 源文件，再同步当前工程 Memory 与 Skill 源码；不得只修改安装副本。测试至少包括：

- README、System Memory 与 Skill 的核心产品定位一致性。
- 新增 Concept 的 manifest 安装、Managed repair 与用户 Memory 保护。
- 解析和 `memsphere validate`，确认 Procedure 符合当前稳定 Memory 语法。
- 静态契约测试，确认名称、阶段、愿景/当前边界、Managed/Embedded 分支、Human 学习选择上限及结束语。
- 第二章静态与集成契约测试，确认真实经验输入、Memory 类型判断、受控 ChangeSet 创建、validate、候选 Run、Human 发布决定，以及对不存在后续章节的断链保护。
- Reserved Memory 打包测试，确认 npm package 继续包含新版第一、二章。
- 隔离 Project 中的真实 Run 测试或人工验收，先覆盖第一章的 Managed/Embedded 分支、View 地址和 Run 名称定位，再覆盖第二章的候选 Memory 生命周期与未授权写入保护。
- 全量 TypeScript、构建和回归检查。

若真实 View 教学体验需要浏览器自动化，开发阶段再决定复用现有 Playwright 测试基础设施；当前不预先指定 UI 实现改动。

## 开发任务

- [ ] 建立 manifest 全量内置 Memory 影响矩阵，逐份确认修改或无需修改及原因。
- [ ] 新增“个性化软件”Concept，更新 framework、Memory 和全部受影响的内置 Memory。
- [ ] 同步 Skill 源码、manifest、工程 Memory 与 System Memory 安装/repair 契约。
- [ ] 补充第一章流程草图，确认研究助手/用户场景、Human checkpoint 和每步 Artifact。
- [ ] 重写 bundled 第一章 Procedure，补充第一章教学契约与打包测试。
- [ ] 执行第一章 Managed、Embedded 场景验证和一次真实教学 Run 体验，完成第一章里程碑验收。
- [ ] 第一章通过后，补充第二章流程草图，确认真实经验、Memory 类型、ChangeSet、validate、候选 Run 和 Human 决策边界。
- [ ] 重写 bundled 第二章 Procedure，补充第二章教学契约和候选 Memory 生命周期测试。
- [ ] 执行一次真实第二章 Run 体验，完成第二章里程碑验收。
- [ ] 补充产品定位一致性与 System Memory 测试。
- [ ] 执行完整校验、回归和构建。
- [ ] 整理验收证据并交由需求方确认。

## 验收结果

尚未开始。

## 需求更新记录

- 2026-08-25，Run `run-20260825-052343z-70ecef4f`：依据 merge 后 README，把需求从单独重写第一章扩大为“全部内置 Memory 产品定位一致性 + 第一章重构”；新增个性化软件 Concept、manifest 全量影响审计、Skill 同步和愿景/当前边界要求。状态保持 `todo`，尚未开始实现。
- 2026-08-25，Run `run-20260825-053922z-dbf0ee80`：Human 确认新增独立个性化软件 Concept、全量审计但按实际影响修改、保留 `memsphere-framework` identity；同时把第二章从最小一致性修正扩大为完整重构，并明确先验收第一章、再实施第二章。状态保持 `todo`，尚未开始实现。
- 2026-08-25，Run `run-20260825-055009z-49ece6ad`：启动敏捷需求开发的第一章里程碑，当前迭代范围为全部内置 Memory 产品语义统一与第一章重构；第二章保留为下一独立迭代。产品需求契约已通过，状态更新为 `doing`。
