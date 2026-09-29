# 数据层

本目录实现[数据层设计](../../docs/data-layer-design.md)的公共接口和内置扩展。公共入口为 `memsphere/data`，内置扩展入口为 `memsphere/data/extensions`；尚未接入现有 CLI 和运行流程。

## 目录组织

公共类型、接口和 Config 等公共类放在 `api/`，通过根目录的 [index.ts](./index.ts) 统一导出。装配管理实现放在 `management/`；内置扩展放在 `extensions/`，其私有共用代码放在 `extensions/shared/`。

`api/` 不依赖具体实现；扩展依赖公共 API，框架装配负责组合实现。

内置扩展按单个可独立替换的 Serializer 或 Factory 拆分，每个扩展在 `extensions/` 下独立组织并拥有独立 ID。默认装配维护扩展列表，在注册前选择保留或替换哪些扩展；共用代码可以复用，不要求每个扩展单独发布 npm 包。注册与替换规则见[设计文档第 6.5 节](../../docs/data-layer-design.md#65-dataextension扩展的组织与注册)。

## 公共定义

| 文件 | 内容 |
| --- | --- |
| [data.ts](./api/data.ts)、[payload.ts](./api/payload.ts) | Data 身份、模型引用及内容读取协议 |
| [context.ts](./api/context.ts)、[config.ts](./api/config.ts) | 操作上下文和 JSON 配置 |
| [model.ts](./api/model.ts)、[model-runtime.ts](./api/model-runtime.ts) | 模型定义、Runtime、Registry 和 Factory |
| [serializer.ts](./api/serializer.ts) | Payload 与值实例之间的转换接口 |
| [store.ts](./api/store.ts) | 两种 Store 的公共参数、分页结果和 Registry |
| [data-store.ts](./api/data-store.ts)、[value-store.ts](./api/value-store.ts) | Store、返回记录及对应 Factory |
| [extension.ts](./api/extension.ts) | DataExtension 能力清单 |
| [extension-registry.ts](./api/extension-registry.ts) | 进程共享的扩展登记及 Serializer、Factory 查询接口 |
| [data-manager.ts](./api/data-manager.ts) | Project 内的模型加载、Runtime 与 Store 准备接口 |
| [reflection.ts](./api/reflection.ts) | object / array / scalar / map 的结构描述和值操作 |

## 扩展装配与实例管理

DataExtensionRegistry 登记 Extension 提供的能力，不创建 Runtime 或 Store。查询均为同步操作，未找到时返回 undefined。Runtime Factory 查询按 `target` 精确匹配，具体模型优先于元模型的选择顺序由 DataManager 执行。

DataManager 属于一个 Project，通过 `getModel / getRuntime / getStore` 按需准备并复用结果。它内部管理 ModelRuntimeRegistry 和 StoreRegistry，不向业务暴露可登记实例的入口。异步准备失败时抛错，不返回 undefined。不同 Project 的同名模型不会共享 Runtime 或 Store。

默认实现为 `DefaultDataExtensionRegistry` 和 `DefaultDataManager`，同样从 `memsphere/data` 导入。宿主显式提供扩展、模型来源与存储绑定；构造时不加载模型或创建 Store。完整装配示例见 [management](./management/README.md)。业务侧的调用如下：

```ts
import type { Context, DataManager } from "memsphere/data";

declare const context: Context;
declare const dataManager: DataManager; // 宿主绑定当前 Project。

const store = await dataManager.getStore(context, "order-model");
if (store.kind !== "ValueStore") throw new Error("order-model 未绑定 ValueStore");
await store.create(context, "order-001", { orderNo: "O-001", amount: 100 });
```

模型可以直接提供已解码的 Model，或通过 `loadData(context)` 读取原始模型 Data，由 Manager 准备元模型 Runtime 后解码。模型依赖通过 `dependencies` 显式声明；Manager 不解析 JSON Schema 等标准的引用语法。并发准备合并为一次共享创建，调用方取消只停止自己的等待，共享工作仍可完成并缓存。`DataManager` 不代替 Store 的业务数据增删改查接口，也不提供热更新或 `close()`。

## 反射接口

反射接口描述内存值的结构，并提供读取、修改能力，不规定序列化方式。

| 结构描述 | 值操作 |
| --- | --- |
| ObjectDescriptor：字段名称与类型 | ObjectValue：字段存在性、读写、删除与遍历 |
| ArrayDescriptor：元素类型 | ArrayValue：元素读写、插入、删除与遍历 |
| ScalarDescriptor：标量类型及可选枚举 | ScalarValue：当前标量值的读取与替换 |
| MapDescriptor：键与值的类型 | MapValue：条目读写、删除与遍历 |

`Descriptor` 包含模型 ID 和 `root: TypeDescriptor`。根类型和嵌套类型共用上述四种描述；`runtime.reflect(value)` 直接返回相应的 Value，视图的 `descriptor` 是 `runtime.descriptor.root`。

tuple、Record、Set 不另设类型。动态对象字段仍由 `ObjectDescriptor.additionalProperties` 描述，不增加 RecordDescriptor；集合可表达为 `Map<T, null>`，但不承诺适配原生 JS Set。

`ScalarDescriptor.enum` 可关联字符串或数值枚举。`EnumDescriptor` 以 `scalar` 指定实际值类型，`values` 按声明顺序提供 `EnumValueDescriptor` 成员，`byName` / `byValue` 分别按名称和实际值查找。成员可无名称，也可用不同名称表达同一值的别名；按值查找返回第一项。`open: true` 允许同类型的未声明值，`false` 只接受已声明值。枚举值仍是 ScalarValue，读写实际值，不将成员名隐式转换为值；不引入通用约束语言。

主要契约：

- 字段结构在描述符上查询，实例操作在 Value 上进行；公共反射对象不带泛型。
- 缺失字段返回 undefined，显式 null 是有效标量；读取不填默认值。已存在但为 undefined 的可反射字段是非法值。
- 字段、数组元素和 Map 条目值读取为子 Value 视图，写入接收原始值；修改子视图直接反映到父值。父容器替换、删除位置后，旧子视图及其后代失效；数组长度变化使已有元素视图失效，Map 增删其他键不影响已有条目值视图。
- 标量包括 null、boolean、number、string、bigint 和整体读写的 bytes，不包括 symbol 或 undefined；number 对应 JS 浮点数，bigint 表达不受安全整数范围限制的精确整数。
- Map 使用原始键，只将条目值包装为子 Value。键按 SameValueZero 比较：基本值按值，对象和字节按身份；反射和写入均不转换、复制键。原始内存表示不必是原生 JS Map。
- Value.value 是当前原始值实例。根标量的 set 更新视图持有的值，不会改写调用方原来的 JS 变量；保存时读取视图的当前 value。

接口使用示例见[类型测试](../../test/fixtures/data-reflection.ts)。JSON Schema 扩展已提供普通对象、数组和标量的反射实现，raw 扩展将原始字节作为整体标量反射；共用反射实现也支持原生 Map。

## 内置扩展

- 文件系统 DataStore：以可读的相对文件路径保存原始 Payload，支持子目录，通过文件扩展名恢复 contentType；无锁，不维护 revision。
- JSON Schema Draft-07 ModelRuntimeFactory：将模型定义转换为 Descriptor，并提供值实例反射。
- Raw ModelRuntimeFactory：匹配 `raw` 模型定义标准，提供 `bytes` 标量的整体读取与替换，不暴露内部字段或元素。
- JSON PayloadSerializer：在 JSON 字节与原生值实例之间转换。
- 文件系统 JSON ValueStore：保存包含 id、值实例及记录信息的格式化 JSON；按文件共享内存锁，保护单运行环境内的 revision 条件写入。

五项分别注册、替换，导入不会自动装配。配置、使用示例和支持范围见[内置扩展说明](./extensions/README.md)。raw 的 Runtime 不负责 Payload 编解码；原始 DataStore 的内容读写仍不要求创建 Runtime 或进行反射。

## 尚未展开的部分

- 模型定义标准中其他复杂类型到基础反射结构的映射。
- 跨 Data 引用和领域约束；不混入基本的字段、元素读写操作。
- 路径访问与查询只确定为扩展方向，未增加查询接口或注册字段。
- Project 持久配置与 CLI/View 的接入、模型依赖自动发现、内置 JSON Schema / raw 元模型引导扩展和资源释放协议尚未实现；当前由宿主显式提供装配输入。
