---
id: 20260720-artifact-review-control-plane
status: done
type: feature
created: 2026-07-20
run_id: run-20260721-024550z-9073bd0f
---

# Artifact Review 控制平面基础

## 需求

为 Artifact Review 建立可独立验证、可被后续运行时复用的控制平面。`.memsphere/config.json` 定义 Identity 与 Role；Permission Catalog 和 Decision Policy Catalog 由系统内置且只增不改；Memory 在 Procedure 与 Artifact 作用域定义 Role Binding，并在 Artifact 作用域定义 Permission Grant。系统负责联合解析、默认拒绝鉴权、配置 revision 和脱敏快照。

本需求是 `20260720-agent-semantic-artifact-validation` Epic 拆分后的第 1 个串行子需求。它只建设控制平面，不触发真实 Review Round。

## 范围

- 扩展 `config.json`，支持：
  - Agent/Human Identity；Agent 只保存原生 Agent 命令与 argv，不保存凭证、环境变量或 Secret。
  - Role：内置 Permission id 集合、可授予 Permission 上限，以及选填静态 `system_prompt`。
  - 保留 `runner` Role；当前 Run 执行上下文隐式承担 Runner，不配置 Identity 或 Binding。
- 提供系统内置 Catalog：
  - Permission：`artifact.read/write/submit` 与 `decision.assess/challenge/decide/override`；每项带版本化的内置自然语言说明。
  - Decision Policy：首期提供 `artifact_acceptance.unanimous`，本轮只注册和查询，不执行决策状态机。
- 扩展 Memsphere YAML：
  - Procedure 级 Role Binding 作为默认绑定。
  - Artifact 级 Role Binding 可按确定规则覆盖同名 Procedure Binding。
  - Artifact 级 Permission Grant 只能从 Role 的 `grantable_permissions` 中临时追加。
  - Action 不允许声明 Role Binding 或 Permission Grant。
  - `!call` 下的 Binding 继承与子 Procedure 默认值具有稳定优先级。
- 提供统一控制平面服务：
  - Identity、Role、内置 Permission/Policy 和 Role Binding 的引用解析。
  - `Binding -> Role -> Permission` 默认拒绝鉴权。
  - 当前 Run 唯一 Runner 与当前 Artifact 多个 Reviewer/Decider 的解析与约束。
  - 把当前有效 Permission、缺失 Permission 和 Role/Grant 来源渲染为参与者可直接理解的自然语言 Guidance。
  - config/Memory 内容 hash 或等价 revision、脱敏不可变 Snapshot。
- `memsphere validate` 联合校验 config 与 Memory，并把问题定位到具体字段路径。
- Run 启动/Action 编译时保存并可通过 `run status` 查看最终解析的脱敏控制平面快照。
- 为后续 Review Loop 提供稳定 TypeScript 接口，不把模型只留在类型声明中。

## 不做事项

- 不创建 Artifact Review Session、Round、Assignment、Vote 或 Comment。
- 不实现 `run review wait`、Human Review View 或 Agent Reviewer ACP 调度。
- 不执行 Challenge、Decision、Override 的运行时状态流转；本需求只提供内置 Policy/Permission 定义与查询。
- 不接管操作系统级文件、进程或网络权限。
- 不提供企业登录、远程身份提供方或 Secret 托管。

## 验收标准

- 合法 `config.json` 可定义 Agent/Human Identity 与 Role；Permission/Decision Policy 只能查询系统内置 Catalog，用户不能定义或覆盖。
- Memory 可在 Procedure/Artifact 作用域声明 Role Binding，在 Artifact 声明 Permission Grant；Action 错放治理字段会被 strict schema 拒绝，`!call`、默认值和覆盖规则具有自动化测试。
- 缺失/重复 Identity、Role，未知 Permission，悬空 Binding，非法 Runner Binding、越权 Grant 与 Agent 凭证/未知字段等情况均被 `memsphere validate` 拒绝并给出精确路径。
- 未绑定 Identity 或 Role 不含目标 Permission 时，鉴权结果为拒绝；允许与拒绝矩阵均有测试，拒绝不会改变 Run 状态。
- Runner 在当前步骤输出中提前看到当前 Artifact 的权限 Guidance；`run report` 成功和拒绝分别说明使用或缺失的 Permission，且自然语言与快照中的有效权限和来源一致。
- Run 启动后修改 config 或 Memory 不会改写已保存 Snapshot；Snapshot 可重建 Identity、Role、Permission、Binding 和 Policy 依据。
- Snapshot 与日志不包含明文凭证、Token、Secret、Agent 环境变量或认证状态；未知字段不得被原样持久化。
- `run status` 或等价只读接口可展示当前 Runner、当前 Artifact 的 Reviewer/Decider Role 解析结果、来源作用域、revision 和自然语言权限说明。
- 现有未使用 Role Binding/Review 的 Memory、Run、validate 和 View 回归保持通过。

## 关联需求

- 父 Epic：`20260720-agent-semantic-artifact-validation`。
- 后续串行需求：`20260720-artifact-review-human-loop`，依赖本需求提供的配置、Binding、鉴权和 Snapshot 接口。
- 强关联但不重复：现有 Artifact Contract 与 syntax migration 能力。

