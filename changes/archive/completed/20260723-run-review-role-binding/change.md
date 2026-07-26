---
id: 20260723-run-review-role-binding
type: feature
created: 2026-07-23
run_id: run-20260723-073532z-cfc523f5
completed_at: 2026-07-25
---

# Run 创建期 Review Slot 与 Actor Binding

## 需求

将 Artifact Review 的“评审席位声明”与“具体参与者绑定”拆分到正确的生命周期，并将长期一一配对的 Identity 与 Control Plane Role 合并为 Actor。

Procedure 只负责声明哪些 Artifact 需要 Review，以及需要哪些本地 Review Slot（评审席位）；Procedure 和 Artifact 不再写死 Decision Policy 或项目配置中的参与者。Review Slot 是 Procedure 内部的轻量标签，用于表达“产品、测试、架构”等业务评审视角，不定义票权、Permission、`system_prompt`、Agent 运行参数或继承规则。

项目 `config.json` 使用 Actor 统一描述可参与工作的主体。Actor 合并原 Identity 与 Control Plane Role 的职责，至少包含稳定 id、名称、Human/Agent 类型、Permission 和 `system_prompt`；Agent Actor 还包含 provider、command、model 等运行配置。一个 Actor 就是一位可以被调度和鉴权的实际参与者，不再要求先选择 Role 再选择 Identity。

创建 Run 时，用户为需要 Review 的 Artifact 选择本次 Run 使用的 Decision Policy，再把每个 Review Slot 直接绑定到当前项目配置中的一个或多个 Actor，或明确跳过该 Slot。Actor 的冻结 Permission 决定其在 Review 中只能提供建议，还是拥有正式决策票；Procedure 不参与这一判断。

映射结果属于 Run 实例配置。Run 创建后必须冻结本次使用的 Review Slot、Actor、Permission、Binding、Decision Policy 和来源证据，后续配置或 Memory 变化不得静默改变运行中的 Review。这样同一 Procedure 可以跨项目、团队和环境复用，不再依赖 `product_manager`、`traex1`、`human` 等本地配置 id。

未绑定 Slot 会从本次 Run 的 Review 参与范围中移除：部分 Slot 未绑定时，由剩余 Slot 完成 Review；某个 Artifact 的全部 Review Slot 均未绑定时，该 Artifact 不创建 Review 并按普通 Artifact 继续。系统必须在 Run 创建前清楚展示这一降级结果，并要求用户显式确认，不得因遗漏参数或配置错误静默减少 Review。

## 需求背景

当前 Artifact Review 控制面仍处于高速迭代和内部验证阶段，旧 Identity/Role/`role_bindings` 方案几乎没有外部使用方或必须保留的数据。为了避免把尚未稳定的设计固化成长期兼容负担，本需求允许直接废弃旧方案：

- 不提供旧 Memory、旧 Control Plane 配置或旧 Run State 的兼容读取。
- 不开发自动 migrate 命令或适配层。
- 仓库内预置 Memory、测试 fixture 和当前开发配置直接一次性改成新模型。
- 旧 Run 可以从 View 和 CLI 中消失；需要保留的内容由开发环境在切换前自行导出，不进入产品能力。

## 用户场景

- 用户启动一个声明了产品、研发、测试和架构 Review Slot 的通用 Procedure，系统先列出这些 Slot，再由用户为本次 Run 选择 Decision Policy，并为每个 Slot 选择 Actor。
- 同一 Procedure 在不同 worktree、项目或团队中启动时，可以绑定不同 Human/Agent Actor，不需要复制或修改 Procedure YAML。
- 用户可以显式跳过当前环境暂时没有参与者的 Slot；启动预检会展示哪些 Review 将减少参与者、哪些 Review 将被完全跳过。
- 一个 Slot 可以绑定多个 Actor；一个 Actor 也可以承担多个 Slot。Run 和 View 能说明每个 Assignment 来自哪些 Slot 和 Run Binding。
- 同一 Actor 承担多个 Slot 时仍是同一位参与者，其意见和票不能被重复计为多个独立参与者，但必须保留全部 Slot 来源，便于解释其评审视角。
- Procedure 通过 `!call` 使用子 Procedure 时，根 Run 创建阶段尽可能汇总全部可达 Review Slot，避免运行到中途才发现缺少参与者。

