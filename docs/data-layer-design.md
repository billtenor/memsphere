# Memsphere 数据层设计

> 状态：讨论稿（Draft）
>
> 范围：定义数据层的核心抽象、领域模型机制、扩展接口与职责边界。本文描述设计，不代表现有实现状态；实施分期与迁移步骤由独立实施计划管理。

接口代码与 review 入口见 [src/data](../src/data/README.md)。

## 1. 目标

Memsphere 的数据层不只负责“把值存下来”，还应当回答：

- 这份数据是什么；
- 它遵循哪个领域模型；
- 如何把它的载荷反序列化为可读取的内存对象；
- 如何按领域模型发现和读取字段；
- 如何把步骤产物、文件和领域对象放进同一个数据体系；
- 如何允许业务接入自己的模型定义标准、载荷格式和存储实现。

因此，数据层由三个彼此分离的部分组成：

1. **Data**：稳定的数据身份与封装协议；
2. **Model**：数据的领域语义和可访问逻辑视图；
3. **Storage**：Data 与模型值实例的持久化机制。

## 2. 设计原则

### 2.1 固定最小内核

所有数据统一表达为：

```ts
type Data = {
  id: DataId;
  model: ModelRef;
  payload: Payload;
};
```

Data 统一由 `id`、`model` 和 `payload` 组成。这是数据层公共接口的共同结构；模型定义标准、内容格式和物理存储方式可以扩展。

### 2.2 标准可替换，实现可插拔

- `model` 描述数据的领域含义，以及可以怎样读取它。例如，记账模型定义金额、币种等字段。描述模型所用的标准可以由业务选择，如 JSON Schema 或业务自定义的模型语言，由标准扩展为具体模型创建 ModelRuntime，提供结构描述和字段访问能力。
- `payload` 承载实际内容，由内容格式 `contentType` 和内容本身 `content` 组成。例如，一条记账记录的 JSON 字节。内容格式可以是 JSON、Markdown、JPEG 或业务自定义格式，通过 PayloadSerializer 接入内容字节与内存值之间的转换能力；没有对应解释能力的内容仍可原样保存和读取。
- 存储负责保存和取回数据，可以通过 DataStore 保存已序列化的 Data，也可以通过 ValueStore 直接保存模型的值实例。扩展通过 DataStoreFactory 或 ValueStoreFactory 提供存储实现，Memsphere 根据业务配置创建绑定具体模型的 Store。

扩展接口的具体定义见第 6 节。

### 2.3 能承载，不等于能理解

即使当前运行环境没有某个 ModelRuntime 或 PayloadSerializer，数据层仍应当能够：

- 保存 Data；
- 按业务提供的 `model` 和 `id` 获取 Data；
- 复制或导出原始 Payload；
- 展示 `model` 和 `contentType`；
- 明确报告“当前不能反序列化”或“当前不能按模型读取”。

缺少扩展能力不能使数据损坏，也不能把未知数据误判为非法数据。

### 2.4 模型的管理与解释

模型定义也作为 Data 保存，与业务数据共用身份、读取和持久化机制。例如，记账记录是一条 Data，描述记账字段的模型定义也是一条 Data。

每个模型通过对应的 ModelRuntime 提供结构描述和字段访问能力。业务采用自定义模型语言时，需要安装能解释该语言并创建 Runtime 的标准扩展。加载模型数据本身不会自动加载或执行代码。

## 3. 核心数据协议

### 3.1 Data

```ts
type DataId = string;
type ModelRef = DataId;

type Data = {
  /** 在所属数据空间内稳定且唯一的身份。 */
  id: DataId;

  /** 描述本 Data 领域语义的 Model Data id。 */
  model: ModelRef;

  /** 数据的原始载荷及其表示格式。 */
  payload: Payload;
};
```

三个字段的职责如下：

| 字段 | 回答的问题 |
| --- | --- |
| `id` | 这是哪一条数据？ |
| `model` | 这条数据在领域中是什么意思、怎样访问？ |
| `payload` | 实际内容是什么、字节怎样解释？ |

**Data 是独立可寻址、可持久化、具有自身生命周期的数据单元。**

“独立”是 Data 边界的关键：某个对象只有在需要被单独引用、保存、更新或管理生命周期时，才应成为一条 Data。Model 可以描述比 Data 更细的嵌套领域类型；存在 Model Definition，不等于该类型的每个实例都必须独立持久化为 Data。

例如，订单模型可以描述订单明细的商品、数量和单价。若明细随订单一起保存和删除，就放在订单的 Payload 中，不需要为每条明细创建独立的 Data。程序仍可根据模型，通过反射取得明细列表中的第一条明细，再读取它的数量字段。

在采用 DDD 的业务中，二者通常这样对应：

| DDD 概念 | 数据层表达 | 身份与生命周期 |
| --- | --- | --- |
| 聚合根 | 通常是一条独立 Data | 具有全局 `DataId` 和独立生命周期 |
| 聚合内子实体 | Data Payload 内的嵌套结构 | 可以有聚合内局部身份，生命周期从属于聚合根 |
| 值对象 | Data Payload 内的嵌套值 | 没有身份，按值判断相等，生命周期从属于拥有者 |
| 跨聚合引用 | 指向另一条 Data 的引用 | 由业务确定目标模型，按 `DataId` 读取 |

在上面的订单例子中，订单是聚合根，对应一条 Data；订单明细是子实体，可以有订单内的局部 id；明细的单价是 `Money` 值对象，包含金额和币种，没有独立身份。明细和单价都保存在订单的 Payload 中，生命周期从属于订单。程序可通过订单的 `DataId` 读取订单，再通过反射访问其中的明细和单价；嵌套位置不赋予它们独立的 Data 身份。

### 3.2 Payload

