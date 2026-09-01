# Memsphere View Slot List

[简体中文](./view-slots.md) | English

This document is the single detailed source for the Memsphere View Slot Catalog. It defines the names, semantics, ownership, contribution constraints, and current wiring status of public and Core-reserved Slots. Other documents describe only the architecture or API principles relevant to their purpose and link here instead of duplicating the Catalog. For a first extension, read the [Memsphere View Plugin Guide](./view-plugin-guide.en.md). For architecture boundaries, see [Memsphere View Plugin Design](./view-plugin-design.en.md). For exact TypeScript interfaces, see [Memsphere View Plugin API](./view-plugin-api.en.md).

## Design Principles

- Slots are named after product semantics, not visual coordinates such as “top left” or “second row.”
- A Slot owner defines its location, input contract, composition order, and fallback behavior. Contributors cannot change structure outside the Slot.
- Built-in and user Modules use the same public contribution mechanism. Core-only content is expressed through permissions, not a separate private protocol.
- Navigation, Header, and Home aggregation areas prefer standard descriptors rendered by ViewHost. Modules do not inject arbitrary HTML into these areas.
- `main.view` and `overlay` may mount Module-owned interfaces, subject to the View SDK mount, unmount, theme, and failure-boundary contracts.
- Slot content does not hold authoritative business state. After a View restart, the UI must be reconstructible from Project composition and persisted data.

## Slot List

| Slot | Owner | Allowed contributors | Composition | Product semantics |
| --- | --- | --- | --- | --- |
| `header.title` | ViewHost | Active built-in or user Module | Single | Title, supporting text, and optional breadcrumbs for the current page. Changes with the active View. |
| `header.actions` | ViewHost | Active built-in or user Module | Ordered list | Search, create, and other actions directly related to the current page. May be empty when there is no clear frequent action. |
| `header.account` | ViewHost | Memsphere Core only | Single | Current Human identity, login state, and account menu. Modules may read authorized identity context but cannot replace this area. |
| `navigation.primary` | ViewHost | Memsphere Core and enabled built-in or user Modules | Ordered list | Unified primary navigation. Home, Memory, Run, and user Module Views appear at the same level and are not grouped by code origin. |
| `navigation.secondary` | ViewHost | Active built-in or user Module | Single | Secondary navigation, groups, and counts for the active Module. Host renders selection consistently; it may be empty when the Module has no secondary structure. |
| `content.list` | ViewHost | Active built-in or user Module | Single mount | Optional object list, filters, and list-level actions. When contributed, it scrolls independently from the detail Page and remains mounted across Routes in the same Module; without a contribution, the Host collapses the column. |
| `search.providers` | ViewHost Search | Enabled built-in and user Modules | Ordered list | Data providers for global search. Host owns the entrypoint, overlay, categories, keyboard behavior, cancellation, failure isolation, and result navigation. |
| `sidebar.footer` | ViewHost | Memsphere Core and enabled Modules | Ordered list | Low-frequency actions and persistent status. Entries use standard `action` or `status` types. Settings and Core service status are provided by Core and cannot be removed or replaced. |
| `home.attention` | Home View | Built-in and user Modules | Aggregated list | Items waiting for Human intervention, such as reviews, confirmations, and failure handling. Completed items should disappear. |
| `home.continue` | Home View | Memsphere Core and built-in or user Modules | Aggregated list | Shortcuts to recently visited or unfinished work, without implying urgency. If duplicated in `home.attention`, the attention entry takes precedence. |
| `home.modules` | Home View | Module Composition Runtime | Aggregated list | Entrypoints and summaries for Modules enabled in the current Project. Generated from Project composition; the UI does not call them “software.” |
| `main.view` | ViewHost | Built-in and user Modules | Select by route key | Main page body. Multiple Views may be registered, but only the one selected by the current route is mounted. A Module may declare child Slots inside its own View. |
| `overlay` | ViewHost | Memsphere Core and built-in or user Modules | Select by overlay key | Drawers, dialogs, review panels, and other temporary interactions. Multiple overlays may be registered, but the controller activates only one at a time. ViewHost owns masking, focus, closing, and failure isolation. |