## 范围

- 调整 Memory YAML 的 Review 控制面语法：
  - Procedure/Artifact 只声明 Artifact 需要 Review、参与 Review 的本地 Slot 和现有 Artifact 契约。
  - Actor Binding 不再保存在 Procedure 或 Artifact Memory 中。
  - Decision Policy 不再保存在 Procedure 或 Artifact Memory 中，由 Run 创建期选择。
  - Review Slot 使用 Procedure 本地标签；Memory validate 只校验语法、唯一性和引用关系，不要求 Slot 对应当前项目的 Actor。
- 将配置控制面的 Identity 与 Role 合并为 Actor：
  - Actor 同时承载参与者身份、Human/Agent 类型、Permission、`system_prompt` 和 Agent 运行配置。
  - Permission 和 Decision Policy 仍由系统稳定定义，Actor 只引用系统支持的 Permission。
  - `runner` 继续由当前 Run 执行上下文隐式承担，不进入人工 Binding 列表；Runner 的 Actor/Permission 表达由技术方案与现有行为对齐。
- 增加 Run 创建前的 Binding 预检：
  - 收集根 Procedure 和全部静态可达子 Procedure 中使用的 Review Slot。
  - 展示需要 Review 的 Artifact、系统支持的 Decision Policy、每个 Slot 的可选 Actor、Actor 的权限能力，以及绑定或跳过后的实际 Review 结果。
  - 未选择 Decision Policy，或未对每个 Slot 作出“绑定”或“显式跳过”选择时，不创建正式 Run。
- 支持在 CLI 创建 Run 时提交 Slot Binding：
  - 每个 Slot 可绑定一个或多个 Actor。
  - 支持显式跳过 Slot，并区分“用户主动跳过”与“参数遗漏、Actor 不存在、Actor 能力不兼容”等错误。
  - 具体参数形式和是否提供 bindings 文件由技术方案确定。
- Run 创建必须原子完成：
  - 预检不留下半初始化、可误执行的 Run。
  - 全部选择确认后一次性创建 Run，并冻结 Review Slot、Actor 与 Run Binding 快照。
  - `runner` 继续由当前 Run 执行上下文隐式承担，不进入人工绑定列表。
- Review 运行时根据 Run Binding 创建 Assignment：
  - 未绑定 Slot 不创建 Assignment。
  - Artifact 仍有绑定 Reviewer 时，按剩余 Slot 和 Actor 执行 Review。
  - 同一 Actor 承担同一 Review 的多个 Slot 时合并为一个 Assignment、一份 Vote，保留全部 Slot 来源并合并其有效授权。
  - Artifact 的全部 Review Slot 均未绑定时，不创建 Review，记录可审计的跳过原因并继续 Run。
  - 存在 Reviewer 但其冻结 Permission 与所选 Decision Policy 无法形成合法结论时，必须在创建 Run 前拒绝并解释，不得产生永久等待的 Review。
- `!call` 使用同一 Run 的 Binding；Review Slot 按 `Procedure + Slot` 唯一标识，避免父子 Procedure 的同名 Slot 被意外合并。
- 更新 Run/View 展示，使用户能够查看本次 Run 的 Slot、Actor Binding、Decision Policy、实际权限、显式跳过项、来源和受影响 Review。
- 更新预置 Procedure，移除 `traex1`、`traex2`、`traex3`、`traex4`、`human` 等具体参与者 Binding。
- 旧 `role_bindings`、Identity/Role 配置和 Artifact 级 `permission_grants` 直接退出当前语法与运行时；仓库内使用点一次性改写，不提供产品化迁移。
- 删除 Artifact 的 `review_role` 和 `review_requires`：
  - Reviewer 的通用职责是根据当前 Artifact 与冻结要求，按需向前追溯当前 Run 中已经产生的 Artifact，而不是依赖 Procedure 手工分类证据。
  - 每次 Review 自动冻结当前候选之前已经上报的全部 Artifact，形成按步骤和 Artifact 名称组织的只读上下文。
  - ACP Prompt 只提供尽量短的前序 Artifact 索引，完整内容由 Reviewer 使用 Run/Artifact 查询命令按需读取。
  - 涉及代码时，Reviewer 可以检查 Workspace 中的实际代码、Diff 和测试；该能力与前序 Artifact 上下文相互独立。
  - Runner 不再按 `implementation`、`validation` 等人工证据分类阻止投票，仍按冻结契约、blocking 意见处置和 Decision Policy 决策。

