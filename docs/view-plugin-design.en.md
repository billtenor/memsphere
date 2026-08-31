# Memsphere View Plugin Design

[简体中文](./view-plugin-design.md) | English

This document defines the architectural boundaries and long-term design principles of Memsphere View Plugins. It is intended for maintainers of ViewHost, Module Loader, and View SDK. For extension development, see the [View Plugin Guide](./view-plugin-guide.en.md). For exact interfaces, see the [View Plugin API](./view-plugin-api.en.md). For the Slot Catalog, see the [View Slot List](./view-slots.en.md).

## Design Goals

- Memsphere and user Modules are compiled separately. Installing a Module does not require Memsphere source code or recompilation.
- Built-in and user Modules use the same plugin entrypoint and Slot protocol.
- Plugins depend only on the public SDK, not private ViewHost code.
- Slot owners declare Slots; contributors may register content only in declared Slots.
- Compile-time typing and runtime validation derive from the same Slot Contract.
- One Module version may create multiple isolated instances.
- Shell aggregation areas retain a unified appearance; a complete Module View may use any frontend framework.
- Module installation, upgrade, and composition changes may restart View; the architecture does not implement plugin hot replacement.
- View holds no authoritative business state and can recover after a browser or service restart.

## Core Model

A View Plugin is the unified entrypoint of a Module browser Bundle. It is neither a page nor an independent service.

```text
Project Composition
        ↓
ViewHost resolves Module instances
        ↓
Dynamically imports each Module View Bundle
        ↓
Creates a ViewPluginContext for each instance
        ↓
Calls apply(ctx, config)
        ↓
Atomically commits Routes, Slots, translations, and other registrations
        ↓
Composes and renders the Slot Tree from the URL
```

ViewHost owns loading, contexts, composition, failure isolation, and cleanup. A Plugin declares what its Module instance contributes to the interface.

## Current Implementation

The current implementation discovers `org.memsphere.memory`, `org.memsphere.run`, and `org.memsphere.settings` from a fixed builtin catalog. It validates each `module.json` minimum View slice, package-contained entry path, and SDK SemVer range before dynamically importing three independent ESM Bundles. Instances share Route and Slot registries while retaining separate Contexts, transactions, diagnostics, and cleanup scopes.

The wired Context services are `slots` and `router`, and all 10 root Slots are now wired. Core contributes Home, account, Settings, and service status through an in-Host Plugin. Home aggregate entries support lifecycle-bound updates. The shared `overlay` delegates masking, focus, dismissal, and background Route projection to ViewHost. Stable Shell, Project selector, and diagnostics remain ViewHost responsibilities. View API, I18n, Theme, Logger, custom child Slots, user Module discovery/installation, and dynamic Project composition remain future capabilities.

## Packaging and Dynamic Loading

The View Plugin ships with its Module:

```text
Module package
├── module.json
└── dist/
    └── view/
        └── index.js
```

The View section of the Manifest declares at least a browser ESM entrypoint and an SDK SemVer range. ViewHost must validate the Manifest, Module dependencies, and SDK compatibility before executing the Bundle.

Memsphere cannot know at build time which Modules users will install later. ViewHost therefore loads Bundles at runtime with dynamic `import()` and reads the `ViewPlugin` from `module.default`. Top-level Bundle code executes on first import; `apply()` then executes separately for every enabled instance.

One Bundle version may be imported once, but top-level variables must not hold instance business state. Every instance has isolated configuration, Context, registration scope, and data namespace.

## Plugin Context and Capability Declaration

`ViewPluginContext` is the only public entrypoint to Host capabilities. It provides, by responsibility:

- current Project and Module instance identity;
- Slot registration;
- stable routing;
- a Module-instance-scoped View API;
- internationalization, theme, and logging;
- instance lifecycle management.

A Plugin declares optional Context services through `inject`. Before `apply()`, Host checks that every service exists and is allowed. If not, Host disables the instance before partially running it.

The API does not expose arbitrary inter-Module JavaScript service registration. Modules compose through Manifest dependencies, public Slots, and server APIs.

## Lifecycle and Cleanup

Plugin registration and page mounting have separate lifecycles:

```text
Module instance lifecycle
  apply()
  ├── register Routes
  ├── register translations
  └── register Slot Entries

Page or overlay lifecycle
  mount(container)
  └── return a page disposer
```

All SDK registrations automatically belong to the current Module instance. Non-SDK resources created by the Plugin, such as DOM listeners, timers, and observers, are attached to instance cleanup through `lifecycle.own()`.

ViewHost executes disposers in reverse registration order. Disposers must be idempotent. One cleanup failure must not prevent other cleanup; Host reports the failures together afterward.

ViewHost cleans up an entire Plugin instance when:

- the View service shuts down;
- the Project switches or the interface is fully recomposed;
- the `apply()` transaction rolls back after failure;
- an automated test ends.

Changing pages unmounts only the corresponding Mount and is not equivalent to hot-replacing a Plugin.

## Slot Ownership and the Composition Tree

A Slot is an explicitly opened UI extension point. Its Token carries:

- a stable `name@version` identity;
- `single`, `list`, or `keyed` composition;
- `shell`, `project`, or `page` scope;
- `descriptor` or `mount` rendering;
- TypeScript Value and Key types;
- a runtime validator.

