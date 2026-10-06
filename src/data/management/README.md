# 数据层装配

`DefaultDataExtensionRegistry` 实现进程共享的扩展能力目录；`DefaultDataManager` 实现单个 Project 的模型、Runtime 和 Store 管理。公共接口仍在 `api/`，两个实现从 `memsphere/data` 导出，不会自动接入 CLI 或 View。

## 创建订单 ValueStore

```ts
import { resolve } from "node:path";
import {
  Config, DefaultDataExtensionRegistry, DefaultDataManager, type Model,
} from "memsphere/data";
import {
  JSON_SCHEMA_DRAFT_07, jsonSchemaExtension, filesystemJsonValueStoreExtension,
} from "memsphere/data/extensions";

const projectRoot = resolve("./my-project");
const context = {};
const extensions = new DefaultDataExtensionRegistry([
  jsonSchemaExtension,
  filesystemJsonValueStoreExtension,
]);

const definition = {
  type: "object",
  properties: { orderNo: { type: "string" }, amount: { type: "number" } },
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
        stream: () => new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(bytes.slice()); controller.close(); },
        }),
      },
    },
  },
  definition,
};

const dataManager = new DefaultDataManager({
  extensions,
  models: [{ model }],
  stores: [{
    id: "orders",
    model: "order-model.json",
    kind: "ValueStore",
    factory: "memsphere/filesystem-json",
    config: new Config({ directory: resolve(projectRoot, "data/orders") }),
  }],
});

const store = await dataManager.getStore(context, "orders");
if (store.kind !== "ValueStore") throw new Error("Expected a ValueStore");
await store.create(context, "order-001", { orderNo: "O-001", amount: 100 });
```

调用 `getStore(context, "orders")` 时才创建订单 Runtime 和 ValueStore，后续按相同 StoreId 查询复用同一实例。这里模型已经解码，不需要先创建 JSON Schema 元模型的 Runtime；JSON ValueStore 的内部编码也不依赖全局 Serializer 注册。

## 装配输入

- `extensions`：已经注册好的扩展目录。Manager 固定构造时的能力组合；之后添加扩展不会改变已有 Manager。
- `models`：模型来源及显式依赖列表。
- `stores`：业务指定 StoreId，并为每个 Store 绑定唯一的 `model`、`kind`、Factory ID 和 Config。StoreId 在当前 Project 内唯一，DataStore 和 ValueStore 共用这个 ID 空间。

同一个模型可以绑定多个 Store，例如 `orders-current` 和 `orders-archived` 都使用 `order-model`。Manager 按 StoreId 独立创建和缓存 Store，两个 ValueStore 可复用相同的模型 Runtime。StoreId 是逻辑标识，不是 Factory ID，也不会自动成为目录名；物理位置由各自的 Config 决定。

模型来源有两种写法：

```ts
// 已解码的 Model；也可用于元模型启动输入。
{ model: orderModel, dependencies: ["money-model"] }

// 由宿主定位、读取 Data；回调不需要自己解码。
{ ref: "order-model.json", loadData: context => modelStore.get(context, "order-model.json").then(record => record?.data) }
```

读取回调必须返回 ID 与 `ref` 相同的 Data。Manager 根据 Data.model 准备元模型 Runtime，再按 Payload.contentType 选择 Serializer 解码，并用元模型 Runtime 检查模型定义。元模型本身应有已解码的 Model 绑定及对应 Factory，避免依赖自身解码才能启动。内置 `jsonSchemaMetaModelExtension` 已提供 JSON Schema 元模型引导 Factory，Project 模型宿主提供启动绑定；上面的已解码订单示例不依赖它。

`dependencies` 是通用装配接口，保留已有能力，不意味着 Project 开放跨模型引用。当前内置 JSON Schema Runtime 和所有 Project 发布/使用入口只允许本模型内部引用，外部引用明确拒绝；本模型内部递归由 Factory 处理，不写入依赖列表。模型与元模型 ID 均使用 `.json` 后缀，Store/Factory ID 不改名。

## 实例与配置边界

Manager 复制绑定列表、依赖列表和 Config 的 JSON 值；Factory 每次尝试得到独立的配置副本。Model.definition 可以是任意标准的内存值，不做通用深拷贝，宿主须将它及扩展能力的标识视为只读。修改模型或配置时重新装配 Manager。

原始 DataStore 的创建只需要存储绑定，不加载模型或 Runtime。Factory 的返回值会检查 StoreId、模型 ID、Store 类型和必需方法，必须与绑定一致，通过后才登记。加载或创建失败可以重试，已经成功准备的依赖可以继续复用。

同一 Manager 内并发请求合并创建；调用者取消只停止本次等待，共享工作可以继续完成并缓存。这个合并机制不跨进程，也不改变各 Store 自身的写入并发保证。资源释放与停止共享准备的协议另行设计，目前没有 `close()`。

文件目录的基准由宿主处理，Manager 不解释 Factory 私有配置；示例显式传入绝对 directory。当前没有读取 Project 配置文件、切换项目或安装扩展包的隐式行为。

## 扩展查询

Registry 在登记前完整检查冲突，失败不留下部分能力。清单和数组提供只读快照，Factory 与 Serializer 保留原实例及其方法接收者。

MIME 查询规范化类型和参数名称，忽略参数顺序及等价的引号写法，但保留全部参数及参数值大小写。例如只注册 `application/json` 时，不会静默匹配 `application/json; charset=utf-8`。Runtime Factory 按 target 精确查询，由 Manager 执行具体模型优先、元模型其次的选择。