## 验收标准

1. 一个 Procedure 可以声明某个 Artifact 需要 Review 及其本地 Review Slot，但其 YAML 中不包含 Decision Policy 或任何 Actor id；在两套 Actor 配置不同的项目中均能 validate 并进入 Run Binding 预检。
2. `config.json` 可以用一个 Actor 完整表达一位 Human 或 Agent 参与者及其名称、Permission、`system_prompt` 和必要运行配置；新运行时不再要求 Identity 与 Role 配对。
3. 启动含 Review Slot 的 Procedure 且未提供完整 Run Review 配置时，不创建正式 Run；CLI 返回待选择 Decision Policy 的 Artifact、全部待处理 Slot、可选 Actor、Actor 权限和下一步可执行操作。
4. 用户为全部 Slot 明确选择 Actor 或跳过后，Run 一次性创建成功；Run 快照完整记录 Slot、Actor、Permission、Binding、Decision Policy、来源和显式跳过项。
5. 同一 Slot 绑定多个 Actor 时，每个 Actor 获得独立 Assignment；同一 Actor 承担多个 Slot 时只获得一个 Assignment、提交一份 Vote，系统保留全部 Slot 依据且 Decision Policy 只将该 Actor 计为一个参与者。
6. Actor 的冻结 Permission 决定其建议票或决策票资格；绑定完成后若参与者权限无法满足所选 Decision Policy，预检展示原因并拒绝创建 Run，不能用运行时永久等待替代创建期校验。
7. 部分 Slot 被跳过时，只为剩余绑定创建 Assignment；View、CLI 进度和 Review Evidence 均不显示虚假的缺席 Assignment。
8. 某 Artifact 的全部 Review Slot 均被显式跳过时，`run report` 不创建 Review，记录“本次 Run 无已绑定 Reviewer”或等价可审计原因，并按普通 Artifact 推进。
9. 参数遗漏、未知 Actor、Actor 重复、Actor 能力不兼容、非法 Runner Binding 与显式跳过具有不同诊断；错误不会被当作跳过处理。
10. 绑定后如果剩余参与者与 Runner 无法满足当前 Decision Policy 的决策要求，Run 创建被拒绝，并明确指出缺少哪类决策能力。
11. Run 创建后修改 `config.json`、Procedure 或 Artifact 的 Slot 声明，不改变已冻结的 Binding 和后续 Assignment。
12. 根 Procedure 静态调用子 Procedure 时，预检会联合展示子 Procedure 所需 Slot；父子 Procedure 的同名 Slot 独立标识，进入子 Procedure 后不重复询问已处理的 Slot。
13. 不含 Review 的 Procedure 保持现有一条命令直接启动行为，不出现无意义的 Binding 预检。
14. 旧 `role_bindings`、Identity/Role 配置和旧 Run State 不再被新运行时接受；错误明确指出当前模型已废弃，但不提供 migrate 命令或兼容执行路径。
15. 预置敏捷需求开发流程不再引用具体 Actor，同一份安装副本可以由不同项目在 Run 创建时选择自己的产品、研发、测试和架构参与者。
16. 自动化测试覆盖无 Review、完整绑定、部分跳过、全部跳过、多人绑定、同 Actor 多 Slot、Slot 能力不兼容、子 Procedure、无决策能力和快照冻结。
17. `review_role` 和 `review_requires` 不再是合法 Artifact 关键字；新 Review 自动冻结当前候选之前已经上报的全部 Artifact，前序 Artifact 无需额外标记即可在 Agent CLI 与 Human View 中按需读取。
18. ACP Reviewer Prompt 明确当前 Artifact 不是唯一上下文，提供简短的前序 Artifact 索引，并在命令集合中提供按 Run + Step 查询 Artifact 的命令；Prompt 不要求机械阅读全部前序内容，也不要求 Reviewer 额外汇报阅读清单。

