# 内置数据扩展

每项扩展只提供一个可独立替换的 Serializer 或 Factory，不自动注册。可从 `memsphere/data/extensions` 导入，也可使用各扩展的独立子路径。

| 导出 | 扩展 ID | 提供的能力 |
| --- | --- | --- |
| `filesystemDataStoreExtension` | `memsphere/filesystem-datastore` | `FilesystemDataStoreFactory`，ID 为 `memsphere/filesystem` |
| `jsonSchemaExtension` | `memsphere/json-schema-draft-07` | `JsonSchemaModelRuntimeFactory`，匹配元模型 `json-schema/draft-07.json` |
| `rawExtension` | `memsphere/raw` | `RawModelRuntimeFactory`，匹配元模型 `raw.json` |
| `jsonSchemaMetaModelExtension` | `memsphere/json-schema-metamodel` | `JsonSchemaMetaModelRuntimeFactory`，匹配具体元模型 `json-schema/draft-07.json` |
| `jsonSerializerExtension` | `memsphere/json-serializer` | `JsonPayloadSerializer`，ID 为 `json`，contentType 为 `application/json` |
| `filesystemJsonValueStoreExtension` | `memsphere/filesystem-json-valuestore` | `FilesystemJsonValueStoreFactory`，ID 为 `memsphere/filesystem-json` |

## 使用 ValueStore

以下示例显式创建订单 Runtime 和文件型 ValueStore。模型已经解码，不涉及元模型引导或自动装配。

```ts
import { Config, type Model, type ModelRuntimeRegistry, type ModelRuntime } from "memsphere/data";
import {
  JSON_SCHEMA_DRAFT_07,
  JsonSchemaModelRuntimeFactory,
  FilesystemJsonValueStoreFactory,
} from "memsphere/data/extensions";

const context = {};
const definition = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    orderNo: { type: "string" },
    amount: { type: "number", minimum: 0 },
  },
  required: ["orderNo", "amount"],
  additionalProperties: false,
};
const bytes = new TextEncoder().encode(JSON.stringify(definition));
const model: Model = {
  data: {
    id: "order-model.json",
    model: JSON_SCHEMA_DRAFT_07,
    payload: {
      contentType: "application/json",
      content: {
        stream: () => new ReadableStream({
          start(controller) { controller.enqueue(bytes.slice()); controller.close(); },
        }),
      },
    },
  },
  definition,
};
const runtimes = new Map<string, ModelRuntime>();
const registry: ModelRuntimeRegistry = {
  get: id => runtimes.get(id),
  register(runtime) {
    const id = runtime.descriptor.id;
    if (runtimes.has(id)) throw new Error(`Runtime already registered: ${id}`);
    runtimes.set(id, runtime);
  },
};
const runtime = await new JsonSchemaModelRuntimeFactory().createRuntime(context, model, registry);
registry.register(runtime);
const store = await new FilesystemJsonValueStoreFactory().createStore(
  context, "orders", runtime, new Config({ directory: "./data/orders" }),
);
const created = await store.create(context, "order-001", { orderNo: "O-001", amount: 100 });
const order = runtime.reflect(created.value);
if (order.kind === "object") order.set(order.descriptor.field("amount")!, 120);
await store.update(context, created.id, order.value, { expectedRevision: created.revision });
```

DataStore Factory 的创建参数为 `(context, storeId, modelRef, config)`；ValueStore Factory 的创建参数为 `(context, storeId, runtime, config)`。StoreId 由业务指定，在 Project 内唯一；同一个模型可以创建多个独立 Store。两者均提供 `get / has / create / update / delete / list`。

DataStore 写入完整 Data，`create/update` 返回 `Promise<void>`，消费 Payload 流至正常 EOF 且保存完成后成功；调用方读取结果时使用 `get()`。ValueStore 写入 `(context, id, value)`，`create/update` 仍返回 StoredValue。Payload 仅保证一次消费，需要再次读持久化内容时重新 `get()`，不能依赖重放同一输入。

## 文件 DataStore：保留文件原有格式

`directory` 是该 Store 的根目录，StoreId 不自动参与目录拼接或落盘。`data_id` 是相对于根目录的文件路径，包含文件名及扩展名。例如 `design.md`，或 `a/b/c/order.json`；后者保存为 `<directory>/a/b/c/order.json`，创建记录时自动建立缺失的中间目录。路径的最后一段是文件名，不是目录名。文件内容与 Payload 字节完全一致，不添加私有文件头，也不进行 base64 编码。