Payload 承载实际内容及其格式，将文档、图片和结构化数据等统一表示为带格式说明的字节内容。

```ts
type Payload = {
  /** 内容类型，使用标准 MIME 类型，例如 application/json、image/jpeg。 */
  contentType: string;
  /** 与物理存储位置无关的内容读取接口。 */
  content: PayloadContent;
};

interface PayloadContent {
  /** 每次调用都返回一条从内容起点开始读取的新流。 */
  stream(): ReadableStream<Uint8Array>;
}
```

`contentType` 描述内容的格式及解释方式，取值沿用标准 MIME 类型；`content` 提供统一的内容读取能力，但不暴露字节存放在哪里。

`content.stream()` 每次打开同一内容的新流。调用者通过流读取内容，实际存储方式由 DataStore 决定。

需要一次性读取完整内容时，可使用 `readAll()` 将流中的字节合并为一个 `Uint8Array`：

```ts
const bytes = await readAll(context, content.stream());
```

`readAll()` 需支持取消和读取大小上限，避免无限制地将内容加载到内存。

### 3.3 Model

Model 描述的是一条 Data 的**领域语义和可访问逻辑视图**，包括：

- 数据代表哪类领域对象；
- 值实例暴露哪些字段或节点；
- 字段的名称、说明、基数和逻辑类型；
- 字段是否引用另一条 Data；
- 字段之间如何组成可遍历的结构。

从持久化中加载模型定义时，Model Data 的 Payload 被 Serializer 反序列化后，形成运行时的 `Model<TDefinition>`：

```ts
interface Model<TDefinition = unknown> {
  /** 保存这份模型定义的 Data。 */
  readonly data: Data;

  /** Model Payload 反序列化后的模型定义内存对象。 */
  readonly definition: TDefinition;
}
```

`TDefinition` 表示模型定义的内存类型，例如 JSON Schema 对应的对象类型。内置元模型的定义可由扩展直接提供已解码的创建输入，供 Memsphere 初始化其 Runtime。

## 4. 模型定义、模型定义标准与 ModelRuntime

### 4.1 模型定义标准：规定模型定义怎么写

订单模型是一种模型定义，它描述订单有哪些字段。模型定义标准则规定如何书写这些字段的定义。

例如，用 JSON Schema 定义“订单包含明细列表，每条明细有一个数值类型的数量字段”（省略其他字段）：

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "quantity": { "type": "number" }
        }
      }
    }
  }
}
```

这份定义中的业务字段名 `items` 和 `quantity` 由订单模型决定；`type`、`properties` 以及描述列表元素的 `items` 关键字及其含义，由 JSON Schema 标准规定。一条对应的订单数据是 `{"items":[{"quantity":2}]}`。

业务可以采用 JSON Schema，也可以采用自己的模型描述语言。模型定义标准回答“怎样定义字段和类型”；Payload 的 `contentType` 回答“内容按什么格式序列化”。例如，`application/json` 只说明内容是 JSON，并不说明其中的 `properties` 应当被理解为字段定义。

### 4.2 ModelRuntime：提供具体模型的结构与访问能力

ModelRuntime 绑定一个具体模型。例如，订单模型的 Runtime 描述订单、明细、数量等结构，并为具体订单提供反射操作能力：

```ts
interface ModelRuntime {
  /** 当前模型的结构描述。 */
  readonly descriptor: Descriptor;

  /** 为模型的值实例创建反射操作对象。 */
  reflect(value: unknown): Value;
}
```

Runtime 已绑定 Descriptor，调用 `reflect()` 时只需传入值实例。`unknown` 表示调用时不预设其 TypeScript 类型；Runtime 仍须检查值实例是否具有可操作的模型结构。

### 4.3 Descriptor 与 Value：类型描述和值实例操作

Descriptor 提供模型的类型和字段信息，Value 提供针对具体值实例的反射操作。

`TDefinition` 和 `TValue` 分别表示模型定义和值实例的内存类型；`Descriptor` 和 `Value` 分别提供结构描述和值实例操作能力：

| 概念 | 含义 | 订单例子 |
| --- | --- | --- |
| `TDefinition` | 模型定义的内存类型 | 包含 `type`、`properties` 等内容的 JSON Schema 对象类型 |
| `Descriptor` | 解释模型定义后得到的结构描述，可供多个值实例共用 | 查询到订单有明细列表，明细的 `quantity` 是数值类型 |
| `TValue` | 值实例的内存类型 | 订单对象的类型，其值例如 `{"items":[{"quantity":2}]}` |
| `Value` | `runtime.reflect(value)` 创建的反射操作对象，绑定一个具体值实例 | 读取或修改这条订单第一条明细的数量 |

### 4.4 根据模型定义创建 Runtime

模型定义自身也是 Data。它的 `model` 指向元模型，即描述模型定义的模型。JSON Schema Draft-07 对应的元模型标识为 `json-schema/draft-07`。

```text
order-001                  一条订单数据的 ID
  model -> order-model

order-model                订单模型的 ID
  model -> json-schema/draft-07
