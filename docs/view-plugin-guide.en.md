# Getting Started with Memsphere View Plugins

[简体中文](./view-plugin-guide.md) | English

This guide builds a minimal View Plugin using capabilities wired today. See [View Plugin API](./view-plugin-api.en.md), [View Plugin Design](./view-plugin-design.en.md), and [View Slot List](./view-slots.en.md).

Runnable Plugins currently use `slots` and `router` and may register `navigation.primary`, `header.title`, `header.actions`, and `main.view`. View API, I18n, Theme, Logger, user Module discovery, and custom child Slots remain unwired.

## Runtime Flow

```text
ViewHost reads and validates module.json
        ↓
checks SDK SemVer and package-contained entry path
        ↓
dynamically imports the independent browser Bundle
        ↓
reads the default ViewPlugin
        ↓
calls apply(ctx, config) for the Module instance
        ↓
atomically commits Routes and Slot Entries
        ↓
activates Descriptors and the main.view Mount from the URL
```

`apply()` initializes one Module instance and registers UI capabilities. `mount()` runs only when its page is active and renders inside a ViewHost-owned container.

## Minimal Package

```text
customer-list/
├── module.json
└── dist/view/index.js
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

Modules and Memsphere compile separately. ViewHost loads `view.entry` at runtime, so installing a Module does not recompile Memsphere. The three builtin Modules use the same structure but are discovered by a fixed builtin catalog and shipped in the npm package.

## Complete Example

```ts
import { defineViewPlugin, slots, type ViewMount } from "@memsphere/view-sdk";

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
      return () => element.replaceChildren();
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

## What Each Part Means

- `export default` is the Bundle's primary View Plugin export.
- `defineViewPlugin<CustomerConfig>()` preserves the object and lets TypeScript check Plugin and configuration types.
- `inject` declares services required before `apply()`; an unavailable service fails only that instance.
- `ctx.router.register()` returns a Route Token. `route.to()` creates a Host-validated target and `route.activation` controls Header and Mount activation.
- Slot Tokens carry compile-time types and runtime validators. Plugins cannot forge Tokens, Routes, HTML, or DOM Descriptors.
- `{ element }` destructures the Host-owned container. A Plugin manages only `element` and `portal`, never private Shell DOM.
- `mount()` returns a disposer used during route changes, Project switching, and page shutdown.

## Current Builtin Modules

```text
modules/
├── org.memsphere.memory/adapter/view/
├── org.memsphere.run/adapter/view/
└── org.memsphere.settings/adapter/view/
```

Each has its own `module.json` and entry and builds to `dist/modules/<module-id>/dist/view/index.js`. Failure in one builtin Module leaves Shell and the other Modules available.

## Continue Reading

- [View Plugin Design](./view-plugin-design.en.md) for separate compilation, lifecycle, isolation, and restart.
- [View Plugin API](./view-plugin-api.en.md) for normative signatures and validators.
- [View Slot List](./view-slots.en.md) for the four currently available root Slots.