Linux、Windows、macOS 上的 ID 都用 `/` 分隔目录，调用方不需要切换分隔符。只接受相对路径，不接受绝对路径、反斜杠、空路径段、`.` 或 `..`，也不沿符号链接目录访问记录。`get / has / update / append / delete` 不创建目录，删除记录后保留空目录。

```ts
new Config({
  directory: "./data/documents",
  contentTypeExtensions: {
    "text/markdown": [".md", ".markdown"],
    "application/vnd.acme.document+json": [".doc.json"],
  },
});
```

| 配置 | 含义 |
| --- | --- |
| `directory` | 必填，存储目录；不存在时创建，相对路径按当前工作目录解析 |
| `contentTypeExtensions` | 可选，MIME 类型到扩展名数组的映射；同类型配置替换默认列表，空数组禁用该类型的默认映射，新类型补充默认映射 |

实现内置 JSON、文本、Markdown、图片等常见映射。读取时通过文件名的扩展名恢复 contentType；目录名不参与判断。写入时检查两者匹配，不自动改名或转换正文。同一扩展名不能属于多个 MIME 类型；扩展名匹配不区分大小写，复合后缀采用最长匹配。无法识别的后缀在直接访问时报错，`list()` 跳过不支持的文件。MIME 参数不能被文件名无损表达，因此当前仅支持不带参数的类型，不静默丢弃 charset 等信息。

`list()` 递归枚举根目录下的记录，返回完整相对路径，例如 `{ id: "a/b/c/order.json" }`。不同目录允许使用相同文件名，目录本身不作为 Data 返回，符号链接不进入遍历。

`model` 来自 Store 绑定，不存入文件。`updatedAt` 使用文件系统的修改时间；不维护 revision，传入 `expectedRevision` 会报不支持。`createdAt` 不返回：原子替换会创建新的文件对象，文件系统的创建时间不能可靠保持“记录首次创建且更新时保留”的语义；不以 ctime 代替创建时间。创建人、更新人没有可信来源时省略。

DataStore 不加内存锁或文件锁。创建不得覆盖同名文件；更新先检查文件存在，再原子替换。并发更新采用最后一次成功替换的内容，不提供多个文件操作之间的事务保证；若删除发生在存在性检查之后，更新可能重新发布该文件。

`create/update` 从输入流逐块写入同目录临时文件，正常 EOF 后才发布完整文件；不因输入流可以持续产生内容就提前发布半成品。写入不要求将完整 Payload 聚合到内存。`get()` 目前仍读取完整文件并返回内存内容，不是惰性文件流。

此实现提供 `AppendableDataStore.append(context, data)`：以追加方式打开已有文件，逐块写入新增字节，不自动创建目标或父目录。输入 model 必须与 Store 绑定一致，contentType 必须与文件扩展名映射一致。追加不使用临时文件替换，已写入的部分可被后续读取看到；取消或失败不撤销这些字节。并发追加可能交错，append 与 update/delete 并发也不提供事务保证；业务须自行协调，不能把整个输入流看作原子追加。

## 文件 JSON ValueStore：保存可读的值记录

仅接受 `new Config({ directory: "./data/orders" })`。此实现的 ID 仍是单个文件名，不包含目录。每条记录保存为 `<id>.json`，后缀总是追加一次；例如 ID 为 `order-001` 的文件名是 `order-001.json`，ID 自身为 `order-001.json` 时文件名是 `order-001.json.json`，两者不会被映射成同一文件。内容是两空格缩进并以换行结尾的普通 JSON：

```json
{
  "id": "order-001",
  "revision": 1,
  "createdAt": 1770000000000,
  "updatedAt": 1770000000000,
  "value": {
    "orderNo": "O-001",
    "amount": 100
  }
}
```

业务值嵌套在 `value`，不是编码后的字符串。文件内冗余保存 id，读取时校验与请求及文件名映射一致。model 由 Store 绑定，不写入记录。revision 从 1 递增，更新保留 createdAt；创建人、更新人不可得时省略。格式不正确或值不符合 Runtime 的记录明确报错。

filesystem JSON ValueStore 按规范化后的真实目录和记录文件名取得操作系统文件锁，覆盖同一记录的 create/update/delete、版本检查及发布；各 Store 实例和独立 CLI 进程采用同一规则，不同记录可以并行。永久锁文件及删除记录的最高 revision 保存于 `.memsphere-json-store`，不替换或删除锁文件；进程结束由操作系统释放锁。等待可通过 Context.signal 取消，配置不提供 lockTimeoutMs。

