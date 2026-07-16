# Memory CLI 访问与 Catalog 抽象需求

状态：Proposed

日期：2026-07-15

## 背景

当前 Agent 要读取 Memory 时，只能根据约定进入 `.memsphere/memory/`，再使用文件系统命令查找和读取 YAML 文件。

这种方式把 Memory 的逻辑访问协议泄漏成了目录和文件协议，存在以下问题：

1. Agent 必须知道 Memory 当前存放在哪个目录以及文件如何命名。
2. Memory 的名称、别名和文件名并不等价，直接按文件搜索无法可靠完成名称解析。
3. Agent 可能绕过当前 scope，误读仓库源码或其他目录中的 Memory。
4. Skill 需要包含大量易变化的存储细节，自举过程依赖 `find`、`rg`、`sed` 等通用文件工具。
5. 如果未来 Memory 改为数据库、远端服务、索引库或多后端组合，所有 Agent 行为和 Skill 都要随存储实现重写。
6. CLI、View、Run 和其他能力可能分别实现一套 Memory 查找逻辑，逐渐产生解析和优先级差异。

Memory 应当是一种由 memsphere 管理的领域资源。Agent 应通过稳定的 CLI 接口发现和读取 Memory，而不应直接依赖它当前恰好以 YAML 文件存储的实现。

## 当前实现确认

当前代码具有以下行为：

- `memsphere list [kind]` 已能列出 `config.memoryRoot` 中的实体，但输出能力有限。
- CLI 没有按照规范名称、别名或稳定引用读取一份 Memory 的命令。
- `src/memory/store.ts` 直接遍历目录并读取 YAML 文件，文件系统同时承担存储实现和查询接口。
- `installReservedMemories` 把 bundled memory 复制到 scope 下独立的 `reserved-memory/` 待导入区；这些记忆默认不生效。
- View、Run 和其他能力仍可能直接依赖文件读取路径。

目标模型中，Reserved Memory 不属于运行时 Memory 读取协议。仓库或 package 中的 `reserved-memory/` 是预置内容的发行来源；`memsphere init` 将它复制到当前 scope 的 `.memsphere/reserved-memory/` 待导入区。用户在 `memsphere view` 中选择并导入后，系统再把对应文件复制到标准 Memory Store，且保留待导入区原文件。导入完成后，预置记忆与用户创建的记忆使用同一套读取协议，Agent 不需要也不应该判断一份记忆最初来自哪里。

因此，本需求不是简单增加一个 `readFile` 命令，也不是让 Catalog 同时读取两个目录，而是建立统一的 Memory Catalog 与读取边界。现有 Reserved Memory 两阶段复制行为保持不变，读取层只允许看到已经导入标准 Store 的副本。

## 核心判断

Memory 的语义模型与存储模型应当分离：

```text
Agent / Skill / View / Run
          |
          v
Memory Catalog + Reader
          |
          +-- File Provider（当前实现）
          +-- Database Provider（未来可能）
          +-- Remote Provider（未来可能）
```

CLI 是 Agent 使用该抽象的首个稳定入口。读取结果仍然可以输出规范的 memsphere YAML，使 Agent 继续使用同一套记忆语法理解内容，但 Agent 不需要知道 YAML 来自文件、数据库还是远端服务。

## 目标

1. 为 Agent 提供统一、稳定的 Memory 发现与读取命令。
2. 发现当前 scope 的标准 Memory Store 中全部可用 Memory，不区分其创建来源。
3. 支持按规范名称、别名和稳定引用解析 Memory。
4. 读取命令默认输出语义等价、可再次解析的 memsphere YAML。
5. 隐藏文件路径和后端实现，使未来更换存储方式时 Skill 与 Agent 工作流不变。
6. 让 CLI、View、Run、Review 和后续索引能力复用同一套解析规则。
7. 为自举验收提供确定性的 Memory 访问方式，不再要求被测 Agent 自行遍历目录。

## 非目标

- 本需求不在当前阶段实现数据库或远端 Memory 后端。
- 本需求不实现基于向量的语义检索。
- 本需求不改变 Memory YAML 的实体结构和类型系统。
- 本需求不重新设计预置记忆的选择、升级、覆盖或编辑权限；继续由 `memsphere init` 建立待导入区，并由 View 完成用户选择与复制导入。只有已经导入标准 Memory Store 的副本进入 Catalog。
- 本需求不要求立即删除底层 YAML 文件存储。
- 本需求不把原始文件路径定义为公开、稳定的 Memory 标识。

