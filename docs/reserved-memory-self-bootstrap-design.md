# memsphere 预置记忆自举建设思路

> 状态：讨论稿。本文用于记录当前思路，不代表已经定案的 memsphere 规范。

## 背景

memsphere 的预置记忆不只是把当前规范保存为 YAML，它还要帮助一个完全不了解 memsphere 的 agent 从零开始建立认知。

理想情况下，agent 首先理解什么是 Memory，然后沿着预置记忆提供的阅读线索，逐步理解：

- memsphere 是什么。
- memsphere 定义了哪些记忆类型。
- 如何阅读和编写 memsphere YAML。
- memsphere 的存储、review、run、archive 和唯一入口 Skill 如何协作。
- memsphere CLI 的命令有哪些，分别解决什么问题。
- 如何实际创建、检查、review 和执行记忆。

因此，预置记忆应该是一套可以自举理解的知识体系，而不是一组平铺的参考文档。Agent Skill 保留启动和路由所必需的稳定内核，也可以冗余提供帮助 agent 快速建立认知的简明摘要；完整知识、规则和工作流仍统一由 Memory 承载。包内预置记忆作为源码随 memsphere 发布，并由 `memsphere init` 安装为用户作用域内持续更新的系统托管记忆。

## 建设目标

预置记忆应当使一个没有 memsphere 先验知识的 agent 能够：

1. 找到明确的阅读入口。
2. 在没有预先理解自定义 YAML 结构的情况下看懂第一份记忆。
3. 按照明确的依赖顺序逐步学会新概念和新语法。
4. 理解每个概念的语义、边界和与其他概念的关系。
5. 在需要操作时找到对应的精确语法、命令说明或可执行流程。
6. 最终可以独立地使用 memsphere 完成实际任务。

## 核心原则

### 先可读，后结构化

预置记忆不应在 agent 理解某种类型之前，就依赖该类型来解释其他内容。

例如，作为第一份入口记忆的 `Memory` 不宜立即嵌套 `!statement` 或 `!schema`，因为初次接触 memsphere 的 agent 尚未理解这些类型。

### 不在解释之前使用新语法

当一种自定义 tag、字段或结构首次出现时，应同时说明：

- 它的名称。
- 它表达什么类型。
- 它在当前 YAML 中的作用。
- 详细语法应该继续阅读哪份记忆。

### 每种记忆类型承担不同职责

- Concept 负责建立语义、边界、关系和后续阅读入口。
- Statement 负责表达可以判断真假的事实、规则和约束。
- Schema 负责表达精确字段、字段类型、必填性、层级和展示形式。
- Procedure 负责表达真正可以执行的操作流程。

Concept 不应被写成字段手册，Schema 也不应代替概念说明。命令行为、状态转换和全局 YAML 规则更适合由 Statement 承载。

### 使用正向规则和有效示例

优先告诉 agent 应该怎么写，而不是穷举它原本未必会想到的错误写法。

需要展示 YAML 语法时，应提供经过 validator 验证的完整示例，并解释示例中每个 memsphere 自定义结构的意义。

### 区分稳定语义与可变事实

概念定义应尽可能稳定。CLI 命令、参数、存储路径和当前支持的类型列表会随产品变化，应放在可独立更新的 Statement 或 Schema 中，避免污染核心概念。

### Skill 由稳定内核与冗余加速层组成

Skill 不再作为 memsphere 完整领域知识的事实来源，但不必被压缩到只有最少几条机械指令。它由两部分组成：

- 启动内核负责定位 memsphere、找到自举入口、识别用户意图、读取相关记忆，并在需要执行操作时启动或恢复 Procedure Run。
- 理解加速层冗余保存低变化、高频使用的概览和路由提示，帮助 agent 更快形成 memsphere 的整体地图。

编辑规则、review 状态、YAML 详细语法和具体工作步骤仍应迁移为 Concept、Statement、Schema 或 Procedure。即使移除 Skill 中的理解加速层，agent 也必须能够只依靠启动内核和标准 Store 中已安装的 Memory 完成自举。

## 自举阅读路径

建议的认知依赖顺序为：

```text
memsphere Skill
  -> Memory
  -> Memsphere
  -> Concept
  -> Statement
  -> Schema
  -> Procedure
  -> memsphere 类型系统
  -> Action / Artifact / If / While / Call
  -> Memory Store / 预置安装机制 / Review / Run / Archive
  -> memsphere CLI
  -> 实际操作流程
```

