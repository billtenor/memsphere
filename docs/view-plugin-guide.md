# Memsphere View Plugin 入门

简体中文 | [English](./view-plugin-guide.en.md)

本文带扩展开发者完成一个最小 View Plugin，并解释代码运行时发生了什么。想直接复制公共控件请先看 [View 公共控件使用手册](./view-ui-primitives.md)；精确类型和约束请查询 [View Plugin API](./view-plugin-api.md)；架构原因见 [View Plugin Design](./view-plugin-design.md)；可贡献的内置位置见 [View Slot List](./view-slots.md)。

## 当前实现状态

当前 ViewHost 已接通 Plugin 入口、生命周期、Manifest/SDK 校验、独立 Bundle 加载、本地 Package composition、Router、Theme/Theme Registry、UI v1、根 Slot Catalog 与 portable presentation cells。常规页面可以声明 `inject: ["slots", "router", "theme", "ui"]`，并配套 `themeVersion: 1`、`uiVersion: 1`；可贡献位置、特殊组合能力与准确接线状态统一见 [View Slot List](./view-slots.md)。

本文保留 View API 与 I18n 的完整示例，因为它们属于已经确定的长期开发契约；这两项服务目前尚未接线，所以完整示例不能直接作为当前版本的可运行代码。准确进度以 API 文档的“当前实现状态”为准，不因尚未实现而删除后续设计和用法。

## 在真实 Shell 中快速做原型

先从独立 Module 开始，不要为了演示框架能力改造 Memory、Run 或 Settings。Host 负责一级/二级菜单、Header、内容列表栏、Theme 和生命周期；Module 用描述数据接入公共壳，只在 `main.view` 内实现自由业务正文。仓库内 Reference Module 可直接运行：

```bash
npm run build
node dist/cli.js view restart
```

构建并重启后，直接在正式 View 的一级菜单选择“原型”，或打开 `/reference`。Reference 是独立 Module，但与 Memory、Run、Settings 一样由同一个 View 服务加载。开发完成前至少检查 zh-CN/en、桌面/窄屏、标准列表的筛选/空状态/选中态、Header action、自定义正文交互、控制台和卸载清理。

## 先理解运行过程

View Plugin 是 Module 的浏览器界面入口。它不启动独立服务，也不直接修改整个 Memsphere 页面。

```text
ViewHost 动态加载 Module Bundle
        ↓
读取 Bundle 的 default 导出
        ↓
调用 plugin.apply(ctx, config)
        ↓
Plugin 向 Slot 注册界面内容
        ↓
需要显示复杂页面时，ViewHost 创建 container 并调用 mount()
```

这里有两个不同入口：

- `apply()` 初始化当前 Module 实例并注册它提供的界面能力；
- `mount()` 在某个复杂界面真正需要显示时，把内容渲染到 ViewHost 分配的容器中。

## Module 的最小发布结构

用户 Module 与 Memsphere 分别编译。一个带 View 的 Module 至少包含 Manifest 和编译后的浏览器 Bundle：

```text
customer-list/
├── module.json
└── dist/
    └── view/
        └── index.js
```

`module.json` 中声明入口和 SDK 兼容范围：

```json
{
  "schemaVersion": 1,
  "id": "com.example.customer-list",
  "version": "1.2.0",
  "view": {
    "entry": "./dist/view/index.js",
    "sdk": "^1.0.0"
  }
}
```

ViewHost 在运行时执行 `import(view.entry)`，因此用户安装新 Module 后不需要重新编译 Memsphere。

## 第一步：定义插件入口

```ts
import { defineViewPlugin } from "@memsphere/view-sdk";

interface CustomerConfig {
  readonly displayName: string;
}

export default defineViewPlugin<CustomerConfig>({
  name: "customer-list-view",
  apiVersion: 1,
  inject: ["slots", "router", "api", "i18n"],

  apply(ctx, config) {
    // 后续在这里注册界面能力
  },
});
```

这段代码表达：

- `export default` 把唯一的 View Plugin 放在 Bundle 的主出口；
- `defineViewPlugin<CustomerConfig>()` 检查插件对象和实例配置的类型；
- `inject` 提前声明插件需要使用哪些 Context 服务；
- `apply()` 由 ViewHost 为每个启用的 Module 实例调用一次；
- `ctx` 是 ViewHost 提供的公开能力集合，插件不导入 Host 私有实现；
- `config` 是当前 Module 实例经过校验的只读配置。

## 第二步：创建复杂页面

完整页面使用 `ViewMount`。ViewHost 创建容器，Plugin 只管理容器内部：

```ts
import type { ViewMount } from "@memsphere/view-sdk";

const page: ViewMount = {
  mount({ element }, ctx) {
    const button = document.createElement("button");
    button.textContent =
      ctx.i18n.locale === "zh-CN" ? "刷新客户" : "Refresh customers";

    async function refresh() {
      await ctx.api.request({ method: "GET", path: "/customers" });
    }

    button.addEventListener("click", refresh);
    element.replaceChildren(button);

    return () => {
      button.removeEventListener("click", refresh);
      element.replaceChildren();
    };
  },
};
```