```

业务或模型配置提供订单模型 ID `order-model` 及其元模型 ID `json-schema/draft-07`。系统加载订单模型定义，按照该元模型对应的 JSON Schema 标准解释定义，创建订单模型的 Runtime。

### 4.5 ModelRuntimeRegistry：按模型 ID 管理 Runtime

ModelRuntimeRegistry 是数据空间内的 Runtime 注册表，负责登记和查询已创建的 Runtime：

```ts
interface ModelRuntimeRegistry {
  register(runtime: ModelRuntime): void;
  get(ref: ModelRef): ModelRuntime | undefined;
}
```

`register()` 按 `runtime.descriptor.id` 登记；`registry.get("order-model")` 返回已登记的订单 Runtime。未登记时返回 undefined，这不表示模型数据不存在。Memsphere 数据层负责加载模型、调用 Factory 创建 Runtime，并登记到 Registry；业务无需手工组织这些步骤。

创建一个模型的 Runtime 时，通过 Registry 查询已准备好的依赖 Runtime。

## 5. Data 的持久化

数据层提供两种持久化方式：DataStore 保存已序列化的 Data，ValueStore 直接保存模型的值实例。每个 Store 实例通过 `model` 绑定一个具体模型，只存取该模型的数据。

### 5.1 DataStore：保存和读取完整 Data

调用方先确定 `id` 和 `model`，将值实例序列化为 Payload，组成完整的 Data，再交给绑定该模型的 DataStore 保存。已有 Payload 的文件等产物可以直接组成 Data。DataStore 检查 `data.model` 与自身的 `model` 一致，不匹配时拒绝写入。

接口及相关类型如下，其中 UpdateOptions、DeleteOptions、ListOptions 和 ListResult 由两种 Store 共用：

```ts
interface DataStore {
  readonly kind: "DataStore";
  /** 此 Store 唯一绑定的模型。 */
  readonly model: ModelRef;

  get(context: Context, id: DataId): Promise<StoredData | undefined>;
  has(context: Context, id: DataId): Promise<boolean>;
  create(context: Context, data: Data): Promise<StoredData>;
  update(
    context: Context,
    data: Data,
    options?: UpdateOptions,
  ): Promise<StoredData>;
  delete(
    context: Context,
    id: DataId,
    options?: DeleteOptions,
  ): Promise<boolean>;
  list(context: Context, options?: ListOptions): Promise<ListResult>;
}

type UpdateOptions = {
  /** 预期的当前记录版本，必须为正整数。 */
  expectedRevision?: number;
};

type DeleteOptions = {
  /** 预期的当前记录版本，必须为正整数。 */
  expectedRevision?: number;
};

type ListOptions = {
  /** 本页最多返回的条数。 */
  limit?: number;
  /** 上一页返回的续查游标。 */
  cursor?: string;
};

type ListResult = {
  items: Array<{ id: DataId }>;
  /** 存在时可继续翻页；缺省表示枚举结束。 */
  nextCursor?: string;
};
```

DataStore 保存四项信息：

- `id`：数据的身份，用于后续查询和更新；
- `model`：描述这条数据的模型 ID；
- `payload.contentType`：内容格式；
- `payload.content`：通过流读取的内容字节。

例如，订单的 `id` 为 `order-001`，`model` 为 `order-model`，Payload 保存 `application/json` 和 `{"items":[{"quantity":2}]}` 的 JSON 字节。`id` 和 `model` 随 Data 一起保存，不需要放进订单的 JSON 内容中。

DataStore 保存成功或按 ID 读到记录时，返回 StoredData。其中的 `data` 保留完整的模型 ID、内容类型和内容字节；其余字段是存储管理信息：

```ts
type StoredData = {
  /** 完整 Data，包含 id、model 和 payload。 */
  data: Data;
  /** 该存储记录的版本，用于并发更新检查。 */
  revision?: number;
  /** 该记录的创建时间，Unix 时间戳，单位为毫秒。 */
  createdAt?: number;
  /** 创建该记录的操作主体 ID。 */
  createdBy?: string | null;
  /** 该记录的最近更新时间，Unix 时间戳，单位为毫秒。 */
  updatedAt?: number;
  /** 最近一次成功更新该记录的操作主体 ID。 */
  updatedBy?: string | null;
};
```

DataStore 不负责解释模型或反序列化内容。Data 的各项信息可以保存在同一条数据库记录中，也可以由实现分别存放；对调用方始终是一条完整 Data 的存取。

### 5.2 ValueStore：直接保存和读取值实例

ValueStore 接收 `id` 和值实例，使用自身绑定的模型完成存储映射。

```ts
interface ValueStore {
  readonly kind: "ValueStore";
  /** 此 Store 唯一绑定的模型。 */
  readonly model: ModelRef;