## 不做事项

- 不把 Actor 或 Permission 配置混入 Procedure；Review Slot 不复制 Actor 定义。
- 不允许运行中的 Run 随意重新绑定 Actor；中途增补或替换参与者如有需要，另行定义受权限控制的变更流程。
- 不改变 Comment、Vote、Review Round、Runner Vote 或 Decision Policy 的既有业务语义。
- 不在本需求中增加新的 Decision Policy。
- 不把某个团队的默认 Binding 写回 System Memory、Reserved Memory 或通用 Procedure。
- 不以隐式猜测、Slot/Actor 名称相似度或历史 Run 自动选择 Actor。
- 不提供旧 Memory、Identity/Role 配置或旧 Run 数据结构的兼容、迁移和自动修复；`runStateVersion` 仍保持 v3。

# Syntax 关键字变更

- 新增关键字：无。
- 删除 `!artifact.review_role`：不再由 Procedure 作者为 Artifact 指定 Review evidence 类别。
- 删除 `!artifact.review_requires`：不再由 Procedure 作者声明当前 Review 必须包含哪些人工分类的 evidence。
- 除本章节明确列出的删除项外，本轮不得自主增加、重命名或扩展任何 Syntax 关键字。

## 关联需求

- 无重复需求。
- 强关联：`20260720-artifact-review-control-plane`。本需求修正其“Memory 持有 Identity Binding”以及 Identity/Role 双层模型的已交付边界，复用 Permission、鉴权和 Snapshot 能力。
- 强关联：`20260720-artifact-review-human-loop` 与 `20260720-artifact-review-agent-acp`。Human/Agent Assignment 改为消费 Run 创建期冻结的 Binding。
- `20260720-artifact-review-compatibility-hardening` 不约束本次旧控制面模型；Human 已确认该模型尚未形成兼容承诺，可直接废弃。
- 相关：`20260722-view-config-management`。Actor 定义由配置面板管理；Run Binding 选择属于 Run 启动体验，不属于静态配置编辑。
- 相关：`20260723-artifact-review-agent-dispatch-runtime`。Dispatcher 消费已经创建的 Agent Assignment，不负责决定 Role Binding。

## 技术与测试方案

### YAML 与 Syntax

- 沿用当前 `memsphere-20260721-stable`，不发布新 syntax。本轮处于控制面模型尚未形成兼容承诺的早期阶段，直接在当前 syntax 内删除 `!procedure.role_bindings`、`!artifact.role_bindings`、`!artifact.permission_grants` 以及 `review: <policy-id>` 旧语义。
- 同步修订 `Memsphere YAML 语法规则`：稳定且已形成兼容承诺的语法发生不兼容变化时仍必须升版；尚未形成兼容承诺的当前开发版本，经 Human 明确确认后允许原地纠正规则，不要求为内部废弃模型制造新版本或 migration。
- 新 `!artifact.review` 是非空、去重的 Review Slot 字符串数组。省略表示该 Artifact 不进入 Review：

```yaml
artifact: !artifact
  name: 需求契约
  format: markdown
  review:
    - 产品
    - 资深架构
```

- Slot 仅按当前 Procedure 的规范名称与 Slot 文本组成稳定 key：`<procedure-name>::<slot>`。Artifact Review scope 继续使用 `<procedure-name>#<step-id>`。
- `!call` 目标当前均为静态字符串，启动预检遍历 `procedureSnapshots` 即可收集完整调用图；父子 Procedure 的同名 Slot 使用不同 key。

### Actor 配置

- `control_plane` 改为 `runner + actors`：