`mount({ element }, ctx)` 中的 `{ element }` 是参数解构：从第一个参数中取出 Host 提供的 DOM 容器。插件可以使用原生 DOM、React、Vue 或 Svelte 渲染，但不能修改容器外的 Host DOM。

`mount()` 返回的函数是 disposer。页面离开时，ViewHost 调用它清除事件监听、DOM、定时器和其他临时资源。同步完成的 `mount()` 可以直接返回 disposer；需要异步准备时也可以返回 `Promise<Disposer>`。

## 第三步：注册翻译和路由

把下面代码加入 `apply()`：

```ts
const messages = ctx.i18n.register(`${ctx.module.moduleId}.view`, {
  "zh-CN": {
    "navigation.title": config.displayName,
    "page.title": config.displayName,
  },
  en: {
    "navigation.title": config.displayName,
    "page.title": config.displayName,
  },
});

const route = ctx.router.register({ id: "index", path: "/" });
```

`messages` 是当前 Module 的翻译命名空间；`route` 是路由 Token，不是清理函数。`route.to()` 生成导航目标，`route.activation` 表示这个路由何时处于激活状态。

SDK 的注册结果自动归属当前 Module 实例。ViewHost 清理实例时会撤销翻译和路由；Token 用于引用注册结果，不要求 Plugin 自己监听实例清理时机。

## 第四步：注册导航、标题和页面

```ts
ctx.slots.register(slots.navigationPrimary, {
  id: "navigation",
  value: {
    label: messages.text("navigation.title"),
    icon: { kind: "system", name: "users" },
    route: route.to(),
  },
});

ctx.slots.register(slots.headerTitle, {
  id: "title",
  when: route.activation,
  value: { title: messages.text("page.title") },
});

ctx.slots.register(slots.mainView, {
  id: "page",
  key: route.key,
  value: page,
});
```

示例中的 `slots.navigationPrimary`、`slots.headerTitle` 和 `slots.mainView` 都是 Slot Token。Token 同时告诉 TypeScript 和 ViewHost：内容放在哪里、允许什么类型、怎样组合以及如何在运行时校验；其他可用 Token 请直接查询 [View Slot List](./view-slots.md)。

前两个 Slot 接收 Descriptor：Plugin 只提供文字、图标和行为描述，由 Memsphere 统一渲染。`mainView` 接收 Mount：ViewHost 提供容器，由 Plugin 渲染完整页面。常规对象列表使用 `ctx.ui.contentList(descriptorOrProvider)` 得到标准 Mount 后注册到 `slots.contentList`；动作与确认、状态反馈、Tabs/Segmented、Disclosure、受控表单、Select/Combobox、Progress、Card/Section 也应优先使用 `ctx.ui`。只有公共组件无法表达领域诉求时才在 Module Mount 内自行实现，领域正文和状态机不应反向进入 UI Primitives。

五层边界可以用一句话判断：Shell 决定区域和尺寸，Theme 决定公共视觉变量，UI Primitives 决定通用控件的 DOM/交互，Slot 决定内容放在哪里，Module 只决定领域数据、行为和正文。Module 不读取 `src/view/shell/**`，不依赖 `.view-shell-*` 或 `[data-view-slot]`，不声明 `--mem-view-*`，也不使用 `!important` 覆盖公共壳。

构建期 style contract 是面向常见错误的启发式防错检查，不是安全沙箱；它检查可静态识别的样式模板和已知私有依赖，无法证明任意动态字符串绝对安全。Module 作者仍须遵守上述边界：常规 Feature CSS 应放在可静态检查的模板常量中，并限定在 Feature root 下。生产 builtin 的历史辅助文件尚未全量迁移到此门禁；新增或修改的 Module 样式应主动纳入检查。

`mainView` 是 `keyed` Slot，可以保存多个页面候选。当前路由的 key 决定此刻挂载哪个页面。

## 完整代码