  get(context: Context, id: DataId): Promise<StoredValue | undefined>;
  has(context: Context, id: DataId): Promise<boolean>;
  create(
    context: Context,
    id: DataId,
    value: unknown,
  ): Promise<StoredValue>;
  update(
    context: Context,
    id: DataId,
    value: unknown,
    options?: UpdateOptions,
  ): Promise<StoredValue>;
  delete(
    context: Context,
    id: DataId,
    options?: DeleteOptions,
  ): Promise<boolean>;
  list(context: Context, options?: ListOptions): Promise<ListResult>;
}
```

UpdateOptions、DeleteOptions、ListOptions 和 ListResult 复用第 5.1 节的定义。

例如，`orderStore` 是绑定 `order-model` 的 ValueStore，创建订单时可以直接提交订单对象：

```ts
await orderStore.create(context, "order-001", {
  items: [{ quantity: 2 }],
});
```

ValueStore 可以把订单和明细映射为数据库表，也可以保存为文档记录。保存成功或按 ID 读到记录时，返回 StoredValue：

```ts
type StoredValue = {
  /** 数据的身份。 */
  id: DataId;
  /** 模型的值实例，可交给对应 Runtime 的 reflect() 使用。 */
  value: unknown;
  /** 该存储记录的版本，用于并发更新检查。 */
  revision?: number;
  /** 该记录的创建时间，Unix 时间戳，单位为毫秒。 */
  createdAt?: number;
  /** 创建该记录的操作主体 ID。 */
  createdBy?: string | null;
  /** 该记录的最近更新时间，Unix 时间戳，单位为毫秒。 */
  updatedAt?: number;
  /** 最近一次成功更新该记录的操作主体 ID。 */
  updatedBy?: string | null;
};
```

这里保存的是 `TValue` 所表示的值实例，不是反射操作对象 `Value`。调用方不需要构造 Payload；内部编码和字段映射由 ValueStore 实现负责，可以复用 Serializer。例如文件型 ValueStore 在内部使用 JSON 编码，对外仍直接读写值实例。

ValueStore 不保存原始 Payload 的格式和字节。需要导出为 Data 时，由调用方选择内容类型，通过 PayloadSerializer 序列化值实例，再与记录的 `id` 和 `store.model` 组成 Data。

### 5.3 StoreRegistry：按模型 ID 管理 Store

StoreRegistry 管理当前数据空间中已创建的 Store，按模型 ID 登记和查询：

```ts
interface StoreRegistry {
  register(store: DataStore | ValueStore): void;
  get(model: ModelRef): DataStore | ValueStore | undefined;
}
```

`register()` 按 `store.model` 登记，同一模型只能登记一个 Store，重复登记时报错。`get()` 未找到时返回 undefined。Memsphere 数据层根据存储绑定配置调用 Factory 创建 Store，并负责登记和复用；Registry 只保存和查询实例。`store.kind` 区分 DataStore（`"DataStore"`）和 ValueStore（`"ValueStore"`）。

业务访问数据时提供 `model` 和 `id`：Memsphere 取得该模型已准备好的 Store，再按 `id` 存取。跨数据引用同样由业务提供目标模型，数据层不维护 `DataId → Model` 索引，也不跨 Store 搜索。

### 5.4 身份与记录版本

数据的 `id` 由调用方提供，`model` 由 Store 的绑定确定。DataStore 保留完整 Data 的三元组；StoredValue 的所属模型通过 `store.model` 取得。一次保存成功后，读取到的身份、模型和内容必须属于同一次提交。

`revision`、`createdAt`、`createdBy`、`updatedAt` 和 `updatedBy` 均为可选字段，由对应 Store 管理，不进入 Data 或业务值实例。Store 不支持或无法取得某项信息时，可以省略该字段，不影响数据读写。`revision` 是该 Store 中的记录版本，不是模型版本。

`createdBy` 和 `updatedBy` 根据可信调用身份记录，操作主体可以是用户、Agent 或系统服务。身份未知时，除省略字段外，也允许返回 `null`。已记录的 `createdAt` 和 `createdBy` 在更新时保留；`updatedBy` 随每次成功更新重新记录，身份未知时省略或置为 `null`，不沿用上一次更新者。

### 5.5 基础存取与分页列表

DataStore 和 ValueStore 提供相同的基本操作，区别在于存取的是完整 Data 还是值实例：

| 操作 | 含义 |
| --- | --- |
| `get` | 按 ID 读取记录，不存在时返回 undefined |
| `has` | 按 ID 检查记录是否存在 |
| `create` | 创建记录，ID 已存在时报错，不覆盖已有记录 |
| `update` | 按 ID 整条更新已有记录，ID 不存在时报错，不创建记录 |
| `delete` | 按 ID 删除记录，返回是否实际删除 |
| `list` | 分页列举当前 Store 所绑定模型的记录 |

列表项只包含 `id`，所属模型由 `store.model` 确定，需要完整内容时再调用 `get`。枚举不解释 Payload 或业务字段；其效率取决于 Store 的存储布局和索引，分页本身不保证避免全量扫描。

`limit` 必须为正整数，Store 声明默认值和允许的上限。游标由 Store 生成，调用方原样传回，只能用于同一个 Store；无效或过期时明确报错。是否结束以 `nextCursor` 为准，而不是当前页的条数。

数据不变且游标有效时，连续翻页应完整、不重复地枚举当前 Store 的记录。并发修改时不保证跨页快照；基础列表不提供总数、任意排序或业务字段过滤。

`update` 替换完整 Data 内容或完整值实例，不做字段合并。`expectedRevision` 可选，仅用于检查当前记录版本，必须为正整数；指定版本不匹配时报冲突，省略时仍要求记录存在。`delete` 不带版本条件且记录不存在时返回 false，带条件时记录不存在或版本不匹配均报冲突。

创建不得覆盖已有记录。Store 支持版本条件时，条件检查与对应写入或删除必须在其声明的并发范围内原子执行，不能用调用方先 `has()` 再写入的方式代替；不支持版本条件时应明确报错。无版本条件的更新与删除竞争由实现说明，例如文件 DataStore 使用无锁原子替换，不提供存在性检查与替换之间的事务保证。删除成功只表示源记录已删除，不表示业务读视图已同步。

### 5.6 业务读视图：自定义查询

业务读视图负责基础列表之外的查询，自行定义查询参数、结果模型和索引。例如，订单列表视图按客户、状态和金额筛选排序，销售统计视图跨订单与明细进行关联和聚合。跨模型查询也由业务读视图组织，不扩展为单个 Store 的通用查询语言。

读视图可以直接查询同一数据库，也可以使用独立的物化表、搜索索引等结构。具体视图需说明数据来源、更新何时可见、删除如何同步以及如何重建。独立维护的视图需要可靠的变更来源（包含删除），或采用重建方式；可选的 `revision` 和时间戳不能作为保证完整增量同步的依据。

这种划分借鉴 [CQRS（命令与查询职责分离）](https://martinfowler.com/bliki/CQRS.html) 的读模型思想：存取模型与查询模型可以分别设计。CQRS 是架构模式，不是接口标准；这里采用基础 CRUD 与业务读视图，不要求独立读写数据库或事件溯源。

## 6. 扩展机制

### 6.1 PayloadSerializer：自定义 Payload 格式的序列化与反序列化

```ts
interface PayloadSerializer<TValue = unknown> {
  /** 扩展内稳定的 serializer 标识，用于诊断和冲突检测。 */
  readonly id: string;