## 命令设计

建议建立统一的 `memory` 命令组：

```bash
memsphere memory list
memsphere memory read <reference>
```

使用 `read` 而不是 `show`，是因为该命令返回的是供 Agent 继续理解和处理的 Memory 正文，不只是面向终端用户的展示视图。

现有顶层 `memsphere list` 可以在本轮重构中移除，由 `memsphere memory list` 取代。项目尚处早期阶段，不需要为了兼容旧命令保留两套入口。

### `memsphere memory list`

用途：列出当前 scope 中可被读取和使用的 Memory，只返回发现与选择所需的紧凑摘要（names、字符串 defines 与结构化定义计数），不返回类型专属正文。

建议参数：

```bash
memsphere memory list \
  [--kind <concepts|statements|schemas|procedures>] \
  [--query <text>] \
  [--output <yaml|json|text>]
```

规则：

- `--kind` 省略时列出全部记忆类型。
- `--query` 初期只要求匹配规范名称和别名；后续可以扩展为定义摘要、全文或语义检索，但不能改变基础命令语义。
- 默认 `--output yaml`，便于 Agent 稳定解析。
- `text` 只用于人类终端的紧凑显示，不应作为 Skill 依赖的机器接口。
- 列表项不得把源文件路径作为 Memory 身份。

建议的 YAML 输出：

```yaml
memories:
  - reference: concepts/记账
    kind: concepts
    names:
      - 记账
      - 记账记录
    defines:
      - 记账是记录收支与资金变化的行为。
    structured_defines:
      statement: 1
      schema: 1
  - reference: concepts/Memory
    kind: concepts
    names:
      - Memory
      - 记忆
    defines:
      - Memory 是由 memsphere 管理并供 Agent 使用的记忆实体。
next_cursor: null
```

其中：

- `reference` 是 Catalog 生成的逻辑引用，不是相对文件路径。
- `kind` 使用现有复数目录类型名，保持与 CLI 参数一致。
- `names[0]` 是规范名称，其余元素是别名。
- `defines` 原样保留原 Memory 的全部顶层字符串定义，与 names 共同构成类似 Skill name 与 description 的发现元数据。
- 内嵌 `!statement` 和 `!schema` 不在列表中展开；存在时由 `structured_defines.statement` 和 `structured_defines.schema` 分别给出直接成员数量，提示 Agent 继续 read。
- list 不截断单个结构化定义，也不返回 goals、asserts、suggests、fields、flow 等类型专属内容，避免摘要形成不完整或失真的约束。
- `next_cursor` 为未来大规模或远端 Catalog 分页预留；文件 Provider 初期可始终返回 `null`。

### `memsphere memory read <reference>`

用途：解析并读取一份特定 Memory。

建议参数：

```bash
memsphere memory read <reference> \
  [--kind <concepts|statements|schemas|procedures>] \
  [--output <yaml|json>]
```

`<reference>` 支持：

1. Catalog 返回的稳定逻辑引用，例如 `concepts/Memory`。
2. Memory 的规范名称，例如 `Memory`。
3. Memory 的别名，例如 `记忆`。

规则：

- 当名称或别名只能解析到一个实体时，输出该实体。
- 当匹配多个实体时必须返回歧义错误，并列出候选 `reference`；不得静默选择其中一个实体。
- `--kind` 用于缩小解析范围，不改变名称本身。
- 默认输出完整且可再次被 memsphere parser 解析的 YAML Memory 文档。
- 默认输出只包含 Memory 正文，不在文档前后混入说明文字、路径或调试信息。
- 诊断信息写入 stderr，Memory YAML 写入 stdout，便于 Agent 和脚本可靠消费。
- `--output json` 输出等价 AST，主要用于程序集成；YAML 仍是 Agent 阅读 Memory 的首选格式。

示例：

```bash
memsphere memory read concepts/Memory
memsphere memory read 记账
memsphere memory read 记忆 --kind concepts
```

建议的默认输出：

```yaml
!concept
names:
  - Memory
  - 记忆
defines:
  - Memory 是由 memsphere 管理并供 Agent 使用的记忆实体。
```

输出不要求逐字保留源文件中的空行、注释或字段顺序，但必须保持 tag、字段、值和嵌套结构的语义等价。若编辑场景未来需要保留注释，应另行设计源码读取或编辑协议，不能让基础 `read` 重新泄漏文件存储假设。

## Catalog 解析规则

### 统一收录范围

当前 scope 的 Catalog 只收录 `config.memoryRoot` 指向的标准 Memory Store。