## 技术与测试方案

- 新增独立 `control-plane` 模块，分为 Catalog、严格配置 Schema、不可变 Snapshot、Binding/Grant Resolver、默认拒绝 Authorizer 和自然语言 Guidance Renderer；公共接口通过包导出提供给后续 Review Loop。
- Permission Catalog 固定为 `artifact.read/write/submit` 与 `decision.assess/challenge/decide/override`，每项保存版本化中英文说明；Decision Policy Catalog 首期固定注册 `artifact_acceptance.unanimous`。
- `config.json` 使用 `control_plane.identities/roles`；Agent Identity 只接受 `command/args`，Role 使用 `permissions`、`grantable_permissions` 和可选 `system_prompt`。配置解析采用 strict schema，未知字段与非法 Permission 直接拒绝。
- 发布 `memsphere-20260721-stable`：`!procedure.role_bindings` 提供默认绑定，`!artifact.role_bindings` 覆盖同名 Role，`!artifact.permission_grants` 追加当前 Artifact 临时权限；`!action` 保持 strict 且不接受治理字段。
- Binding 优先级固定为调用方 Procedure < 被调用 Procedure < 当前 Artifact；同名 Role 整体替换，未声明 Role 继承。Grant 必须属于 Role 的 `grantable_permissions`。
- 新 Run 使用 contract v3，在开始时冻结内置 Catalog、配置、revision、全部可达 Procedure、外部 Schema、Binding 与 Grant；修改磁盘配置或 Memory 不改变运行中 Run。v2 Run 保持原有动态调用行为，v1 继续只读。
- 配置了 `control_plane` 后，每个 Artifact 都生成控制平面解析结果并在 report 前检查 Runner 的 `artifact.submit`；拒绝发生在候选解析、Validator、Artifact 文件和 Run 状态写入之前。
- CLI 在 report 前、成功后和拒绝时，从 Run 快照渲染当前有效 Permission、临时 Grant、来源和自然语言说明；中文环境使用 zh-CN，其他环境使用英文。
- `memsphere validate` 先校验严格 config，再联合校验 Procedure/Artifact 引用，错误路径定位到 `config.json#...` 或 `memory.yaml#flow[...]...`。
- 使用 `test/fixtures/control-plane` 提供可直接 validate 和运行的 caller/callee fixture；自动化覆盖 Catalog、配置拒绝矩阵、语法作用域、引用错误、覆盖顺序、快照冻结、成功/拒绝鉴权、零写入和权限 Guidance。

### 兼容策略

- `control_plane` 为可选配置；未配置的旧项目不启用 Artifact 权限控制，现有 report 行为不变。
- `memsphere-20260719-stable` 继续由冻结的旧 Schema 直接解析和执行；迁移到 `memsphere-20260721-stable` 是显式可选的 no-op 版本升级，只有新治理字段要求新版本。
- 新建 Run 写 contract v3；已有 v2/v1 Run 的解析和既有行为保持兼容，不把历史 Run 静默改写为 v3。
- Memory YAML 序列化在内部 camelCase AST 与外部 snake_case 关键字之间显式转换，完整读取和 Node 局部读取均可往返。

## 开发任务

- [x] 实现内置 Permission/Decision Policy Catalog 和版本化中英文说明。
- [x] 实现 Identity/Role 严格配置、脱敏确定性 Snapshot 与公共 TypeScript 接口。
- [x] 实现 Role Binding、Permission Grant、默认拒绝鉴权和权限 Guidance。
- [x] 发布新 Memory syntax，保留旧 syntax 直接执行并注册逐版本迁移路径。
- [x] 扩展 validate 联合校验和精确错误路径。
- [x] 实现 Run v3 可达 Procedure/Schema/控制平面快照与 report 原子鉴权。
- [x] 更新 CLI 输出、Memory YAML 序列化、预置语法记忆、Procedure 概念、Skill 和 README。
- [x] 添加持久 fixture 与单元、集成、兼容回归测试。
- [x] 完成最终全量测试、构建和 CLI 复现证据。

## 验收结果

- 全量 `npm test` 通过，共 237 项；Artifact 作用域补充 Procedure 名称后，控制平面、Run command/store 与序列化定向回归 49 项继续全部通过。
- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。
- 当前工程与 `test/fixtures/control-plane` 分别执行 `memsphere validate`，均返回 `memsphere validation passed`。
- 使用构建后的真实 CLI 运行 caller -> child fixture：Runner 在 report 前看到中文权限 Guidance，report 成功记录 `artifact.submit` 鉴权依据，随后进入 child；两个 Artifact 作用域分别稳定解析为 `control-plane-caller#flow[1]` 与 `control-plane-child#flow[1]`。
- 拒绝零写入、旧 syntax/v2/v1 兼容、快照冻结、Binding 覆盖、Grant 上限和脱敏边界均由自动化测试覆盖；本轮无已知阻塞项。
- 提需方于 2026-07-21 确认验收通过。