  /** 该 Serializer 处理的 MIME 类型。 */
  readonly contentType: string;

  deserialize(
    context: Context,
    descriptor: Descriptor,
    content: PayloadContent,
  ): Promise<TValue>;

  serialize(
    context: Context,
    descriptor: Descriptor,
    value: TValue,
  ): Promise<PayloadContent>;
}
```

每个 Serializer 对应一个 contentType，序列化输出采用该内容类型。注册与选择按规范化后的 MIME 类型精确匹配，仅忽略不影响内容解释的参数差异。同一类型重复注册时报错。

Serializer 根据 Descriptor，在序列化形态与内存形态之间转换，例如：

```text
application/json  <-> JavaScript value
text/markdown     <-> string
image/jpeg        <-> image runtime object（可选）
```

`TValue` 表示反序列化后值实例的内存类型。两个方法的输入输出关系如下：

```text
Descriptor + PayloadContent  --deserialize--> TValue
Descriptor + TValue          --serialize----> PayloadContent
```

`descriptor` 提供模型身份及内存结构，Serializer 可据此检查值与格式的兼容性。额外的格式专属信息由 Serializer 实现持有，不放入公共反射接口。

### 6.2 ModelRuntimeFactory：自定义模型定义标准的解释与 Runtime 创建

ModelRuntimeFactory 提供创建 Runtime 的能力。Factory 可以专门为一个模型创建 Runtime，也可以解释同一标准下的多份模型定义，为它们分别创建 Runtime。

```ts
type ModelRuntimeFactoryTarget =
  | { readonly model: ModelRef; readonly metaModel?: never }
  | { readonly metaModel: ModelRef; readonly model?: never };

interface ModelRuntimeFactory<TDefinition = unknown> {
  /** 按具体模型或模型定义标准匹配，二者选一。 */
  readonly target: ModelRuntimeFactoryTarget;

  createRuntime(
    context: Context,
    model: Model<TDefinition>,
    registry: ModelRuntimeRegistry,
  ): Promise<ModelRuntime>;
}
```

`target` 声明 Factory 处理的对象：

- `{ model: "json-schema/draft-07" }`：专门创建这个元模型的 Runtime，用于描述和操作 JSON Schema 模型定义。
- `{ metaModel: "json-schema/draft-07" }`：解释采用 JSON Schema 编写的订单等模型定义，创建对应业务模型的 Runtime。

这是两个不同的 Factory 实现，都使用同一个 `createRuntime()` 接口。Memsphere 优先匹配具体模型 ID；没有专用 Factory 时，才按元模型 ID 选择通用 Factory。同一模型的专用 Factory 与其标准的通用 Factory 可以同时注册。

`TDefinition` 是 Factory 接收的模型定义的内存类型。Memsphere 提供已解码的 Model；Factory 检查定义是否符合自己支持的标准，泛型不能替代运行时检查。返回 Runtime 的 `descriptor.id` 必须等于 `model.data.id`。

Factory 通过 Registry 查询已登记的外部依赖 Runtime，用其 Descriptor 组织字段结构，并在创建的 Runtime 中保留依赖的反射访问能力。依赖未登记时报告依赖未就绪；依赖准备、Factory 调用及返回结果的登记由 Memsphere 组织。

读取依赖字段时，把该字段的值交给依赖 Runtime 的 `reflect()`。定义内部的局部类型由 Factory 自己处理。Factory 实现负责提供符合公共接口的 Descriptor 和 Value，可以复用已有实现，无需将它们单独注册为扩展。

### 6.3 DataStoreFactory：自定义 Data 持久化

DataStoreFactory 根据模型 ID 和存储配置，创建符合第 5.1 节接口的 DataStore。同一个 Factory 可以为不同模型创建各自的 Store。

```ts
interface DataStoreFactory {
  /** 存储实现的稳定标识，例如 memsphere/filesystem。 */
  readonly id: string;

  createStore(
    context: Context,
    model: ModelRef,
    config: Config,
  ): Promise<DataStore>;
}
```

DataStore 不解释内容，创建时只需 ModelRef，不需要 ModelRuntime。返回 Store 的 `model` 必须等于传入的模型 ID。`config` 使用第 7.2 节的 Config 封装目录、连接等实现专属参数。

### 6.4 ValueStoreFactory：自定义值实例持久化

ValueStoreFactory 根据模型 Runtime 和存储配置，创建符合第 5.2 节接口的 ValueStore。

```ts
interface ValueStoreFactory {
  /** 存储实现的稳定标识，例如 acme/order-database。 */
  readonly id: string;

  createStore(
    context: Context,
    runtime: ModelRuntime,
    config: Config,
  ): Promise<ValueStore>;
}
```

Factory 可通过 `runtime.descriptor` 获取模型结构，通过 `runtime.reflect()` 操作值实例。返回 Store 的 `model` 必须等于 `runtime.descriptor.id`，不再重复传入模型 ID。

ValueStore 实现负责值实例与存储结构的映射，以及恢复与 Runtime 兼容的值实例；不支持某种结构或值类型时，应明确报错。

### 6.5 DataExtension：扩展的组织与注册

DataExtension 是扩展向 Memsphere 提供的能力清单。扩展提供实现，Memsphere 负责注册、选择实现以及创建和管理实例。

```ts
interface DataExtension {
  /** 全局稳定的扩展 id。 */
  readonly id: string;
  readonly version: string;

