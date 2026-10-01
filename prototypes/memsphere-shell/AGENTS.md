# Prototype Instructions

## Memsphere prototype decisions

- Visual target: Feishu-like desktop information architecture, adapted to Memsphere rather than copied as a chat product.
- Stable structure: narrow Project/search/Module rail, Module-owned secondary navigation, Module-owned data list, and detail page.
- Project switching and the global-search shell belong to Core. Modules contribute searchable providers/results.
- First prototype interactions use fake data: Project switching, Module switching, secondary navigation, record selection, header actions, global search filters, and search-result navigation.
- Secondary navigation and data-list columns are user-resizable; widths persist locally, keyboard arrows adjust them, and double-click restores defaults.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