Root Slots are declared by ViewHost or the built-in Home View. Modules cannot create new global root Slots, but they may declare child Slots inside Mount Entries they own and export their Tokens to dependent Modules. Custom child Slots are not wired into the current Runtime yet.

```text
ViewHost root Slot
└── Module A page Entry
    └── child Slot declared by Module A
        └── Entry contributed by Module B
```

A child Slot exists only for the parent Entry’s lifetime. Unmounting the parent recursively cleans the child Slot and all Entries. A Slot has exactly one owner within a declaration lifetime.

The composition kinds serve different layouts:

- `single`: select one final Entry for the Slot, such as the Header title;
- `list`: stably order and display multiple Entries, such as Header actions;
- `keyed`: retain Entries under multiple keys and let the owner activate one, such as main pages and overlays.

Entry conflicts fail explicitly and are never silently resolved by load order. `order` affects display order only and does not grant replacement rights.

## Descriptor and Mount

Shared Shell areas accept standard Descriptors. Plugins describe text, icons, state, routes, and SDK-defined Actions; the Slot owner uniformly renders loading, disabled, error, keyboard, and accessibility behavior.

A Descriptor contains no arbitrary HTML, DOM nodes, or framework components. This preserves consistency in Header, navigation, and Home aggregation areas and lets Host validate and diagnose content without executing arbitrary rendering code.

Complete pages, complex overlays, and custom Module areas use a framework-neutral Mount. Host provides an exclusive DOM container and portal. The Plugin may use the DOM, React, Vue, or Svelte and returns a disposer. It must not depend on the container’s parent DOM, private Host class names, or unscoped global styles.

## Routing and Stable Recovery

Primary pages must have stable URLs. A Module registers only relative Routes below its instance base path and cannot override Home, Memory, Run, settings, or another instance’s paths.

A Route Token connects one route identity to navigation Descriptors, Header activation conditions, and keyed `main.view` Entries. The URL stores the current Project, Module instance, and page location so the same interface can be reconstructed after View restarts.

## Backend and Data Boundary

Browser Bundles neither import Node.js Domain, Application, or Persistence Adapters nor access Project files or databases. Business use cases required by View are exposed through the current Module instance’s View API namespace:

```text
Module View
    ↓ ctx.api
View HTTP Adapter
    ↓
Application
    ↓
Domain
    ↓
Persistence Adapter
```

APIs represent Application use cases such as “create customer” or “list customers,” not internal functions or database operations one by one. A CLI running in Node.js may invoke the same Application layer directly, so CLI and View share business rules and a data namespace.

ViewHost and Module Views are disposable interaction runtimes. Persistent information must be written to authoritative storage outside View; transient expansion state and unsubmitted drafts may be lost on refresh.

## Startup Transaction and Failure Isolation

SDK registrations created during `apply()` enter an instance transaction and become visible together only after success. On failure, Host reverses all registrations and resources created during startup, marks the instance `failed`, and keeps other instances and the Stable Shell running.

Startup diagnostics must include Module, version, instance, and contract identities for:

- a missing or non-importable Bundle;
- incompatible Manifest, dependency, or SDK versions;
- a missing `inject` service;
- an undeclared Slot or incompatible Token;
- a stable Entry identity conflict;
- a Route escaping its instance boundary.

Failure of one Descriptor Action affects only that action. Failure to render one Entry replaces only that Entry. A failed `main.view` displays a retryable local error page while Shell and healthy Modules remain available.

ViewHost should expose a read-only diagnostics snapshot listing instance status, the Slot declaration tree, Entry sources, and failure reasons. Diagnostics must not mutate the registry.

## Restart Model

The normal Module update path is:

```text
Recompile Module
→ restart View service
→ refresh browser
→ rebuild Plugin instances from Project Composition
→ restore the stable URL
```

Plugin HMR, partial instance replacement on configuration changes, and no-restart upgrades are not supported. Development tooling may automate compilation, restart, and refresh, but the underlying semantics remain a complete reconstruction.

## Versioning and Compatibility

The View SDK follows SemVer: Patch releases preserve public behavior, Minor releases add backward-compatible capabilities, and Major releases may remove or change contracts. Host decides whether to load from the Manifest SDK range and does not guess compatibility at runtime.

Slots have independent `name@version` identities. Changing kind, scope, required fields, Entry selection, or rendering semantics requires a new Slot major version. Versions may coexist during migration and contributors must select one explicitly.

A public API must remain deprecated for at least one Minor release before removal in a following Major release, and diagnostics must name its replacement.

## Trust and Security Boundary

The current trust model loads only code written by the user or explicitly installed as trusted. It does not provide a malicious-code sandbox. Trusted Modules must still:

- depend only on the public SDK;
- not read or mutate Host-private objects or DOM outside their containers;
- not access another Module instance’s API;
- not bypass Application and Domain to mutate persistence;
- not replace Core-reserved Entries, Routes, translation namespaces, or stable identities;
- not place secrets in browser configuration, Bundles, Descriptors, or logs.

Distribution to unknown third parties requires separate designs for signing, permissions, CSP, resource quotas, and process or browser isolation.

## Document Boundary

The complete Module Manifest, CLI SDK, server-side View API registration, Module configuration migration, marketplace, signing, and sandbox are defined by their own contracts. They must preserve the separate-compilation, public-Context, Slot-ownership, instance-isolation, data-boundary, and full-restart model defined here.