条件写保证覆盖共同使用此 Factory 的独立进程；不遵循协议的外部编辑器不在保证范围内。删除保留最高 revision，重新创建同 ID 从更高 revision 开始，旧 expectedRevision 不命中新记录。原始 filesystem DataStore 不新增记录锁或 revision。

## 跨平台文件行为

两个 Store 共享文件操作工具，但不共享记录格式。物理存储隔离由业务配置 directory；框架不会通过 StoreId 或 model 自动隔离目录，也不会把原始业务 JSON 自动识别为 ValueStore 记录。不同 StoreId 使用相同目录时，并不自动获得不同的数据空间。

- 文件名和每级目录名均遵守可移植命名规则：拒绝 Windows 设备保留名、非法字符、末尾点或空格、过长名称。保留可读的 Unicode，要求输入为 NFC；适配 macOS 返回的分解形式名称。拒绝大小写或规范化后存在歧义的名称，不通过哈希或编码消除冲突。DataStore 无锁，不应并发创建仅在大小写上不同的文件或目录。
- 使用 Node 文件 API 和系统路径函数，不依赖 shell、符号链接或操作系统专属命令。目标记录必须是普通文件，不能是符号链接或目录；存储目录须可信，不作为对抗恶意目录修改的安全边界。
- 创建和替换先写同目录临时文件，关闭句柄后再发布。创建使用排他硬链接，保证完整内容可见且不覆盖现有文件；更新使用原子 rename。Windows 的暂时性文件占用错误有限重试，绝不通过先删旧文件来规避替换失败。本地文件系统须支持硬链接和同目录原子替换，不支持时明确失败；不承诺断电恢复或网络文件系统事务。DataStore 的追加直接写已有文件，不采用这一替换流程。
- `.memsphere-` 前缀为内部文件保留，不属于数据 ID。`.memsphere-json-store` 是永久协调和删除 revision 历史，不能当临时文件清理。临时文件正常结束会清理，崩溃残留不进入 Factory 列表；业务 Store 重新登记或打开遇到未知内部条目明确报错，不自动删除。
- `list()` 只枚举文件路径，不读取正文。按完整 ID 字符串顺序分页，默认 100 条、最多 1000 条；DataStore 扫描目录树，ValueStore 扫描单层目录，没有索引，不保证并发修改时的跨页快照。DataStore 写入逐块处理，读取仍完整缓冲到内存；ValueStore 的 JSON 编解码仍处理完整值。

