# Getting Started with Memsphere View Plugins

[简体中文](./view-plugin-guide.md) | English

This guide builds a minimal View Plugin and explains what happens at runtime. For exact types and constraints, see [View Plugin API](./view-plugin-api.en.md). For architectural rationale, see [View Plugin Design](./view-plugin-design.en.md). For built-in contribution points, see [View Slot List](./view-slots.en.md).

## Current Implementation Status

ViewHost currently wires the Plugin entrypoint, lifecycle, Manifest and SDK validation, independent Bundle loading, Router, and the root Slot Catalog. A currently runnable Plugin may declare `inject: ["slots", "router"]`; the available contribution points, special composition capabilities, and authoritative wiring status are maintained in the [View Slot List](./view-slots.en.md).

This guide retains the complete View API and I18n example because those services are part of the established long-term development contract. They are not wired yet, so the complete example is not directly runnable against the current release. The API reference's “Current Implementation Status” is authoritative; future design and usage are not removed merely because implementation is pending.

## Understand the Runtime Flow

A View Plugin is the browser UI entrypoint of a Module. It neither starts an independent service nor edits the complete Memsphere page directly.

```text
ViewHost dynamically imports the Module Bundle
        ↓
reads the Bundle default export
        ↓
calls plugin.apply(ctx, config)
        ↓
the Plugin registers UI content in Slots
        ↓
for complex UI, ViewHost creates a container and calls mount()
```

The two entrypoints serve different purposes:

- `apply()` initializes the current Module instance and registers its UI capabilities.
- `mount()` renders content inside a ViewHost-owned container when a complex interface becomes visible.

## Minimal Module Package

User Modules and Memsphere compile separately. A Module with a View contains at least a Manifest and a compiled browser Bundle:

```text
customer-list/
├── module.json
└── dist/
    └── view/
        └── index.js
```

`module.json` declares the entrypoint and SDK compatibility:

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

ViewHost executes `import(view.entry)` at runtime, so installing a Module does not require recompiling Memsphere.

## Step 1: Define the Plugin Entrypoint

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
    // Register this Module instance's UI capabilities here.
  },
});
```

This means:

- `export default` exposes the single View Plugin as the Bundle’s primary export.
- `defineViewPlugin<CustomerConfig>()` checks the Plugin object and instance configuration types.
- `inject` declares the Context services required by the Plugin.
- ViewHost calls `apply()` once for every enabled Module instance.
- `ctx` contains public Host capabilities; the Plugin does not import private Host code.
- `config` is validated, read-only configuration for the current instance.

## Step 2: Create a Complex Page

Use `ViewMount` for a complete page. ViewHost creates the container and the Plugin manages only its contents:

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

In `mount({ element }, ctx)`, `{ element }` destructures the Host-provided DOM container from the first argument. The Plugin may render with the DOM, React, Vue, or Svelte, but cannot mutate Host DOM outside this container.

The returned function is a disposer. When the page leaves, ViewHost calls it to remove listeners, DOM, timers, and other transient resources. Synchronous mounting may return a disposer directly; asynchronous preparation may return `Promise<Disposer>`.

## Step 3: Register Translations and a Route

Add this inside `apply()`:

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

`messages` is this Module’s translation namespace. `route` is a Route Token, not a cleanup function. `route.to()` creates navigation targets and `route.activation` identifies when the route is active.

SDK registrations automatically belong to the current Module instance. ViewHost removes the translations and route when the instance is cleaned up. Tokens reference registration results; Plugins do not need to observe instance cleanup themselves.

## Step 4: Register Navigation, Header, and Page

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

The example's `slots.navigationPrimary`, `slots.headerTitle`, and `slots.mainView` are Slot Tokens. A Token tells TypeScript and ViewHost where content belongs, which type is allowed, how it composes, and how to validate it at runtime; consult the [View Slot List](./view-slots.en.md) for other available Tokens.

The first two Slots accept Descriptors: the Plugin supplies text, icons, and behavior descriptions and Memsphere renders them consistently. `mainView` accepts a Mount: ViewHost supplies a container and the Plugin renders the complete page.

`mainView` is a `keyed` Slot. It retains multiple page candidates, and the active route key selects which page is mounted.

## Complete Example

```ts
import { defineViewPlugin, slots, type ViewMount } from "@memsphere/view-sdk";

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

## Continue Reading

- For separate compilation, restartability, and Slot ownership, read [View Plugin Design](./view-plugin-design.en.md).
- For exact signatures, return values, and error constraints, use [View Plugin API](./view-plugin-api.en.md).
- To choose a contribution point, use [View Slot List](./view-slots.en.md).