这条路径不只是文档章节的先后关系，还应该在记忆内容中使用精确的记忆名称建立导航。Agent 读完一份记忆后，应能够明确知道接下来应读什么。

## Memory 作为自举入口

`Memory` 应该是整套预置记忆的第一个入口。它的首要任务不是展示完整规范，而是让 agent 可以开始理解 memsphere。

`Memory` 建议仅使用最简单的 `names` 和纯文本 `defines`，并解释：

- Memory 是什么，什么信息值得被沉淀为 Memory。
- memsphere 当前有哪些具体记忆类型。
- 当前文件第一行的 `!concept` 表示什么。
- `names` 和 `defines` 在当前记忆中分别表示什么。
- 为了继续理解 memsphere，接下来应该阅读哪些记忆。

`Memory` 中不宜放置：

- 嵌套的 `!statement` 或 `!schema`。
- 四种记忆当前恰好共有的字段总结。
- 完整的 YAML 类型系统。
- CLI 命令或存储实现细节。

详细 YAML 规则应在 agent 理解 Statement 之后，由独立的 `Memory YAML expression rules` Statement 承载。

## 预置记忆分层

### 第一层：自举概念

- `Memory`
- `Memsphere`
- `Concept`
- `Statement`
- `Schema`
- `Procedure`

这一层建立基本词汇、记忆类型之间的关系和后续阅读路径。

### 第二层：编写语言

概念记忆：

- `Memsphere type system`
- `Action`
- `Artifact`
- `If`
- `While`
- `Call`

规则记忆：

- `Memory YAML expression rules`
- `Memory naming and reference rules`
- `Procedure flow rules`

实体 Schema：

- `Concept entity schema`
- `Statement entity schema`
- `Schema entity schema`
- `Procedure entity schema`
- `Action schema`
- `Artifact schema`
- `If schema`
- `While schema`
- `Call schema`

概念负责解释语义，Statement 负责全局规则，Schema 负责完整字段语法。

### 第三层：运行与生命周期

- `Memsphere scope`
- `Memory store`
- `Reserved memory`
- `Review`
- `Run`
- `Archive`
- `Memsphere CLI`

这一层解释记忆如何被存储、发现、安装、review、执行和归档，以及 agent 如何通过唯一 Skill 与 memsphere 协作。

### 第四层：CLI 命令事实

建议按能力分组建立 Statement，不为每个命令建立一个 Concept。

- 核心命令：`init`、`validate`、`list`、`view`、`skill init`。
- Run 命令：`run start`、`run report`、`run enter-schema`、`run status`。
- Archive 命令：`archive list`、`archive review`、`archive run`、`archive restore`。

每个命令的记忆应说明：

- 命令的目的。
- 使用前置条件。
- 关键参数和选项。
- 命令对文件或状态产生的影响。
- 成功后应该执行的下一步。

### 第五层：实际操作流程

- `Memsphere self-bootstrap acceptance`：对 memsphere 预置记忆进行自举验收。
- 从零学习 memsphere。
- 初始化 memsphere 并安装唯一入口 Skill。
- 创建或修改一份记忆。
- 对记忆发起并处理 review。
- 启动、推进并完成一个 Procedure Run。
- 归档和恢复已完成的 Review 或 Run。
- 通过对话构建 Procedure。

命令记忆说明单个命令能做什么，Procedure 负责把多个命令和 agent/human 行为组合成面向目标的工作流。

## 单一 Skill 架构

### 总体定位

统一入口方案只保留一个名为 `memsphere` 的 Skill。它承担整个 memsphere 的入口，而不只负责 Procedure 执行。

CLI 中仍然保留 `memsphere run` 命令组。Skill 是 agent 面向整个 memsphere 的入口，Run 则是执行 Procedure 的运行时机制，两者不需要使用相同名称。

整体职责关系为：

```text
Skill       -> 启动、发现、理解意图、快速概览和路由
Memory      -> 知识、事实、结构和流程本体
Procedure   -> 可执行的 memsphere 操作能力
Run         -> Procedure 的受控执行机制
CLI         -> 确定性的底层操作接口
```

### Skill 的两层结构

唯一 Skill 建议明确分为两层：

