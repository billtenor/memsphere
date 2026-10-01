# 验收用例模型

Human 在产品交付验收阶段明确要求创建真实用例模型，覆盖类型、子类型和嵌套。没有将该要求当作通过票或要求修改票，当前 Review/Submission 不变。

已通过现有 DataStore 创建 8 个模型，目录：`/data00/home/liuyanjun.lyj/.local/share/memsphere/projects/memsphere/models/json-schema/draft-07/examples/`。每个文件与本需求 `assets/use-case-models/` 中同名 JSON 字节一致。安装前检查全部定义及已有目标；未覆盖既有文件，未修改配置、实现、Memory 或默认安装策略。这些是 Human 请求的 Project 数据，不是框架自动预置模型。

| ModelId（均以 examples/ 开头） | 覆盖 |
| --- | --- |
| 01-basic-types.json | string、number、integer、boolean、null、object、array；字符串/数字枚举、固定值、必填/可选、各类标量数组、空对象/空数组 |
| 02-nested-order.json | 多层订单、明细、规格、金额、收货地址；对象/数组交叉嵌套；局部 required |
| 03-array-root.json | 根数组、二维/三维数组、对象数组、嵌套枚举数组 |
| 04-dictionaries-and-encodings.json | 字符串键字典的标量/对象/数组值；大整数十进制文本、二进制 Base64 文本、日期/URI/email 注解 |
| 05-unions-and-conditions.json | nullable 类型联合、anyOf/oneOf/allOf、联合数组元素、true/false 子模式、if/then/else/not |
| 06-references-and-recursion.json | definitions 复用、递归节点、精确跨文件 ModelRef |
| 07-scalar-enum-root.json | 根字符串枚举 |
| 08-numeric-enum-root.json | 根整数枚举 |

## 类型边界

JSON Schema 模型当前不能直接声明 memsphere 原生 map/bigint/bytes。第 04 项只演示它们的 JSON 数据表示，不把对象字典说成原生 Map，也不把字符串自动反射为 bigint/Uint8Array。原生类型的完整覆盖需要另一个定义标准或明确扩展当前标准，未自行修改公共接口或 Runtime。

最初的界面对字典 additionalProperties、联合、条件和引用目标提示查看原文。后续 Human 确认应直接展示动态字段及其值类型，当前树表使用 `[动态字段]` 表示名称可自定义的一类字段，与固定名称字段同层；对象和数组值可以展开内部结构，不伪造实际键名。anyOf / oneOf 现在支持候选摘要和独立分支；同一份定义内的引用展示目标类型和字段，递归节点可以手动继续展开，全部展开不无限递归，跨模型引用明确提示尚未支持展示，条件等未支持部分仍看原文。第 04/05 项可完整浏览，但业务 Runtime 明确拒绝超出已有反射子集的关键字；展示改进不代表扩大 Runtime 子集或支持完整 Draft-07。其余 6 个模型已实际准备 Runtime 成功。第 06 项原作者的说明保持不变，可能包含旧展示提示，不修改用户定义来适配新界面。

## 验证

全部 8 个定义通过元模型校验，经真实 Project Store/Manager 重新加载为 available，原文逐字一致。playwright-cli 通过真实模型页面逐一选择、全部展开、切换原文与实际 API 内容核对；展开行数分别为 24、34、18、9、11、4、1、1，无 pageerror。订单全部展开截图：`assets/use-case-models-nested.png`。

没有代码或 Memory 修改，未重新上报/改写已冻结交付报告；之前“用户 Project 未安装业务文件”的报告描述保留提交时事实，本补充记录当前已由 Human 授权安装的状态。Run `run-20261001-054855z-53c67dce` 仍等待产品负责人正式交付验收票。

## 字典展示反馈后的示例更新

仅更新第 04 个示例中 labelsByKey、productsBySku、batchesByDate 的说明文字，去除过时的“当前不展开”提示，替换为标签、商品 SKU、日期批次的业务含义。通过既有 DataStore 更新，并先比对旧文字及完整定义，拒绝覆盖任何其他用户修改；未改变 Schema 结构、存储配置或其他示例。真实页面全部展开后有 18 行，覆盖文本、对象及数组三种字典值，嵌套数组与对象继续逐级展开。

## 原字典用例增加固定字段混合

Human 要求直接修改原用例，不新增模型。第 04 个示例的 labelsByKey 现在含固定字段 groupName（文本、必填）和 version（整数、可选），未声明的自定义键仍对应文本值；源定义附有“商品标签 / 版本 1 / 颜色红色 / 尺寸大号”的值示例。通过现有 DataStore 更新前核对旧字段定义及完整其余内容，保留其他字段、配置和模型；元模型反射检查及重新加载 available、原文字节核对均通过。

当时的 playwright-cli 验证在真实 Project 中展开 labelsByKey，确认 groupName、version、[字典值结构] 同层并列，类型和必填分别为“文本 / 是”“整数 / 否”“文本 / —”；收起及原文检查通过，无 pageerror。截图 `assets/model-mixed-fixed-dictionary.png` 已查看。当次只修改用例数据与本记录，没有修改实现、公共接口或 Memory，未重跑代码全量测试，不将此前的回归结果冒充当次执行。

Human 随后明确这行应表示“动态字段”，不应把字段和字段值结构混用；已确认改名 `[动态字段]`，与固定字段并列，值为对象/数组时展开内部结构。不新增 `[字典字段]` 包装层或用例模型，模型文件内容不变；最新实现与验证见 `ui-hierarchy-revision.md`。