  readonly payloadSerializers?: readonly PayloadSerializer[];
  readonly modelRuntimeFactories?: readonly ModelRuntimeFactory[];
  readonly dataStoreFactories?: readonly DataStoreFactory[];
  readonly valueStoreFactories?: readonly ValueStoreFactory[];
}
```

四个字段分别提供内容格式、模型解释、Data 持久化和值实例持久化的扩展能力。模型 Runtime 和绑定具体模型的 Store 由 Memsphere 调用 Factory 创建，分别保存在 ModelRuntimeRegistry 和 StoreRegistry 中。

内置实现与业务实现使用相同的 DataExtension 接口。内置扩展按单个可独立替换的 Serializer 或 Factory 拆分，各自拥有独立的扩展 ID。例如，JSON Serializer、JSON Schema 业务模型的 Factory、文件系统 DataStoreFactory、文件系统 JSON ValueStoreFactory 分别作为独立扩展。内部辅助类和共用代码可以复用，不需要各自成为扩展；DataExtension 仍允许业务扩展组合多个实现。

已实现扩展的配置、用法及支持范围见[内置扩展说明](../src/data/extensions/README.md)。框架的自动装配与元模型引导流程仍待实现。

默认装配维护这些独立扩展的列表。替换某项内置能力时，在注册前移除对应扩展并加入替代扩展，保留其他扩展；若 Store Factory 的 ID 改变，同时调整对应存储绑定。替换后的组合仍须满足依赖和兼容性要求，注册冲突不通过加载顺序覆盖。

这里的替换发生在初始化装配阶段，不隐含已创建 Runtime、Store 的热替换或存量数据迁移。

Memsphere 安装扩展时收集上述实现，并检查注册冲突：

- `DataExtension.id + version` 唯一；
- `PayloadSerializer.contentType` 不冲突；
- ModelRuntimeFactory 的 `target` 只指定一种匹配方式，同一种匹配方式下的模型 ID 不冲突；
- DataStoreFactory 的 `id` 在 DataStoreFactory 中唯一，ValueStoreFactory 的 `id` 在 ValueStoreFactory 中唯一。

完成注册后，Memsphere 根据模型和存储绑定配置组织第 8 章的准备流程。Factory 负责创建并返回实例，Registry 负责保存和查询实例，业务无需手工调用 Factory 或登记 Registry。缺少所需扩展或存在配置错误时，Memsphere 明确报错，不自动换用其他实现。

## 7. 通用类型与反射接口

### 7.1 Context：通用运行上下文

所有可取消的异步扩展操作共享一个最小运行上下文：

```ts
interface Context {
  /** 上游取消当前操作时发出的停止通知。 */
  readonly signal?: AbortSignal;
}
```

所有接收 Context 的函数都将 `context` 放在第一个参数。同一次操作沿用同一个 Context，将取消通知传递给模型加载、解析和内容读取过程。

### 7.2 Config：JSON 配置的统一封装

配置采用 JSON 对象表示。Config 将该对象封装为稳定的参数类型，供 Factory 接收：

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

type JsonObject = {
  [key: string]: JsonValue;
};

class Config {
  constructor(public readonly json: JsonObject) {}
}
```

Memsphere 解析 JSON 配置、检查顶层为对象，并用 `new Config(json)` 包装后传给 Factory。Factory 通过 `config.json` 读取字段，自行定义和检查必填项、可选项、类型及默认值。默认值用于字段缺失的情况，`false`、`0`、空字符串和 `null` 不因其取值而被当成缺失。

框架不规定配置读取 API，也不绑定配置库。后续可扩展 Config 的能力，而不改变 Factory 的配置参数类型。

### 7.3 Descriptor 与 Value：内存结构与反射操作

反射协议只有 object、array、scalar、map 四种基础结构，不涉及序列化与反序列化。详细契约及使用导读见 [src/data](../src/data/README.md)，接口见 [reflection.ts](../src/data/api/reflection.ts)。

- ObjectDescriptor 描述字段名称、类型及 `additionalProperties` 动态字段，ObjectValue 提供字段存在性、读写、删除与遍历。
- ArrayDescriptor 描述同类型元素，ArrayValue 提供元素读写、插入、删除与遍历。
- ScalarDescriptor 描述 null、boolean、number、string、bigint、bytes，可关联字符串或数值枚举；ScalarValue 整体读写实际值。枚举成员名与实际值分离，closed 只接受已声明值，open 还允许同类型的未声明值。
- MapDescriptor 描述键与值的类型，MapValue 提供条目操作，返回原始键和子 Value。键不转换、复制，按 SameValueZero 比较：基本值按值，对象和字节按身份；内存表示不必是原生 JS Map。

Descriptor 的 `id` 用于 Runtime 注册和 Store 绑定，`root` 描述根类型。根类型与嵌套类型使用相同的 TypeDescriptor；`runtime.reflect(value)` 直接返回相应的 Value，视图的 `descriptor` 指向 `runtime.descriptor.root`。

tuple、Record、Set 不另设基础类型；集合可表达为 `Map<T, null>`，不承诺原生 JS Set 适配。枚举附着于标量，不增加 Value 种类或通用约束语言。

undefined 只表示缺失，不是标量；显式 null 是有效值，读取不合成默认值。子 Value 的修改直接反映到父值；`Value.value` 提供当前原始值实例，持久化仍通过 Store 完成。自定义模型定义标准由 ModelRuntime 适配到这套结构与操作协议，不改变公共读写语义。

### 7.4 路径访问与查询：基于反射的扩展能力

路径访问与查询建立在 Descriptor 和 Value 的基础反射能力之上，通过扩展提供。JSONPath 可以作为其中一种实现，数据层核心不固定查询语言。查询扩展的接口、注册方式和返回结果形式另行设计。

这里的查询面向值实例内部的结构；存储层的业务查询由第 5.6 节的业务读视图承担。

跨 Data 引用需要显式解引用并检查权限。目标模型由模型声明或业务确定，Memsphere 根据模型和 ID 取得对应 Store，再读取目标数据；查询不隐式跨越 Data 边界。

### 7.5 Serializer、ValueStore 与 Runtime 的兼容性