文件名规则参考 [Windows 文件命名约定](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)，时间信息参考 [Node.js Stats 时间语义](https://nodejs.org/docs/latest-v22.x/api/fs.html#stat-time-values)。测试沿用仓库 Linux、Windows、macOS 的 CI 矩阵；本地在什么系统执行，只能验证该系统。

旧的哈希目录与私有 `.data` 文件不会被自动迁移、覆盖或删除；需要保留已有数据时，应另行迁移到新格式。两种 Store 均拒绝已移除的 lockTimeoutMs 和其他未知配置字段，避免配置失效而不自知。

## JSON Schema Runtime

采用 Draft-07，使用 Ajv 进行标准校验；[Ajv 官方说明](https://ajv.js.org/guide/schema-language)将其列为广泛使用且默认支持的版本。这里实现的是能映射到当前反射接口的明确类型子集，不是完整 Draft-07 引擎。

- 支持 object、同类型 array、string、number / integer、boolean、null；integer 映射为 number，并保留整数校验。
- 支持字段、required、具有类型的 additionalProperties，以及数值、字符串长度和 pattern、数组长度和 uniqueItems 等约束；不填默认值、不转换类型、不删除未知属性。
- 支持同类型标量 enum；字符串和数值枚举暴露 EnumDescriptor。const 和其他约束由 Runtime 校验，不额外发明反射类型。
- 只支持本模型内部的空引用、`#`、`#/...` JSON Pointer 与递归结构；全部跨模型 `$ref` 明确拒绝，已登记目标或合法 URI 不构成例外。数据 examples 中名为 `$ref` 的普通字段不是模型引用。
- 未声明类型的开放 schema、联合类型、元组、组合关键字、format、patternProperties、嵌套 `$id` 和外部引用片段等未支持形态会明确报错，不悄悄降级。

`additionalProperties` 缺省或为 true 时，额外属性保留，但不提供其反射字段描述。Runtime 对初始值和反射修改都执行校验；修改失败会恢复原值。使用普通对象、稠密数组和标量作为原生表示，不执行对象 getter。

此 Factory 创建业务模型的 Runtime，与单独的 `jsonSchemaMetaModelExtension` 配合完成模型定义读取。元模型 Factory 匹配具体 ID，使用已解码的启动 ModelBinding，不递归读取自己的文件。元模型 Runtime 验证 Draft-07 对象定义，反射只公开确定为字符串的 `$schema`、`$id`、`title`、`description`；其他关键字保留在完整 JSON 中，不伪造多形态关键字的反射类型。定义可读取不等于业务 Factory 支持其中全部特性；boolean 根及完整 Draft-07 的联合类型业务反射仍未支持。

## Raw Runtime：整体字节反射

`RAW_MODEL` 为 `"raw.json"`，表示模型定义标准，不是所有原始内容共用的业务模型 ID。`RawModelRuntimeFactory` 为每个具体模型创建独立的 `RawModelRuntime`，描述符保留该模型 ID，根类型为 `{ kind: "scalar", scalar: "bytes" }`。例如 `artifact-model.json` 和 `log-model.json` 可以共用这一标准，同时分别绑定各自的 Store。

`RawModelDefinition` 只支持可选的字符串 `description`，空对象 `{}` 有效；其他字段或不支持的定义会报错。`reflect()` 和 `ScalarValue.set()` 接受 `Uint8Array`（包括 Node.js `Buffer`），不将字符串、普通数组或 `ArrayBuffer` 自动转换成字节。反射只提供整体 `value` 读取与 `set(bytes)` 替换，不提供字段、数组元素或 Map 条目访问；替换仅改变内存视图，不自动写入 Store。

以下通过扩展登记和已解码的 Model 准备 Runtime，不需要 raw 元模型的引导能力：

```ts
import { DefaultDataExtensionRegistry, DefaultDataManager, type Model } from "memsphere/data";
import { RAW_MODEL, rawExtension, type RawModelDefinition } from "memsphere/data/extensions";

const definition: RawModelDefinition = { description: "原始交付物内容" };
const definitionBytes = new TextEncoder().encode(JSON.stringify(definition));
const model: Model<RawModelDefinition> = {
  data: {
    id: "artifact-model.json",
    model: RAW_MODEL,
    payload: {
      contentType: "application/json",
      content: {
        stream: () => new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(definitionBytes.slice()); controller.close(); },
        }),
      },
    },
  },
  definition,
};
const manager = new DefaultDataManager({
  extensions: new DefaultDataExtensionRegistry([rawExtension]),
  models: [{ model }],
});
const runtime = await manager.getRuntime({}, "artifact-model.json");
const value = runtime.reflect(new TextEncoder().encode("原始内容"));
if (value.kind !== "scalar") throw new Error("Expected a scalar");
value.set(new TextEncoder().encode("替换后的内容"));
// value.value 是替换后的整体字节；原来的 JS 变量和持久化内容不会自动改变。
```

此处 JSON 仅是模型定义的字节编码，不意味着定义采用 JSON Schema，也不规定业务实例 Payload 的 `contentType`。当前不提供 raw 元模型引导或 Payload Serializer；通过 `models: [{ model }]` 提供已解码定义，不等于可以直接用 `loadData()` 自动解码 raw 模型定义。原始 DataStore 的读写不依赖 raw Runtime；仅保存或读取原始 Payload 时，不要求先为反射将整份内容加载到内存。

## JSON Serializer 与 ValueStore 的范围

JSON Serializer 使用 UTF-8，保留所有 JSON 属性，不调用 `toJSON` 或 getter。拒绝 undefined、symbol、函数、BigInt、Map、Set、Date、bytes、循环引用、稀疏数组及不能无损表达的属性。描述符包含 map / bigint / bytes 时也会拒绝，即使本次值未出现对应字段。

因此 raw Runtime 不能搭配内置 JSON Serializer 或文件系统 JSON ValueStore 保存字节值；原始 Payload 可继续交给 DataStore，其他值存储方式需提供兼容 bytes 的实现。

数字使用 JS 的 IEEE-754 精度；NaN、Infinity、不安全整数和负零会报错，小数不提供任意精度保证。对象原型、属性修饰符和共享引用身份不属于 JSON 数据模型。

Serializer 检查结构与枚举；JSON Schema 的 required、minimum 等约束由 Runtime 检查。ValueStore 在写入、JSON 往返和读取时调用 Runtime，要求恢复后的值仍与该 Runtime 兼容；不支持的值会在提交文件前被拒绝。对外仍是值实例接口，内部使用 Serializer 不要求调用方构造 Payload。