```text
Memsphere Skill
  = Bootstrap Kernel
  + Redundant Fast-start Synopsis
```

#### 启动内核

启动内核保存无法继续下沉到 Memory 的稳定能力：

1. 定位当前 memsphere scope 和配置。
2. 找到 `Memory` 与 `Memsphere`，完成冷启动。
3. 根据用户意图区分知识查询和操作请求。
4. 知识查询时，定位并读取相关 Concept、Statement 或 Schema。
5. 操作请求时，选择对应 Procedure，并启动或恢复 Run。
6. 严格按照 Run 返回的当前步骤执行并报告 Artifact。
7. 当预置记忆无法读取时，运行基础校验并给出最小恢复信息。

#### 理解加速层

理解加速层可以冗余保存以下低变化信息：

- memsphere 的一句话定位。
- Concept、Statement、Schema 和 Procedure 的一句话区别。
- 预置源码通过 init 安装到标准 Memory Store，运行时不区分创建来源。
- 知识查询读取 Memory、操作请求选择 Procedure 的基本路由原则。
- 常见用户意图对应的规范 Memory 或 Procedure 名称。
- `init`、`validate`、`view` 和 `run` 等核心命令入口。
- 一条简短的推荐阅读路径。

这些摘要用于加速理解和选择下一步，不代替 Agent 在执行任务前读取对应的完整 Memory。

#### 加速层边界

理解加速层不应承载：

- 四种记忆类型的完整 YAML 规范。
- Procedure Flow 的详细语法。
- Review YAML 的字段和状态规则。
- 编辑 Memory 的完整步骤。
- 处理 Review 的完整流程。
- CLI 命令的详细参考信息。

这些内容分别迁移到对应的预置 Concept、Statement、Schema 和 Procedure。修改用户数据、处理 Review 或执行复杂操作时，Agent 不能只依据 Skill 摘要行动。

### 事实来源与冗余一致性

标准 Memory Store 中当前已安装的 Memory 是完整知识和操作规则的事实来源，Skill 摘要是可以重新生成和丢弃的非权威副本。

冗余内容应遵循以下一致性规则：

1. Skill 中的每条路由摘要尽量指向对应 Memory 的规范名称。
2. Skill 与当前预置源码及其安装清单记录同一 memsphere 版本或内容哈希。
3. 可以从预置 Memory 源码派生的摘要尽量在构建时自动生成，而不是独立手写维护。
4. 无法自动生成的摘要应有一致性测试，防止类型、命令和 Procedure 名称发生漂移。
5. Skill 摘要与已安装 Memory 不一致时，以当前版本的已安装 Memory 为准，并提示重新执行初始化或 Skill 安装。
6. Skill 文件中的理解加速层应具有明确边界，便于自举验收临时生成只包含启动内核的测试版本。

### 查询与执行分流

统一 Skill 入口不等于所有请求都必须创建 Run。是否启动 Run 取决于用户意图：

```text
用户调用 memsphere Skill
        |
        v
识别当前意图
        |
        +-- 查询、解释、学习
        |       -> 读取相关 Memory
        |
        +-- 创建、修改、review、运行、归档
                -> 找到对应 Procedure
                -> 启动或恢复 Run
                -> 按当前步骤执行到 done
```

例如，询问“什么是 Schema”只需要读取相关记忆；要求“创建一份 Schema”则应选择相应 Procedure 并启动 Run。这样既保持统一入口，也不会让简单知识查询产生不必要的运行状态。

### Edit 与 Review 能力迁移

现有 `memsphere-edit` 中的内容应拆分为：

- 记忆类型和 YAML 结构的 Concept。
- 可判断的编写规则 Statement。
- 各实体的精确字段 Schema。
- 创建或修改 Memory 的 Procedure。

现有 `memsphere-review` 中的内容应拆分为：

- Review 概念。
- Review YAML Schema。
- Review 状态和处理约束 Statement。
- 发起 Review 和处理 Review 的 Procedure。

旧的 `memsphere-edit`、`memsphere-review` 和 `memsphere-run` 不再作为产品 Skill 存在。唯一 `memsphere` Skill 通过选择并运行已安装 Procedure 提供能力；尚未迁移为 Memory 的旧能力应明确报告未安装，不能在 Skill 中继续维护第二份隐含流程。

## Reserved Memory 托管安装模型