```json
{
  "control_plane": {
    "runner": {
      "permissions": ["artifact.read", "artifact.submit", "artifact.write", "decision.decide"],
      "grantable_permissions": []
    },
    "actors": {
      "traex1": {
        "name": "产品",
        "kind": "agent",
        "permissions": ["artifact.read", "decision.assess"],
        "grantable_permissions": [],
        "system_prompt": "关注用户价值、范围和验收标准。",
        "agent": {
          "provider": "traex",
          "command": "traex",
          "args": ["acp"],
          "model": "gpt-5.5"
        }
      },
      "human": {
        "name": "资深架构",
        "kind": "human",
        "permissions": ["artifact.read", "decision.assess", "decision.decide"],
        "grantable_permissions": []
      }
    }
  }
}
```

- Runner 是当前 Run 上下文，不是可绑定 Actor；`control_plane.runner` 只保存其权限上限。
- Actor 合并旧 Identity 和 Role 字段。Agent 运行配置与身份字段共存，Permission 与 `system_prompt` 不再通过另一层 Role 间接获得。

### Run 创建协议

- `memsphere run start <procedure>` 对含 Review 的 Procedure 先执行无副作用预检，不创建 Run、不写临时 Run：
  - 输出每个 Review scope、可选 Decision Policy、每个 Slot、可选 Actor、Actor 权限和受影响 Artifact。
  - 同时输出可填写的 Review 配置 JSON 示例和下一条命令。
- 用户填写后执行：

```bash
memsphere run start "<procedure>" --review-config <path>
```

- Review 配置按 Review scope 选择 Policy，按 Slot scope 绑定或跳过：

```json
{
  "reviews": {
    "敏捷需求开发流程#flow[1]": {
      "policy": "artifact_acceptance.unanimous",
      "permission_grants": {}
    }
  },
  "slots": {
    "敏捷需求开发流程::产品": { "actors": ["traex1"] },
    "敏捷需求开发流程::资深架构": { "actors": ["human"] }
  }
}
```

- 显式跳过使用 `{ "skip": true }`，不以缺字段或空数组表示。所有 Review scope 必须选择 Policy，所有 Slot 必须绑定或显式跳过。
- `permission_grants` 从 Memory 移到单个 Run Review scope，key 改为 Actor id，且不得越过 Actor 的 `grantable_permissions`。
- 完整配置通过校验后，`startRun` 一次性写入 Run v3；任一错误都不留下 Run。
- 不含 Review 的 Procedure 继续直接创建 Run，不要求 Review 配置。

### Run State 与 Review

- Run v3 冻结 Actor catalog、Runner 权限、Review Policy、Slot Binding、显式跳过和每个 Review scope 的 Permission Grant；本轮不递增 `runStateVersion`。
- 编译后的 Step 只保留 Review Slot，不再携带 Memory 中的 Policy、Role Binding 或 Permission Grant。
- 创建 Review 时按 Slot Binding 汇总 Actor；同一 Actor 多 Slot 合并为一个 Assignment、一份 Vote，保留 `slotIds` 作为来源。
- Assignment 的建议票或决策票由冻结后的 Actor 有效 Permission 决定；若 Review 至少保留一名 Actor，但 Actor 与 Runner 无法满足 Policy，创建 Run 前拒绝。
- 全部 Slot 显式跳过时在 Run 快照记录原因，`report` 通过确定性校验后直接接纳 Artifact。
- Review Submission 自动冻结当前候选之前已经接纳的全部 Run Artifact；上下文项只按 `stepId`、Artifact 名称和原始 Artifact 快照组织，不再存储 evidence role 或 required evidence 状态。
- Runner approve 不再校验人工 evidence 分类是否齐全；当前候选、冻结契约、前序 Artifact 索引和 Workspace 调查能力共同组成 Reviewer 的上下文。
- View 首轮提供创建后只读展示：Review scope、Policy、Slot → Actor、权限与跳过项；完整 Run 启动向导留给配置管理需求复用同一预检接口。

### Reviewer Prompt 与上下文

