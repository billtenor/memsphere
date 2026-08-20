---
id: 20260819-memory-canonical-reference
type: breaking-change
created: 2026-08-19
completed_at: 2026-08-20
run_id: run-20260819-101856z-2dd95792
ui_run_id: run-20260820-061819z-48a56d91
---

# Memory canonical reference 规范化

## 整体目标

将顶层 Memory 的 canonical name 收紧为稳定的机器标识，避免中文、空格或其他自由文本进入逻辑 reference，并让新建 Memory 使用可读且稳定的文件名。自然语言名称继续通过 alias 提供。

## 当前迭代范围

- 顶层 Memory 的 `names[0]` 或顶层 `name` 必须是 1–120 字符的小写 ASCII kebab-case：`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`。
- alias 允许 Unicode 与内部空格，但禁止空值、首尾空白、控制字符和 `/`。
- 只有顶层 Memory canonical name 使用上述规则；嵌套 Statement、Schema field、Artifact、Review Slot 等自然语言名称不受影响。
- 带 kind 的 `<kind>/<name>` 只允许 canonical reference；bare name 仍可作为 canonical name 或 alias selector。
- `!ref target` 必须使用 `<kind>/<canonical-name>`。
- `!call target`、Concept `extends` 和 Artifact 字符串 `schema` 必须使用目标 Memory 的 canonical name。
- 新建 `memory edit` 和 `memory rename` 拒绝非法 canonical name，不自动翻译或 slugify。
- 新建 Memory 文件直接使用 `<canonical-name>.yaml`，不再使用 hash fallback。
- 更新代码、Reserved Memory、System Memory 规则、内置 Skill、文档、示例、测试与 fixtures，使仓库内容满足新约束。
- 保持 `memsphere-20260721-stable` syntax 标识不变。
- View 左侧栏和标题以 `names[1]` 作为人类可读展示名并回退到 `names[0]`；副标题展示 canonical reference，不展示 LocalFile path。
- View 搜索匹配 canonical reference 和全部 names；无效 Memory 仍以 Provider locator 提供诊断。

## 后续范围

- Managed Memory Store 的数据调整不进入 Git diff，已通过 Memory ChangeSet 调整并发布。
- 本轮不提供自动迁移命令、兼容解析或旧 reference 回退。
- 当前 Embedded Project、Reserved Memory 和 Managed `memorybase` Project 均已完成同步与校验。

## 交付物

- canonical name、alias 和 logical reference 的统一校验与解析实现。
- CLI create/rename、Catalog、Memory validator 和 Run 外部引用的一致行为。
- 完成规范化的 Reserved Memory、Skill 与仓库文档。
- 覆盖成功、失败和边界场景的自动化测试。

## 验收标准

- `memory edit 'statements/MemoryBase MR 功能交付评审规范'` 被拒绝，并说明 canonical name 格式要求。
- `memory edit statements/memorybase-mr-functional-delivery-review-rules` 可创建以 canonical slug 命名的候选文件。
- 顶层 canonical name 含大写、空格、中文、下划线、点、连续或首尾连字符、超过 120 字符时校验失败。
- alias 可以包含中文和内部空格，但包含首尾空白、控制字符或 `/` 时校验失败。
- `memory read`、`memory list` 等选择操作仍可用 bare alias；`kind/alias` 被拒绝。
- `!ref`、`!call`、Concept `extends` 和 Artifact 外部 Schema 字符串引用拒绝 alias 或非法 reference，并能解析 canonical target。
- Reserved Memory、Skill、示例和测试使用 canonical slug；manifest 安装路径保持稳定。
- `npm run typecheck`、针对性测试、`npm test`、`npm run build` 和仓库可执行的 Reserved Memory 校验通过。
- Managed `memorybase` Store 已通过 ChangeSet 发布规范化后的 Memory。
- View 左侧栏和标题展示首选 alias，副标题展示 canonical reference；canonical route、ID 与 reference lookup 保持不变。

## 向前兼容

结论：不需要向前兼容。

允许破坏旧 canonical name、`kind/alias`、alias 形式的持久引用、不规范顶层 Memory，以及 View 展示 canonical name/LocalFile path 的旧行为。现有 Managed Memory Store 已通过 Memory ChangeSet 手工调整；本轮不提供 migration、兼容层或旧数据自动修复。

## 采用的规则

- `memsphere 代码仓库需求规范`：明确范围、验收标准和不向前兼容结论。
- `memsphere 代码仓库开发规范`：代码、Reserved Memory、System Memory 与 Skill 同步变更。
- `memsphere 代码仓库测试规范`：执行针对性测试、全量测试、typecheck、build 和可执行的 Memory 校验。
- `Memsphere YAML 语法规则`：`names`、`!ref`、`extends`、Artifact `schema` 和 `!call target` 的规则、示例与实现必须共同收紧为 canonical reference 语义，且不得误伤嵌套自然语言名称。
- `memsphere 记忆访问规则`：显式 `<kind>/<name>` 只接受 canonical reference；bare canonical name 或 alias 仅作为发现、读取和现有目标选择器。