### 源码与安装目录

仓库或 npm package 中的 `reserved-memory/` 是 memsphere 预置记忆的代码目录。它随 memsphere 版本开发、测试和发布，不是运行时直接使用的用户数据目录。

执行 `memsphere init` 时，memsphere 与用户协同确认要安装或更新的预置记忆，再把它们安装到当前 scope 的标准 Memory Store。运行时只有一个可读 Memory 空间，不再把 Reserved Memory 作为第二套读取源：

```text
repository or npm package
reserved-memory/                 预置记忆源码
        |
        | memsphere init + 用户确认
        v
current scope
.memsphere/memory/               标准 Memory Store
```

安装完成后，Agent 只看到当前 scope 中可用的 Memory，不需要知道一份 Memory 最初来自预置安装还是用户创建。运行时不直接读取仓库或 npm package 中的源码目录，也不读取独立的 `.memsphere/reserved-memory/`。

### Init 的安装和更新职责

`memsphere init` 负责协同安装和更新预置记忆：

1. 创建当前作用域所需的 `.memsphere` 目录结构。
2. 比较包内预置记忆与标准 Memory Store 中当前实体，整理新增、更新和名称冲突。
3. 向用户展示安装计划，并在新增、覆盖、跳过或冲突处理前取得确认。
4. 把确认安装的预置记忆写入标准 Memory Store，使其与其他 Memory 使用相同的名称和读取协议。
5. 使用临时目录完成写入和校验，再原子替换受影响文件，避免中断后留下不完整实体。
6. 在内部安装清单中记录预置版本、逻辑引用和内容哈希，用于后续升级、完整性检查和编辑保护；该来源元数据不进入普通 list/read 输出。

`init` 不应在无人确认的情况下覆盖同名 Memory。`--force` 也不能等同于跳过所有预置记忆冲突判断；非交互环境需要显式提供可审计的安装策略。

### 统一 Memory Catalog

当前 scope 的标准 Memory Store 就是 memsphere 的统一可读记忆目录：

```text
Memory Catalog
  = Standard Memory Store
```

`memory list`、`memory read`、View、知识检索、Procedure Run、`!call` 和 Schema Artifact 查找都应通过统一 Catalog 工作。Catalog 只读取标准 Memory Store，不在运行时拼接预置源码或第二个 Reserved 目录。

这使以下行为成为默认能力：

- 已安装的 Concept、Statement 和 Schema 可以被直接查询和引用。
- 已安装的 Procedure 可以被直接启动，无需在运行时执行额外导入。
- 已安装 Procedure 中的 `!call` 可以解析其他已安装 Procedure。
- 已安装 Procedure 可以使用标准 Store 中的 Schema 生成 Schema Artifact。
- 唯一 `memsphere` Skill 可以稳定地从 `Memory` 和 `Memsphere` 开始自举。

Run 状态应记录实际解析到的 Memory 逻辑引用和内容版本，避免问题发生时无法判断一次运行使用了哪份定义。普通执行不依赖“预置或用户”来源分类。运行开始后是否需要快照相关 Procedure 和 Schema，仍需结合更新期间的一致性继续设计。

### 系统托管与只读约束

预置安装的 Memory 是否允许用户编辑，仍需继续设计。即使它与其他 Memory 位于同一标准 Store，也可以通过内部安装清单实施产品和工具层面的写入边界，而不依赖独立目录：

- 普通读取和任务执行不展示或依赖 Memory 的创建来源。
- 编辑 Procedure 在写入前可以根据内部安装清单识别系统管理项，并要求进入专门的升级、fork 或解除托管流程。
- Validator 可以根据版本和哈希清单检查已安装预置内容的完整性。
- `memsphere init` 发现已安装内容变化时，应向用户展示差异并协同处理，不能静默覆盖。
- 文件只读权限只能作为提示，不能作为唯一约束。

预置记忆源码仍然可以在 memsphere 工程仓库中正常开发和 review。相关限制针对标准 Store 中由安装清单管理的实体，不是仓库中的 `reserved-memory/` 源码。

### 名称和导入语义

标准 Memory Store 中不应存在重复的规范名称或别名。预置安装与已有 Memory 冲突时，应在 `init` 的人机协同阶段解决；Catalog 不根据来源设置不透明的覆盖优先级。