公共 Descriptor 只提供模型身份和内存结构。Serializer 检查结构与值能否由自身格式表达；需要额外格式信息时，由扩展自己的配置或模型上下文提供，不通过反射字段承载。信息不足或不兼容时明确报错。

Serializer、ValueStore 与 Runtime 还需约定一致的值实例表示，例如 bigint、字节数组，以及字段缺失与 null 的区别。ValueStore 负责恢复与 Runtime 兼容的值实例，跨标准组合也需检查结构与值表示是否兼容。

## 8. Memsphere 的 Runtime 与 Store 准备流程

### 8.1 Runtime 的注册与构建

Memsphere 在确定的模型版本或快照范围内创建和复用 Runtime，并将完成的实例登记到 Registry。同一模型 ID 重复注册时报错；同一快照复用 Runtime 和 Descriptor，保证字段归属检查一致。模型及其依赖变化时，由 Memsphere 组织重建和更新。

无环依赖按依赖顺序创建并注册。类型图仍需支持递归结构；跨标准依赖的发现协议，以及跨模型循环依赖的分阶段构建、占位连接和发布方式见待决问题。

### 8.2 准备模型 Runtime

Memsphere 在反射访问值实例前准备并注册所需的 Runtime。业务或模型配置提供模型 ID 与元模型 ID；业务无需自行加载模型或调用 Factory。

元模型的 Runtime 也由 Factory 创建。Memsphere 使用标准扩展提供的已解码内置定义，调用匹配该元模型 ID 的专用 Factory，再登记返回的 Runtime。这一步不经过依赖该 Runtime 的反序列化流程；内置创建输入的提供方式及元信息表示见第 13 章待决问题。

本例的订单模型定义保存在绑定 `json-schema/draft-07` 的 DataStore 中，订单值实例则由绑定 `order-model` 的 Store 保存。

以尚未登记的 `order-model` 为例，普通无环依赖的准备过程如下：

1. 按第 8.3 节准备绑定 `json-schema/draft-07` 的 DataStore，再通过 `get(context, "order-model")` 加载模型定义的 Data，并检查其 ID 和元模型与请求一致。
2. 准备或复用 `json-schema/draft-07` 的 Runtime，使用它的 Descriptor 和匹配模型 Payload.contentType 的 Serializer，反序列化订单模型定义，组成 Model。
3. 准备并注册订单模型依赖的其他 Runtime。
4. 优先选择 `target.model` 为 `order-model` 的 Factory；没有专用 Factory 时，选择 `target.metaModel` 为 `json-schema/draft-07` 的 Factory，调用 `createRuntime(context, model, registry)`。
5. 检查返回 Runtime 的模型 ID，再调用 `registry.register(runtime)` 登记并复用。

### 8.3 根据模型绑定创建 Store

存储绑定配置指定模型、Store 类型、Factory 标识及该实现所需的配置。例如：

```json
{
  "model": "order-model",
  "kind": "DataStore",
  "factory": "memsphere/filesystem",
  "config": {
    "directory": "./data/orders"
  }
}
```

Memsphere 按 `kind` 和 `factory` 选择已注册的 Factory，将 `config` 包装为 Config：

- DataStore：调用 `createStore(context, model, config)`，不要求先准备模型 Runtime。
- ValueStore：先准备该模型的 Runtime，再调用 `createStore(context, runtime, config)`。

创建成功后，Memsphere 检查 Store 的 `kind` 和 `model` 与绑定配置一致，再调用 `storeRegistry.register(store)` 登记并复用。同一个 Factory 可服务多个模型；同一数据空间内，一个模型仍只绑定一个 Store。缺少绑定或 Factory 时报告配置错误。

## 9. 读取流程

### 9.1 从 DataStore 读取

业务提供 `model` 和 `id`，Memsphere 按第 8 章完成所需 Store 和 Runtime 的准备，再读取数据：

1. 取得绑定该模型的 DataStore，调用 `get(context, id)` 得到 StoredData，并取出其中的 Data。
2. 按 `data.payload.contentType` 选择 Serializer，调用 `deserialize(context, runtime.descriptor, data.payload.content)` 得到值实例。
3. 调用 `runtime.reflect(value)` 得到 Value，供基础反射操作或查询扩展使用。

Context 传递到反序列化和流读取，取消时释放读取资源。

### 9.2 从 ValueStore 读取

Memsphere 准备好业务指定模型的 ValueStore 和 Runtime 后，再按 `id` 读取：

1. 调用 `valueStore.get(context, id)` 得到 StoredValue，其中的 `value` 已是值实例，无需反序列化。
2. 调用 `runtime.reflect(stored.value)` 得到 Value，供基础反射操作或查询扩展使用。

两种读取流程在记录不存在时明确报告未找到，不继续反射访问。

## 10. 写入流程

运行步骤产出值实例后，由业务确定数据的 `model`、`id` 以及创建或更新的操作意图。Memsphere 按第 8 章准备并取得该模型的 Store，再按其 `kind` 选择对应的写入路径。缺少存储绑定或所需扩展时明确报错，不擅自选择其他存储实现。

### 10.1 写入 DataStore

1. Memsphere 按第 8.2 节准备模型 Runtime，并选择 PayloadSerializer。
2. 调用 `serialize(context, runtime.descriptor, value)` 得到 PayloadContent，以 Serializer 的 `contentType` 组成 Payload。
3. 与 `id`、`model` 组成 Data；新增时调用 `dataStore.create(context, data)`，更新已有记录时调用 `dataStore.update(context, data, options)`。

已有 Payload 的文件等产物可直接从第 3 步开始，无需先反序列化再序列化。

### 10.2 写入 ValueStore

新增时调用 `valueStore.create(context, id, value)`，更新已有记录时调用 `valueStore.update(context, id, value, options)`。由取得的 ValueStore 按照绑定的模型完成值实例到存储结构的映射。

