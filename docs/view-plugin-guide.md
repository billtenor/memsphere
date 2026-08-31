# Memsphere View Plugin 入门

简体中文 | [English](./view-plugin-guide.en.md)

本文带扩展开发者完成一个最小 View Plugin，并解释代码运行时发生了什么。精确类型和约束请查询 [View Plugin API](./view-plugin-api.md)；架构原因见 [View Plugin Design](./view-plugin-design.md)；可贡献的内置位置见 [View Slot List](./view-slots.md)。

## 当前实现状态

当前 ViewHost 已接通 Plugin 入口、生命周期、Manifest/SDK 校验、独立 Bundle 加载、Router 与根 Slot Catalog。当前可运行 Plugin 可以声明 `inject: ["slots", "router"]`；可贡献位置、特殊组合能力与准确接线状态统一见 [View Slot List](./view-slots.md)。

本文保留 View API 与 I18n 的完整示例，因为它们属于已经确定的长期开发契约；这两项服务目前尚未接线，所以完整示例不能直接作为当前版本的可运行代码。准确进度以 API 文档的“当前实现状态”为准，不因尚未实现而删除后续设计和用法。

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

前两个 Slot 接收 Descriptor：Plugin 只提供文字、图标和行为描述，由 Memsphere 统一渲染。`mainView` 接收 Mount：ViewHost 提供容器，由 Plugin 渲染完整页面。

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

- 想理解为何分别编译、为何允许重启，以及 Slot 所有权如何工作，阅读 [View Plugin Design](./view-plugin-design.md)。
- 编写代码时查询精确签名、返回值和错误约束，阅读 [View Plugin API](./view-plugin-api.md)。
- 选择可以贡献的界面位置，阅读 [View Slot List](./view-slots.md)。