仓库、npm package 以及当前 scope 的 `.memsphere/reserved-memory/` 都不属于 Catalog。`memsphere init` 只负责把发行源复制到待导入区；用户在 View 中导入后，标准 Memory Store 中的副本才是普通可用 Memory。Catalog 不读取预置源码或待导入目录，也不向 Agent 暴露一份标准 Memory 是预置导入还是用户创建。

### 名称与引用

- 每份 Memory 具有一个规范名称 `names[0]`。
- `names[1..]` 是别名。
- 稳定逻辑引用由 `kind` 和规范名称组成，与文件名、目录位置和后端主键解耦。
- 名称和别名的规范化规则必须由 Catalog 统一实现，CLI、View 与 Run 不得自行实现另一套匹配逻辑。
- 初期建议采用去除首尾空白后的精确匹配，不引入模糊纠错，避免 Agent 读取错误 Memory。

### 冲突与歧义

- 同一解析范围内出现重复规范名称、重复别名或名称与别名相撞时，`validate` 应报告冲突。
- 在冲突仍然存在时，`read` 必须失败并返回所有候选引用。
- 不采用基于来源的隐式优先级。Catalog 面对的只有标准 Store 中已经生效的实体。
- 预置记忆安装时遇到同名实体，应由 `init` 的人机协同安装策略解决，不能把未解决的碰撞留给运行时读取命令猜测。

## 内部接口要求

不应只在 CLI handler 中拼接两个目录。建议在核心层建立后端无关接口，命令和其他功能统一依赖该接口。

概念接口示例：

```ts
type MemoryDescriptor = {
  reference: string;
  kind: MemoryKind;
  names: string[];
  defines: DefinitionPart[];
};

interface MemoryCatalog {
  list(query: MemoryListQuery): Promise<MemoryListPage>;
  resolve(reference: string, query?: MemoryResolveQuery): Promise<MemoryDescriptor>;
  read(reference: string, query?: MemoryResolveQuery): Promise<MemoryEntity>;
}
```

首个实现可以继续使用文件系统：

```text
FileMemoryCatalog
  - StandardMemoryProvider
```

约束：

- Provider 负责从后端获取候选实体。
- Catalog 负责统一名称、别名、逻辑引用、冲突和排序语义。
- YAML parser 负责把当前文件实现转换为 `MemoryEntity`。
- YAML serializer 负责把 `MemoryEntity` 输出为规范 YAML。
- CLI 不得依赖 `MemoryFile.path` 完成资源解析。

后续 View、Run、Review 引用收集和 validator 应逐步改为依赖 Catalog。这样它们与 CLI 使用相同的实体可见范围和名称解析规则。

## Skill 修改要求（由其他分支交付）

以下修改已由其他分支实现，不属于本次迭代的开发范围；相关分支合入后只需验证 CLI 契约兼容。

统一的 `memsphere` Skill 应把 CLI 作为 Memory 访问边界。

启动内核应明确要求：

1. 使用 `memsphere memory list` 发现当前 scope 的 Memory。
2. 使用 `memsphere memory read <reference>` 读取任务所需的完整 Memory。
3. 根据规范名称、别名和用户目标选择 Memory；存在歧义时先缩小范围或向用户确认。
4. 不使用 `find`、`rg`、`cat`、`sed` 等命令直接搜索或读取 Memory 存储目录。
5. 不读取仓库或 npm package 中的预置记忆源码代替当前 scope 中已安装的 Memory。
6. CLI 读取失败时执行 `memsphere validate`；如发现预置记忆未安装或版本不完整，应进入有用户确认的 `memsphere init` 安装或修复流程，不得自行执行覆盖安装，也不得猜测目录。

Skill 的快速摘要可以告诉 Agent Memory 仍以 YAML 语法呈现，但不得声称 Memory 必然存放在 YAML 文件中。

## 与自举验收的关系（由其他分支交付）

六个首批 self-bootstrap case 都应通过 CLI 访问 Memory：

- Case 001 至 005：Agent 先发现并读取任务明确或隐含指向的业务 Memory，再按照其中的 Concept、Statement 和 Schema 创建、询问或拒绝。
- Case 006：Agent 使用列表中的规范名称和别名识别多个候选 Memory，再按照用户目标选择正确实体。

测试隔离环境应只保证 CLI 能定位当前 scope，不再通过提示词告诉 Agent Memory 的目录位置。

`evals/prepare-case.sh` 应在 baseline 中完成 `memsphere init` 或等价安装，并确保以下命令可用：