采用该安装模型后，“Reserved Memory 是否已导入”不再是运行时状态。预置内容完成 `init` 后就是标准 Store 中可直接使用的 Memory，View 中原有的 `reserved`、`not imported` 等读取标签应相应移除。

如果未来允许用户基于受管理的预置 Memory 创建独立可编辑版本，该行为更接近 `fork`：它需要新的规范名称和独立身份，不应继续使用 `import` 表达。

## 自举验收 Procedure

### 验收目的

预置记忆体系需要一份正式的 Procedure，用于验证 memsphere 是否真正具备自举能力。建议使用以下规范名称：

```text
Memsphere self-bootstrap acceptance
memsphere 自举验收流程
```

该流程验证的不是 YAML 能否被 parser 读取，而是：

> 一个没有 memsphere 先验知识的 agent，依赖唯一 `memsphere` Skill、CLI 和 `init` 安装到标准 Store 的 Memory，能否自行理解并正确使用 memsphere；当移除 Skill 的冗余理解摘要后，是否仍能仅依靠启动内核和已安装 Memory 完成同样的自举。

这是一项 Agent Evaluation。它验证的是预置 Memory 源码及其安装结果、唯一 Skill、CLI、Agent 模型和运行环境共同构成的系统能力。

### 双模式验收

自举验收需要区分两种模式：

- **正常体验模式**：安装完整 `memsphere` Skill，验证冗余理解加速层是否让 Agent 更快、更稳定地完成任务。
- **纯自举模式**：安装临时生成的启动内核版本，不包含冗余理解摘要，验证标准 Store 中已安装的预置 Memory 是否足以完成自举。

正常体验模式用于验证实际用户体验，纯自举模式用于防止 Skill 中的冗余知识掩盖预置记忆缺陷。正式验收报告必须分别记录两种模式的结果。

不需要长期维护第二个产品 Skill。可以在唯一 Skill 中明确标记启动内核和理解加速层，并由自举验收流程临时生成只包含启动内核的测试版本。

### 干净上下文约束

参与验收的子 Agent 必须满足以下条件：

- 使用全新对话上下文，不继承父 Agent 的讨论记录、计划或总结。
- 根据测试模式安装完整 `memsphere` Skill，或临时生成的启动内核版本。
- 不安装旧的 `memsphere-edit`、`memsphere-review` 或 `memsphere-run`。
- 使用新建的隔离工作区执行 `memsphere init`。
- 只能通过 CLI 读取标准 Store 中已安装或由测试提供的 Memory，并读取当前测试模式的 Skill 和 CLI 输出。
- 不能读取工程中的 `README.md`、`docs/`、`src/`、旧 Skill 或 `reserved-memory/` 源码目录。
- 父 Agent 只发送标准化任务，不在执行过程中提示答案、解释语法或纠正错误。

如果子 Agent 接触了禁止的信息来源、继承了已有 memsphere 上下文，或者父 Agent 在执行中提供了额外指导，本次验收应判为 `invalid`，不能计为通过或失败。

### 标准任务集

初版验收建议让同一个干净子 Agent 按顺序完成一次完整学习旅程：

1. **知识发现**：解释 Memory、Concept、Statement、Schema 和 Procedure 的含义、区别和选择方式。
2. **基础编写**：根据自然语言需求创建合法的 Concept、Statement 和 Schema，并通过 `memsphere validate`。
3. **Procedure 编写**：创建包含 Action、Artifact 和控制结构的 Procedure，并通过校验。
4. **错误修复**：读取一份具有代表性的非法 Memory YAML，依靠预置记忆定位并修复问题。
5. **Review 处理**：针对提供的用户 Memory 和已提交 Review，完成修改、校验和状态流转。
6. **Procedure 执行**：发现并运行一个由 init 安装的 Procedure，正确报告 Artifact，直到 Run 完成。
7. **托管保护**：面对修改受安装清单管理 Memory 的任务，进入专门的升级、fork 或解除托管流程，并保持普通任务不会静默改写它。

任务描述不直接提供预置记忆文件路径、目标 Schema 名称或正确命令。发现相关 Memory 和选择操作方式本身就是验收内容。

### Procedure 执行结构

建议的验收流程为：