The Catalog defines 13 long-term Slots. Add future Slots directly to this list.

## Current Implementation Status

The SDK and ViewHost now wire all 13 root Slots in this Catalog. Core provides Home, account, and other Shell-owned content through an in-Host Plugin. All three built-in Modules use the same public Slot Tree for primary navigation, secondary navigation, object lists, Header, Page, search Providers, and Home aggregate contributions. Shell provides resizable and persisted secondary-navigation and content-list columns. Ordinary Run pages do not poll. Run registers Artifact Review in `overlay`; ViewHost owns the background Route, mask, focus, dismissal, cleanup, and local failure boundary.

Custom child Slots, user Module discovery/installation, and dynamic Project composition remain unwired. Implementation progress belongs only in this section and must not delete or narrow the long-term Catalog above.

## Slot Structure

```text
ViewHost
├── header.title
├── header.actions
├── header.account
├── navigation.primary
├── navigation.secondary
├── content.list
├── Search View
│   └── search.providers
├── sidebar.footer
├── Home View
│   ├── home.attention
│   ├── home.continue
│   └── home.modules
├── main.view
└── overlay
```

`Home View` is a built-in View provided by Memsphere. It owns the three Home Slots but enters the product Shell through `main.view`, just like other Module Views.

## Standard Descriptors and Custom Interfaces

The following Slots accept only standard descriptors rendered by ViewHost or Home View:

- `header.title`
- `header.actions`
- `header.account`
- `navigation.primary`
- `navigation.secondary`
- `search.providers`
- `sidebar.footer`
- `home.attention`
- `home.continue`
- `home.modules`

A standard descriptor must include at least a stable identity, display text, target or action, source Module instance, and availability state. Individual Slots may add fields through the View SDK, such as urgency and status for attention items, icon and route for navigation, or the `action/status` footer type.

`content.list` is a single mount Slot; `main.view` and `overlay` are keyed mount Slots. A Module may compile its browser Bundle independently and mount its UI through the framework-neutral View SDK. It cannot require joint compilation with Memsphere.

## Composition and Permissions

### Current Page Context

`header.title` and `header.actions` accept contributions only from the active View. A page Mount may update the current object title and page-level actions from loaded content; those contributions are removed when the page unmounts and do not remain global content.

`navigation.primary`, `search.providers`, `sidebar.footer`, and the three Home Slots are assembled from the current Project’s Module composition. `navigation.secondary` and `content.list` show only contributions from the active Module. A Module without an object list must not register an empty `content.list` just to satisfy the layout; the Host expands the detail area into the unused column. Switching Projects may restart and reconstruct the complete View.

### Unified Navigation

Memory, Run, and personalized user Views belong to one navigation system in the product experience. They may come from built-in and user Modules, but the interface must not create two products with separators. Source differences belong only in diagnostics, management, or development information.

### Core-Reserved Content

The following content appears in Slots but remains controlled by Core:

- all content in `header.account`;
- Memsphere settings and Core service status in `sidebar.footer`;
- stable recovery and diagnostics entries in `navigation.primary`.

Modules cannot replace the same stable identities or use ordering to push Core-reserved content out of view.

## Areas Without Slots

The following areas are currently fixed by Memsphere Core and are not extensible:

- the Memsphere brand;
- the Project switcher;
- the global search button and search-overlay shell;
- the Home prompt heading, such as “What needs attention today?”;
- the overall Shell layout, theme foundation, and failure-diagnostics interface.

Add a semantic Slot only when a concrete extension need exists. Do not reserve empty Slots for hypothetical needs.

## Failure and Restart

- If a contribution is invalid, ignore only that item and record its Module, instance, and Slot; do not block other content.
- If `main.view` or `overlay` rendering fails, ViewHost replaces it with a diagnosable error interface through a failure boundary.
- Stable Slot identity conflicts must fail explicitly and must not be resolved through silent replacement.
- View plugins do not require hot replacement. After a Module update, View may restart and recover from the current URL, Project composition, and persisted data.