```bash
memsphere memory list --output yaml
memsphere memory read <reference>
```

Evaluator 还应检查 Agent 的事件或命令日志：

- 至少调用过一次 `memsphere memory read`。
- 需要候选选择的 case 调用过 `memsphere memory list`。
- 没有直接读取标准 Memory Store 或仓库 `reserved-memory/` 中的文件。

## 错误行为

CLI 至少应区分并稳定表达以下错误：

- 当前目录不属于已初始化的 memsphere scope。
- Memory 不存在。
- 名称或别名存在歧义。
- Memory YAML 无法解析或不符合实体 Schema。
- 当前 scope 的预置记忆安装不完整；该错误由 `validate` 根据安装清单发现，读取命令本身只报告目标 Memory 不存在。
- `--kind` 或 `--output` 参数非法。

错误必须：

- 返回非零退出码。
- 在 stderr 中提供可行动的错误信息。
- 不在 stdout 输出半份 YAML。
- 对歧义错误列出可直接用于下一次 `read` 的候选逻辑引用。
- 不建议 Agent 直接进入目录修复；应指向 `validate`、需要用户确认的 `init` 安装或修复流程，或 Memory 编辑流程。

## 验收标准

### Catalog 单元测试

- 收录标准 Memory Store 中全部可用 Memory，不依赖创建来源。
- 按 kind、规范名称和别名正确过滤与解析。
- 稳定引用不依赖源文件名。
- 名称冲突和别名冲突不会被静默覆盖。
- 列表顺序确定，重复执行结果一致。
- Provider 返回顺序变化不影响 Catalog 结果。

### CLI 集成测试

- `memory list` 默认输出合法 YAML，包含 names、字符串 defines 与 structured_defines 紧凑摘要，不暴露创建来源或物理路径。
- `memory list --kind` 和 `--query` 组合工作正常。
- `memory read` 可通过稳定引用、规范名称和别名读取。
- `memory read` 的 YAML 输出可被当前 parser 再次解析并得到语义等价实体。
- stdout 只包含成功结果，错误只写入 stderr。
- 不存在和歧义场景返回非零退出码及准确候选。
- 从嵌套工作目录执行时仍解析到正确 scope。

### 后端解耦测试

- CLI handler 的测试可以注入内存中的假 Catalog，不需要真实目录。
- 使用非文件 Provider 返回同一 `MemoryEntity` 时，list 和 read 的外部行为不变。
- Skill 和 self-bootstrap case 不包含 Memory 物理路径假设。

### 自举验收

- Codex 和 TraeX 被测 Agent 能只使用统一 memsphere Skill 与 CLI 完成六个首批 case。
- 将测试目录中的 Memory 文件名改为与规范名称无关的值后，Agent 行为不受影响。
- 用测试 Provider 替代文件 Provider 后，无需修改 task prompt 或 Skill 的 Memory 访问规则。

## 建议实施顺序

1. 定义 `MemoryDescriptor`、逻辑引用和名称冲突规则。
2. 建立统一 `MemoryCatalog`，接入标准 Memory Store 的 File Provider。
3. 实现规范 YAML serializer。
4. 实现 `memsphere memory list` 与 `memsphere memory read`。
5. 让 `validate` 使用 Catalog 检查标准 Store 中的名称冲突。
6. 验证现有 init -> reserved 待导入区 -> View 复制导入的边界不受影响。
7. 合入其他分支已完成的统一 Skill、eval baseline 和 evaluator 后验证 CLI 契约兼容。
8. 后续逐步让 View、Run 和 Review 复用 Catalog，消除剩余的存储实现耦合。

## 完成定义

只有同时满足以下条件，本需求才算完成：

- Agent 可以通过 CLI 发现并读取当前 scope 中全部可用 Memory。
- `init` 安装的待导入预置记忆默认不生效；经用户在 View 中导入标准 Memory Store 后才进入 Catalog，且 reserved 原文件保留。
- 当前 scope 中全部 Memory 使用同一套名称和引用规则，CLI 不暴露其创建来源。
- 读取结果保持 memsphere YAML 语义，但不暴露物理存储协议。
- 其他分支交付的唯一 memsphere Skill 不再指导 Agent 直接读取 Memory 文件。
- 其他分支交付的六个首批 self-bootstrap case 可以把 CLI 作为唯一 Memory 读取入口。
- 文件 Provider 可被替换而无需修改 CLI 契约、Skill 或测试任务提示词。
