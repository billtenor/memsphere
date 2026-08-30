# Memsphere View Plugin 入门

简体中文 | [English](./view-plugin-guide.en.md)

本文使用当前已经接线的公开能力完成一个最小 View Plugin。精确类型见 [View Plugin API](./view-plugin-api.md)，架构原因见 [View Plugin Design](./view-plugin-design.md)，可用位置见 [View Slot List](./view-slots.md)。

当前可运行 Plugin 使用 `slots` 和 `router`，并可注册 `navigation.primary`、`header.title`、`header.actions` 与 `main.view`。View API、I18n、Theme、Logger、用户 Module 自动发现和自定义子 Slot 尚未接线。

## 运行过程

```text
ViewHost 读取并校验 module.json
        ↓
检查 SDK SemVer 与 Bundle 包内路径
        ↓
动态 import 独立浏览器 Bundle
        ↓
读取 default ViewPlugin
        ↓
为 Module 实例调用 apply(ctx, config)
        ↓
原子提交 Route 与 Slot Entry
        ↓
按当前 URL 激活 Descriptor 和 main.view Mount
```

`apply()` 初始化一个 Module 实例并注册界面能力。`mount()` 只在页面实际激活时运行，并把内容渲染到 ViewHost 分配的容器。

## 最小发布结构

```text
customer-list/
├── module.json
└── dist/
    └── view/
        └── index.js
```

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

Module 与 Memsphere 分别编译。ViewHost 在运行时加载 `view.entry`，安装新 Module 不要求重新编译 Memsphere。当前仓库中的三个 builtin Module 也使用这一结构，只是由固定 builtin catalog 发现并随 npm 包一起发布。

## 完整示例

```ts
import {
  defineViewPlugin,
  slots,
  type ViewMount,
} from "@memsphere/view-sdk";

interface CustomerConfig {
  readonly displayName: string;
}

function createPage(config: Readonly<CustomerConfig>): ViewMount {
  return {
    mount({ element }, renderContext) {
      const heading = document.createElement("h1");
      heading.textContent = config.displayName;

      const location = document.createElement("code");
      location.textContent = renderContext.route.pathname;

      element.replaceChildren(heading, location);

      return () => {
        element.replaceChildren();
      };
    },
  };
}

export default defineViewPlugin<CustomerConfig>({
  name: "customer-list-view",
  apiVersion: 1,
  inject: ["slots", "router"],

  apply(ctx, config) {
    if (!ctx.router) throw new Error("Router is required");

    const route = ctx.router.register({ id: "index", path: "/" });

    ctx.slots.register(slots.navigationPrimary, {
      id: "customer.navigation",
      order: 300,
      value: {
        label: { text: config.displayName },
        icon: { kind: "system", name: "users" },
        route: route.to(),
      },
    });

    ctx.slots.register(slots.headerTitle, {
      id: "customer.title",
      when: route.activation,
      value: { title: { text: config.displayName } },
    });

    ctx.slots.register(slots.mainView, {
      id: "customer.page",
      key: route.key,
      when: route.activation,
      value: createPage(config),
    });
  },
});
```

## 逐段理解

- `export default` 是 Bundle 的 View Plugin 主出口。
- `defineViewPlugin<CustomerConfig>()` 保留对象本身，同时让 TypeScript 检查 Plugin 与配置类型。
- `inject` 声明 Plugin 在 `apply()` 前必须获得的服务；请求未接线服务会使该实例失败，不影响其他 Module。
- `ctx.router.register()` 返回 Route Token。`route.to()` 生成受 Host 校验的导航目标，`route.activation` 控制当前页面的 Header 与 Mount。
- Slot Token 同时携带类型与运行时 validator。Plugin 不能伪造 Token、Route、HTML 或 DOM Descriptor。
- `mount({ element }, renderContext)` 中 `{ element }` 是参数解构。Plugin 只能管理 Host 分配的 `element` 和 `portal`，不能依赖 Shell 私有 DOM。
- `mount()` 返回 disposer。路由切换、Project 切换或页面关闭时，Host 调用它释放 DOM、listener、timer 和其他资源。

## 当前 builtin Module

仓库内置实现位于：

```text
modules/
├── org.memsphere.memory/adapter/view/
├── org.memsphere.run/adapter/view/
└── org.memsphere.settings/adapter/view/
```

每个目录有自己的 `module.json` 和入口，构建后分别进入 `dist/modules/<module-id>/dist/view/index.js`。一个 builtin Module 加载失败时，Shell 和其他两个 Module 仍可使用。

## 继续阅读

- [View Plugin Design](./view-plugin-design.md)：独立编译、生命周期、故障隔离和重启模型。
- [View Plugin API](./view-plugin-api.md)：规范性签名、validator 和错误约束。
- [View Slot List](./view-slots.md)：当前真正可贡献的四个根 Slot。