## 待确认项

无。用户已确认不升级 syntax、不提供兼容，并将 Managed Memory Store 调整留到下一步通过 ChangeSet 完成。

# Syntax 关键字变更

本轮不新增或删除 YAML syntax 关键字，只收紧现有名称与引用字段的合法值。

## 实施与验证方案

### 核心模型

- 在 `src/memory/logical-reference.ts` 集中定义 canonical name 的 pattern、长度、校验与错误文案，Catalog、schema、ChangeSet 和引用校验共同复用。
- `parseLogicalMemoryReference` 只解析 `<kind>/<canonical-name>`；Catalog 的显式 reference 只匹配 descriptor canonical reference，bare selector 才匹配 names 中的 canonical name 或 alias。
- 顶层 Memory schema 单独校验 canonical name 与 alias；通用 `namesSchema` 继续服务嵌套节点，避免限制自然语言 section/field 名称。
- Catalog 对 Provider descriptor 重复执行边界校验，防止绕过 YAML schema 的 Provider 数据进入索引。

### 持久引用

- `!ref target` 在 schema 和跨文件 validator 中只接受 canonical logical reference，并只按目标 canonical reference 查找。
- `!call target`、Concept `extends` 与 Artifact 字符串 `schema` 使用 canonical name schema；跨文件 validator 检查目标存在且类型正确。
- Run 仍可通过用户输入的 bare alias 选择根 Procedure；进入快照后的外部依赖只使用 canonical target。

### ChangeSet 与文件名

- create 在解析新 logical reference 时拒绝不规范 name；rename 在创建 ChangeSet 前校验新 canonical name。
- 默认 create path 固定为 `<kind>/<canonical-name>.yaml`，删除 hash fallback；bootstrap 的显式 manifest path 保持原逻辑。

### 内容同步

- Reserved Memory 优先把现有 `memsphere-*` alias 提升到 `names[0]`，原自然语言名称保留为 alias；缺失 slug 时补充明确的 canonical name。
- 更新实际 `!ref`、`extends`、`!call`、Artifact schema 引用，以及 YAML 规则、Memory 访问规则、四类 Schema 说明、Procedure 编写规则和 `src/skills/memsphere/SKILL.md`。
- manifest 只记录物理路径，本轮不改 install/remove 集合。
- 更新直接受影响的单元测试、CLI 集成测试、Run 测试、Reserved Store 测试、fixtures 与 smoke 数据；历史需求归档不做机械改写。

### 开发任务

- [x] 实现 canonical/alias 公共校验与 Catalog 解析边界。
- [x] 实现顶层 Memory、持久引用和 ChangeSet 校验。
- [x] 规范化 Reserved Memory、Skill 与当前仓库文档。
- [x] 更新测试与 fixtures，覆盖全部非法边界。
- [x] 运行针对性测试、typecheck、全量测试、build 和 Reserved/Project smoke。

### 验证方式

- 针对性：`memory-schema`、`memory-syntax`、`memory-serializer`、`memory-catalog`、`memory-references`、`memory-changeset`、`memory-cli`、`run-store`、`run-command`、`reserved-store`。
- 静态与构建：`npm run typecheck`、`npm run build`。
- 全量：`npm test`、`npm run smoke:project`。
- Memory：构建后验证当前 Embedded Project、`.memsphere/memory` 与 `reserved-memory`；Managed `memorybase` Store 通过 ChangeSet 校验与发布。

### 采用的设计、开发与测试规则

- `Memsphere YAML 语法规则`：以其中对 names 和各引用字段的职责划分为结构基线，并在本轮把允许 alias 持久引用的旧值规则更新为 canonical-only。
- `memsphere 记忆访问规则`：该 Statement 当前允许 `kind/alias`，属于本轮明确要修改的旧行为；实现与验收以需求契约确认并由本轮同步更新后的 canonical-only 规则为准。
- `memsphere 代码仓库开发规范`、`memsphere 代码仓库测试规范`。

### 待决问题

无。实现边界已经由用户确认。

## 最终交付

- 顶层 canonical name、logical reference、文件命名、CLI create/rename、Catalog、持久引用和 Run 外部依赖已统一收紧为 canonical-only。
- Embedded 与 Reserved System Memory 已同步；`memorybase` Managed Store 已通过 ChangeSet `change-20260819-160831675z-29de9d6b` 发布，Revision 为 `419f85017302f416add079eb005935769c580f8f`。
- View 根 Memory 左侧栏与标题展示首选 alias，副标题与 tooltip 展示 canonical reference；正常 Memory 搜索不再依赖物理 path。
- 无 alias、canonical route、三种搜索方式、Project 切换、深链接与无效 Memory locator 诊断均有自动化回归覆盖。
- 最终验证：三个受影响 View 测试文件 72/72、全量测试 374/374、typecheck、build、真实 Embedded Project validate、Embedded/Reserved root validate 与 `git diff --check` 全部通过。
- UI 敏捷迭代最终实现验收由产品、研发、测试、架构全部通过；非阻塞后续建议为 locale alias 选择与重复 alias 消歧。