保存成功后，业务在 Run 产出记录或产出绑定中保留数据的 `model` 和 `id`，供后续读取定位 Store 和记录。

## 11. Artifact 如何进入 Data 抽象

Artifact 不是与 Data 并列的持久化对象，而是一种领域模型。

```text
artifact-001
  model -> memsphere/artifact@1
  payload -> Artifact 的结构化字段以及产出 Data 引用（model + id）

output-001
  model -> 某个具体结果模型
  payload -> contentType + PayloadContent
```

这样可以区分：

- **Artifact**：某个 Run step 的交付物、来源、说明和关联关系；
- **Output Data**：实际生成的文本、文件、图片或领域对象。

## 12. 示例

### 12.1 JSON 领域对象

```ts
const entry: Data = {
  id: "bookkeeping-entry-001",
  model: "bookkeeping/entry@1",
  payload: {
    contentType: "application/json",
    content: contentFromBytes(/* UTF-8 JSON bytes */),
  },
};
```

`bookkeeping/entry@1` 的 Payload 可以是 JSON Schema。系统据此发现 `amount` 对象及其 `value`、`currency` 子字段，并通过反射读取对应的值。

### 12.2 图片

```ts
const image: Data = {
  id: "receipt-image-001",
  model: "core/image",
  payload: {
    contentType: "image/jpeg",
    content: contentFromStream(() => openReceiptImageStream()),
  },
};
```

`contentFromStream` 接收流工厂，每次调用都重新打开同一份图片内容。

`core/image` 可以只将整张图片作为不透明值，也可以进一步描述宽、高、色彩空间等可读取逻辑字段。JPEG 负责表示，`core/image` 负责领域含义；两者不是同一个概念。

### 12.3 业务自定义模型定义标准

一个扩展可以注册：

```ts
const extension: DataExtension = {
  id: "acme/domain-data",
  version: "1.0.0",
  payloadSerializers: [acmeDslSerializer],
  modelRuntimeFactories: [
    acmeMetaModelRuntimeFactory,
    acmeDomainModelRuntimeFactory,
  ],
  dataStoreFactories: [fileDataStoreFactory],
  valueStoreFactories: [orderValueStoreFactory],
};
```

其中：

- `acmeDslSerializer` 把 `application/vnd.acme.model+yaml` 反序列化为运行时定义；
- `acmeMetaModelRuntimeFactory.target` 为 `{ model: "acme/domain-model-language@1" }`，创建该元模型的 Runtime，描述该语言的模型定义结构；
- `acmeDomainModelRuntimeFactory.target` 为 `{ metaModel: "acme/domain-model-language@1" }`，解释该语言编写的模型定义，创建具体模型的 Runtime；
- `fileDataStoreFactory` 和 `orderValueStoreFactory` 分别提供 Data 与值实例的存储实现，具体模型使用哪种实现由存储绑定配置决定；
- `acme/order-model` 是采用该语言编写的订单模型的 ID；
- 订单数据 `order-001` 的 `model` 指向 `acme/order-model`。

## 13. 待决问题

以下架构问题尚需明确：

1. `DataId` 与 `ModelRef` 的规范 URI、命名空间和版本规则；
2. Model 是否默认不可变，以及新版本、兼容版本如何关联；
3. 同一模型的 Store 迁移与注册更新规则；
4. Data reference 在 JSON 等 Payload 中的标准表示；
5. 路径访问与查询扩展的接口、注册方式、结果形式，以及跨 Data 引用的解引用、深度限制和循环处理；
6. 两种 Store 的跨记录事务、内容回收和备份机制；
7. 模型版本、快照及 Runtime 的更新与重建规则；
8. 业务读视图的扩展注册、查询契约、变更订阅与重建机制；
9. Model 演化、实例升级和历史 Run 的只读兼容；
10. Artifact 与 Data 的关联及兼容视图语义；
11. 扩展的信任、权限、资源限制和分发机制；
12. Serializer、ValueStore 与 Runtime 之间的值实例表示兼容性，以及 Serializer 私有模型上下文的供给方式；
13. 跨标准依赖的发现、创建顺序，以及循环依赖的分阶段构建与递归占位；
14. 模型定义标准中其他复杂类型到基础反射结构的映射，以及数据引用的表达；
15. 反射修改后的持久化，以及格式扩展负责的未知内容保留和序列化往返保真语义；
16. 通用领域约束的职责归属、跨 Data 约束及表达式标准的选择；
17. 内置元模型已解码创建输入的提供方式，以及没有更上层模型时 `Model.data.model` 等元模型关联的表示。

## 14. 相关标准

- [JSON Schema Draft-07](https://json-schema.org/draft-07)
- [RFC 9535: JSONPath（查询扩展的一种实现参考）](https://www.rfc-editor.org/rfc/rfc9535)
- [RFC 9110: HTTP Semantics（Media Type）](https://www.rfc-editor.org/rfc/rfc9110)
- [Protocol Buffers Go Reflection：描述符与值反射接口](https://pkg.go.dev/google.golang.org/protobuf/reflect/protoreflect)
- [Protobuf-ES Descriptor 源码](https://github.com/bufbuild/protobuf-es/blob/46413996599f4193f9678722c620d524d182c1e9/packages/protobuf/src/descriptors.ts)
- [Protobuf-ES 反射接口](https://github.com/bufbuild/protobuf-es/blob/46413996599f4193f9678722c620d524d182c1e9/packages/protobuf/src/reflect/reflect-types.ts)
- [Protobuf-ES Registry 构建](https://github.com/bufbuild/protobuf-es/blob/46413996599f4193f9678722c620d524d182c1e9/packages/protobuf/src/registry.ts)
