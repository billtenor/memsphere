# Memsphere View Slot List

[简体中文](./view-slots.md) | English

This document lists the root Slots currently exported by `@memsphere/view-sdk` and wired by ViewHost. Add a Slot directly when it becomes available; do not maintain stage-numbered catalogs. See [View Plugin Guide](./view-plugin-guide.en.md), [View Plugin Design](./view-plugin-design.en.md), and [View Plugin API](./view-plugin-api.en.md).

## Principles

- Slot names express product semantics rather than visual coordinates.
- ViewHost owns each Slot contract and composition mode; Modules register only valid Entries.
- Descriptors contain validated data rendered by Shell; complex pages use Mounts inside Host-owned containers.
- Slots do not store authoritative business state. View reconstructs from URLs and persistent data after restart.

## Slot List

| Slot | Composition | Rendering | Scope | Current purpose |
| --- | --- | --- | --- | --- |
| `navigation.primary` | `list` | Descriptor | Shell | Unified navigation for Memory, Run, and other Modules, ordered stably. |
| `header.title` | `single` | Descriptor | Page | Title, supporting text, and optional breadcrumbs for the active route. |
| `header.actions` | `list` | Descriptor | Page | Standard actions for the active route; it may be empty. |
| `main.view` | `keyed` | Mount | Page | Selects and mounts the page body by active Route key. |

All four Tokens are exported by the SDK with stable `name@version`, kind, scope, render mode, and runtime validator. The three builtin Modules contribute to one shared Slot Tree through these Tokens.

## Current Structure

```text
ViewHost Shell
├── navigation.primary
├── header.title
├── header.actions
└── main.view
    ├── org.memsphere.memory
    ├── org.memsphere.run
    └── org.memsphere.settings
```

The navigation and Header Slots accept standard Descriptors, never arbitrary HTML. `main.view` accepts `ViewMount`; Host provides `element` and `portal`, and the Module manages only those containers and returns a disposer.

Header Entries use Route Activation. The `main.view` key comes from the same Route Token, so URL, navigation, Header, and page mounting share one identity.

## Core-Fixed Areas

The following areas are currently fixed Shell responsibilities, not public Slots:

- branding and Project selector;
- account/login state;
- Settings entry and service status in the footer;
- Shell layout, base theme, and failure diagnostics;
- Module-internal portal overlays such as Artifact Review.

Home, `overlay`, `sidebar.footer`, `header.account`, and custom child Slots are not exported by the current SDK and are not part of this Slot List. Add them only after a concrete extension need, contract, and implementation exist.

## Composition, Failure, and Restart

- Entry id, key, or Route conflicts fail the later Module instance transaction; they never silently override.
- Import, `apply()`, registration, or Mount failure in one Module produces a local diagnostic while Shell and healthy Modules remain available.
- Route changes unmount the old Mount before mounting the new page. Project switching and `pagehide` clean instance resources in reverse order.
- Plugin hot replacement is unsupported. Rebuild and restart View, then reconstruct from the stable URL.