```ts
import {
  defineViewPlugin,
  slots,
  type ViewMount,
} from "@memsphere/view-sdk";

interface CustomerConfig {
  readonly displayName: string;
}

const page: ViewMount = {
  mount({ element }, ctx) {
    const button = document.createElement("button");
    button.textContent =
      ctx.i18n.locale === "zh-CN" ? "刷新客户" : "Refresh customers";

    async function refresh() {
      await ctx.api.request({ method: "GET", path: "/customers" });
    }

    button.addEventListener("click", refresh);
    element.replaceChildren(button);

    return () => {
      button.removeEventListener("click", refresh);
      element.replaceChildren();
    };
  },
};

export default defineViewPlugin<CustomerConfig>({
  name: "customer-list-view",
  apiVersion: 1,
  inject: ["slots", "router", "api", "i18n"],

  apply(ctx, config) {
    const messages = ctx.i18n.register(`${ctx.module.moduleId}.view`, {
      "zh-CN": {
        "navigation.title": config.displayName,
        "page.title": config.displayName,
      },
      en: {
        "navigation.title": config.displayName,
        "page.title": config.displayName,
      },
    });

    const route = ctx.router.register({ id: "index", path: "/" });

    ctx.slots.register(slots.navigationPrimary, {
      id: "navigation",
      value: {
        label: messages.text("navigation.title"),
        icon: { kind: "system", name: "users" },
        route: route.to(),
      },
    });

    ctx.slots.register(slots.headerTitle, {
      id: "title",
      when: route.activation,
      value: { title: messages.text("page.title") },
    });

    ctx.slots.register(slots.mainView, {
      id: "page",
      key: route.key,
      value: page,
    });
  },
});
```

## 继续阅读

- 想快速查找、选择和复制公共控件，阅读 [View 公共控件使用手册](./view-ui-primitives.md)，并在正式 View 打开 `/reference`。
- 想理解为何分别编译、为何允许重启，以及 Slot 所有权如何工作，阅读 [View Plugin Design](./view-plugin-design.md)。
- 编写代码时查询精确签名、返回值和错误约束，阅读 [View Plugin API](./view-plugin-api.md)。
- 选择可以贡献的界面位置，阅读 [View Slot List](./view-slots.md)。
# 本地界面扩展包、主题与界面替换

View Plugin 现在可以作为可信本地“界面扩展包”安装，而不必加入 `builtinModuleCatalog` 或重新编译 Memsphere。示例见 `examples/view-packages/custom-view-showcase`。“设置 → 界面与主题”按“安装新扩展包、已安装扩展包、主题配置、界面配置”组织：扩展包是安装、分享和升级单位；主题单独选择，页面、组件和全局样式通过 Slot 组合；扩展内容的 scoped CSS 随对应 Package 实例自动加载，不作为独立配置项。“一键应用全部”只批量填充主题和 Slot 选择，之后仍能逐项调整。整页只有一个保存按钮，所有配置统一保存在 Home 并应用到全部 Project。旧的 `/settings/packages` 与 `/settings/composition` 链接兼容进入统一页面。

Package 通过 `module.json` 声明 `capabilities`、`dependencies`、`styles`、`themes`、`contributions` 和可选 `source`。global CSS 作为 `styles.global@1` 多选 Slot 的候选，只有被选择后才加载；`styles.global` 是显式高权限，`@import`、远程资源、Host 私有 selector、`!important` 和 `--mem-view-*` 声明都会被拒绝。普通 scoped CSS 随 Package 实例加载并绑定其 root/portal；声明 `namespace` 后，所有自定义变量定义都会按此前缀强制校验。Theme 的 light/dark 必须声明相同的已知 token 集合。旧 `view_composition.styles` 仍可解析以兼容历史配置，新保存统一写入 Slot。

界面扩展包可以声明 12 类非 Core 保留的 Host 根 Slot，以及 `portableSlots.memoryPagePresentation`、`memoryDetailRenderer`、`runPagePresentation` 和 `runArtifactRenderer` 四个稳定展示位置。设置页以表格列出全部 16 类可配置位置：single/keyed Slot 单选，list Slot 多选。Manifest 的 `cell` 仍必须精确匹配运行时注册的 `cell + id`；显式配置后，未选择的 contribution 会被安全忽略，渲染异常则 abdicate 并回退。完整目录见 [View Slot List](./view-slots.md)。

界面扩展包安装、capability、light/dark/system 模式、主题和 Slot 选择都是全局设置，同一配置统一应用到所有 Project。历史 Project View 字段仍可解析以保持配置兼容，但不再参与展示。普通设置页不展示 revision、digest 或 running/disk 快照，只显示已保存、未保存或保存后需重启。

页面 Package 通过 `presentation` 服务读取冻结的摘要、当前 Route/选择，并调用 `refresh/openMemory/openCreate/openRun/startRun` 进入官方控制的流程；不直接请求业务 API。Detail/Artifact renderer 只接收 SDK 定义的最小只读正文 context 及官方包装的复制、ChangeSet、Review、下载动作。

示例的 `index.js` 是预编译 ESM；修改 `src/index.js` 后运行 `node scripts/build-example-view-package.mjs`。正式构建会逐字节检查签入 bundle，并强制保持 `@memsphere/view-sdk` 为 external import。Package 不得内联 SDK，Host 的单例 Token brand 会拒绝这种 bundle。Data renderer 必须同步返回 `HTMLElement`；抛错、返回 Promise/thenable 或其他值都会立即 abdicate 并进入官方 fallback，abdication 持续到实例卸载或 View 重启。