```text
记录测试目标、版本和模型信息
        |
构建隔离临时工作区
        |
执行 memsphere init
        |
安装当前验收模式对应的 memsphere Skill
        |
验证上下文与可读数据源干净
        |
启动全新子 Agent
        |
依次发送标准化任务，不提供纠正
        |
收集对话、命令、文件和 Run Artifact
        |
执行独立的确定性校验
        |
分析 Memory 发现路径并分类失败原因
        |
生成自举验收报告和最终结论
```

启动上下文干净的子 Agent 是该 Procedure 的运行前提。执行环境如果没有创建隔离子 Agent 的能力，应明确报告阻塞，不能用当前父 Agent 模拟干净上下文。

### 独立确定性校验

不能依赖被测子 Agent 自己判断任务是否成功。父 Agent 或验收器需要独立检查：

- 生成的 YAML 是否通过当前 validator。
- 文件是否写入预期的用户 Memory 目录。
- 预置 Memory 的安装清单和受管理内容哈希是否保持不变。
- Review 是否完成正确的状态流转和目标修改。
- Procedure Run 是否真正达到 `done`。
- `!call`、Schema Artifact 和其他引用是否解析到正确逻辑引用。
- 子 Agent 是否读取了禁止使用的源码、文档或旧 Skill。
- 子 Agent 使用的 Memory 名称和 CLI 命令是否真实存在。
- 当前测试 Skill 是否与声明的验收模式一致，纯自举模式中是否确实不包含理解加速层。
- 两种验收模式是否使用完全相同的任务描述、测试夹具和确定性判定标准。

流程还应记录子 Agent 实际读取过的 Memory 和执行过的命令。仅根据最终答案猜测它的学习路径，不足以证明自举过程成立。

### 验收报告

最终产物是一份结构化的自举验收报告，至少包含：

- memsphere 版本。
- 预置 Memory 源码版本和安装清单哈希。
- 唯一 Skill 的版本或哈希，以及本次使用的完整模式或启动内核模式。
- 子 Agent 模型、能力和运行环境。
- 测试工作区和上下文隔离说明。
- 每个任务的输入、行为摘要、产物和校验结果。
- 子 Agent 使用过的 Memory 和 CLI 命令。
- 预置 Memory 安装完整性检查结果。
- 失败分类和对应的记忆缺口。
- 最终结论：`pass`、`fail` 或 `invalid`。

建议至少区分以下失败来源：

- 自举入口或路由失败。
- 概念解释缺失或存在歧义。
- YAML Schema 或规则记忆不足。
- Procedure 设计缺失或不可执行。
- CLI 或统一 Catalog 能力不足。
- Agent 偶发执行偏差。
- 测试上下文污染。

### 单次旅程与重复试验

一个干净子 Agent 成功完成完整旅程，可以作为初版冒烟验收，但不能充分证明稳定性。

正式发布门禁应在相互独立的干净上下文中重复运行，并记录通过率。后续还可以为关键任务分别启动独立子 Agent，避免前序任务积累的知识掩盖某个入口或检索缺陷。

通过阈值、重复次数和允许的 Agent 模型范围需要结合成本与稳定性进一步确定，并在验收报告中明确记录。

## 建设顺序

1. 重写 `Memory`，使其成为仅依赖普通 YAML 和自然语言的自举入口。
2. 建设 `Memsphere`，作为整个预置记忆体系的概览和导航节点。
3. 重新梳理 `Concept`、`Statement`、`Schema` 和 `Procedure`，确保它们符合学习依赖顺序。
4. 建设类型系统、Flow 结构概念和所有实体 Schema。
5. 建设存储、review、run、archive、skill 和 CLI 概念。
6. 建设与当前 CLI 实现对应的命令 Statement。
7. 将 edit 和 review 的规则与流程迁移为预置 Memory。
8. 建设面向真实任务的其他 Procedure。
9. 重构 `memsphere init`，通过人机协同把预置记忆原子安装到标准 Memory Store。
10. 建设统一 Memory Catalog，让查询、View 和 Run 只使用标准 Memory Store。
11. 建设唯一入口 Skill `memsphere`，明确划分启动内核和理解加速层。
12. 建设 Skill 摘要生成或一致性检查机制，使冗余内容与预置 Memory 源码及其安装结果保持同步。
13. 建立受管理 Memory 的编辑保护、完整性和名称冲突约束。
14. 建设 `Memsphere self-bootstrap acceptance` Procedure 及其结构化验收报告。
15. 使用完整 Skill 和启动内核两种模式进行干净子 Agent 验收。
16. 验收发布与安装产物只包含统一 `memsphere` Skill，不再携带旧 Skills。