- ACP Prompt 固定说明：Reviewer 可以根据当前 Artifact 与要求，向前追溯当前 Run 中已经产生的 Artifact，不要只依据当前 Artifact 作出结论；涉及代码时，还可以检查 Workspace 中的实际代码、Diff 和测试。
- Prompt 自动列出当前候选之前的 Artifact，格式保持为短行 `<step-ref> <artifact-name>`，不内嵌正文、分类或 required 状态。
- Available Memsphere commands 增加按 `run + step` 查看前序 Artifact 的 `run artifact show` 命令；现有 `run show` 继续提供步骤和 Artifact 摘要。
- Human View 使用同一固定模型：材料选择器展示当前候选、冻结契约和按时间组织的全部前序 Artifact，不因 Procedure 配置变化而改变上下文模型。

### 废弃边界

- `memsphere-20260721-stable` 仍是唯一受支持的当前 syntax；不创建新 syntax，也不注册 migration step。
- parser 与 config schema 直接拒绝旧 `role_bindings`、`review_role`、`review_requires` 和 Identity/Role 配置；Run State 在 v3 内直接采用新结构，不建设旧结构 adapter。
- Reserved Memory、当前安装副本、预置 Procedure、开发配置和测试 fixture 在代码切换时一次性手工改写。
- 旧 Run 不要求继续出现在 CLI/View；本次自举开发 Run 使用切换前保留的 CLI 完成流程，不把临时手段写入产品代码。

### 验证方案

- Memory：覆盖新 `review` Slot 数组、非法空值/重复值、旧字段拒绝和 serializer。
- Config：覆盖 Actor Human/Agent、Runner、Permission、Grant 上限和旧 Identity/Role 字段拒绝。
- Run：覆盖无 Review 直接启动、预检不落盘、完整配置原子创建、遗漏/未知/跳过、子 Procedure Slot、快照冻结和 v3 新结构解析。
- Review：覆盖同 Actor 多 Slot 去重、多 Actor、建议/决策票资格、Policy 不可满足、全部 Slot 跳过和 per-review Actor Grant。
- Review 上下文：覆盖自动冻结全部前序 Artifact、简短索引、按 Run + Step 查询、无前序 Artifact，以及 Runner 不再依赖人工 evidence 分类。
- View：覆盖 Run/Review 中 Policy、Slot、Actor、权限和跳过项只读展示。
- 交付前执行受影响测试、`npm run typecheck`、`npm test`、`npm run build`、`memsphere init`、`memsphere validate`。

## 开发任务

1. 在当前 syntax 内更新 AST/schema/serializer，更新 Reserved Memory、manifest、Skill 与预置 Procedure。
2. 实现 `runner + actors` 配置模型、快照与鉴权。
3. 实现 Review scope/Slot 收集、无副作用预检、Review 配置解析和 `run start --review-config` 原子创建。
4. 在 Run v3 内实现 Slot/Actor 快照和 Permission Grant 下移，删除旧数据结构运行路径。
5. 改造 Artifact Review Assignment、授权、ACP Prompt/Session 和证据模型为 Actor + Slot。
6. 更新 CLI 输出与 View 只读展示，移除 Role/Identity 双层文案。
7. 一次性改写预置敏捷需求开发流程、当前开发配置和测试 fixture，刷新当前工程安装副本。
8. 完成针对性、全量、构建、初始化和 Memory validate，并保存验证证据。
9. 删除 `review_role`、`review_requires` 及其 evidence 分类模型，改为自动冻结和展示全部前序 Artifact；同步 ACP Prompt、CLI、View、系统记忆与当前开发 Run 快照。

## 验收结果

- 关联敏捷开发 Run `run-20260723-073532z-cfc523f5` 已完成，最终状态为 `done`。
- 实现已由提交 `bfb6f57 feat: bind review slots at run start` 交付：Procedure Review Slot 与 Actor 解耦，Run 创建期完成 Policy 和 Slot Binding 预检并冻结到 Run v3。
- 当前代码已使用 `runner + actors` 控制面，预置敏捷流程只声明 Review Slot；旧 Identity/Role Binding、`review_role` 和 `review_requires` 已退出当前运行路径。
- 2026-07-25 归档复核执行 `npm test`，318 项全部通过；`npm run typecheck` 与 `npm run build` 均通过。
- 提需方已完成该需求的功能验收并要求创建提交；不存在阻止归档的已知问题。