## 验收方案

### 语法与实现一致性

- 所有预置 Memory 源码都能被当前 parser 读取并通过 validator。
- 记忆中的完整 YAML 示例可以被 validator 实际验证。
- CLI 命令记忆与当前 Commander 命令定义保持一致。
- 记忆间使用的规范名称引用都能定位到存在的记忆。
- `memsphere init` 能展示预置记忆安装计划，经用户确认后把选定内容安装到标准 Memory Store。
- 预置 Memory 安装过程具备原子性，失败时不会破坏上一版可用安装。
- 唯一 Skill 使用的入口 Memory 和核心 Procedure 都能从统一 Catalog 稳定发现。
- Skill 理解加速层能够追溯到对应 Memory，并与当前预置源码及安装清单版本保持一致。
- 移除理解加速层后，启动内核版本仍能引导 Agent 完成完整自举。
- Procedure、`!call` 和 Schema Artifact 都从标准 Memory Store 中解析。
- 标准 Memory Store 中的规范名称和别名不存在歧义。
- 受安装清单管理的 Memory 被修改时，编辑流程或 validator 能够阻止或检测，并由后续人机协同流程处理。
- 自举验收 Procedure 能创建隔离环境、启动干净子 Agent，并保留完整的测试证据。
- 自举验收报告中的确定性结果可以由父 Agent 或自动化工具独立复核。

### 冷启动理解验收

使用一个未提供任何 memsphere 先验知识的 agent，最初只给它 `Memory`，检查它能否沿着记忆网络最终完成：

1. 解释 Concept、Statement、Schema 和 Procedure 的区别。
2. 写出能通过 validator 的记忆 YAML。
3. 选择并执行正确的 memsphere CLI 命令。
4. 初始化、检查和查看记忆。
5. 发起并处理 Review。
6. 启动并推进 Procedure Run。
7. 说明预置安装机制、唯一 Skill 的入口职责和 Archive 的作用。
8. 分别使用完整 Skill 和启动内核版本完成一次知识查询和一次 Procedure 操作。

### 任务验收

不只询问 agent 是否理解，还应要求它完成真实任务，例如创建一份 Concept、修复一份非法 Schema、处理一份 Review、启动一份由 init 安装的 Procedure，以检查预置记忆和唯一 Skill 是否真正支持行动。

## 待讨论问题

1. 系统如何保证一个新 agent 优先发现 `Memory`，而不是随机读取标准 Store 中的其他 Memory？
2. `Memory` 应该直接包含完整的后续阅读顺序，还是只引导到 `Memsphere` 这个总览节点？
3. 是否需要为预置 Memory 源码增加显式的阅读顺序或依赖关系元数据？
4. CLI 命令记忆应按命令组合并，还是根据复杂度拆分为更小的记忆？
5. YAML 完整示例应存放在 Schema 的 `defines` 中，还是建立独立的示例机制？
6. 如何自动检测预置记忆中的命令说明、类型列表和引用是否已经随代码变更而过期？
7. 冷启动验收应该由人工 review 执行，还是建立可重复运行的 agent evaluation？
8. 文件只读权限是否需要作为默认安装行为，还是只依靠 CLI、View 和完整性校验形成产品约束？
9. 对正在进行的 Run，`init` 更新受管理 Memory 时应沿用启动时版本、保存快照，还是允许后续 `!call` 使用新版本？
10. Reserved Memory 的 `fork` 是否需要成为正式能力；如果需要，如何生成新名称并表达它与原预置记忆的关系？
11. 启动内核应保留到什么程度，才能在预置记忆损坏时仍然完成诊断，同时又不掩盖自举缺陷？
12. 创建上下文干净子 Agent 的能力由 Codex 等宿主环境提供，还是需要 memsphere 定义统一的 Agent 执行接口？
13. 自举验收正式门禁应重复多少次，达到怎样的通过率才能判定当前版本可发布？
14. 是否需要同时维护一条完整学习旅程和一组相互隔离的单任务回归用例？
15. Skill 理解加速层应完全由预置 Memory 源码自动生成，还是允许少量经过一致性测试的人工摘要？
