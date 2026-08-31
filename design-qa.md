# View Shell Design QA

- Source: prototype View served on port `4174`
- Implementation: Memsphere View served on port `30000`
- Viewport and state: Firefox, 1440 × 900, desktop Home, light theme, Project `memsphere`
- Source capture: `.playwright-cli/element-2026-08-31T09-28-07-648Z.png`
- Implementation capture: `/tmp/home-actual-final.png`
- Combined header/upper-shell comparison: `/tmp/shell-top-compare.png`

## Verified matches

- Sidebar geometry now matches the source: 284 px width, 28/18/22 px padding, Project control, navigation rows, footer position, borders, radii, and spacing.
- Sidebar typography now uses the source 16 px UI stack. The `Memsphere` brand is 32 px Georgia, regular weight, correctly capitalized, with the 32 px duotone cube.
- Sidebar active/inactive icon weight and colors, selected background, Project icon, Settings row, and healthy status treatment have been restored.
- Header geometry and typography match the source: 88 px height, 44 px horizontal padding, Project subtitle, 17 px page title, actions divider, and full Human identity treatment.
- Header search and primary action are functional. Search opens Memory; the primary action opens Memory Market. Browser back restores Home.
- Home attention, continue, and module rows now match the source anatomy: count badge, icon tiles, source/status, relative time, row actions, and three-column module cards.
- Firefox console: no errors or warnings after Home → Memory → Home → Memory Market → Home.

## Performance verification

- The Run summary endpoint previously took 0.8–0.9 s with 242 Runs because it read every Run sequentially and read current Run JSON files twice. It now reads with bounded concurrency, avoids the duplicate read, and caches summaries by file version; the final measured warm response is 9 ms.
- The bundled system Memory catalog is prewarmed once, and Project Memory summaries are parsed concurrently. Final Home → Memory Page readiness is 266 ms, down from 856 ms.
- Memory Current Project → Memory Market now reuses one active Mount and requests only Market data: 252 ms measured, down from 901 ms.
- Memory Market → Current Project reuses the same DOM and cached state: 69 ms measured with zero API requests.
- Related Memory, Run, and Settings Routes now use the optional `ViewMount.update()` lifecycle instead of disposing and rebuilding the entire Page container.
- Home no longer depends on all JavaScript Bundles before showing usable structure. With every `.js` request artificially delayed by 3 seconds, the server-rendered Shell, Project, navigation, Home sections, and Module cards were already visible (`.playwright-cli/home-slow-bundle-fallback.png`).
- View JavaScript responses now use gzip plus ETag revalidation. The measured first transfer for the 60,452-byte Runtime fell to 12,698 bytes; a matching conditional request returns `304 Not Modified` with no body. Normal Firefox Home readiness measured 99–106 ms.

## Run refresh placement

- The manual refresh action uses the existing `header.actions` Slot, aligned to the right of the Run page title and before the account divider. The status sidebar now contains only status filtering.
- Desktop capture: `.playwright-cli/run-refresh-header.png`; narrow capture: `.playwright-cli/run-refresh-header-narrow.png`.
- At 1366 × 900 and 760 × 900 the action remains visually distinct without crowding the status tabs or account controls.
- Clicking the action requests only `/api/runs?representation=summary&status=running`; Firefox reported no console errors or warnings.

## Remaining source differences

- The source includes three prototype-only user Modules in the sidebar. The implementation correctly shows only installed Modules, so this content difference is intentionally not filled with fake entries.
- The source primary action says “新建模块”; the implementation uses the available real action “记忆市场” rather than exposing a non-functional Module creation control.

## Memory page actions

- Source visual truth: `/data00/home/liuyanjun.lyj/.codex/attachments/df55dbca-070c-4e80-a1e5-ff5c60ed67d8/codex-clipboard-ffaa01c5-7444-483b-a409-cb2a8a3e3247.png` (208 × 132 px, source-density crop).
- Implementation: Memsphere View `/market`, Firefox at 1440 × 900 CSS px and device scale 1.
- Full implementation capture: `.playwright-cli/market-header-actions.png` (1440 × 900 px).
- Focused implementation capture: `.playwright-cli/market-header-actions-focused.png` (69 × 39 px).
- Combined comparison evidence: `.playwright-cli/market-header-actions-comparison.png` (900 × 420 px), showing the source Page action and the implemented Header action together.
- State: Memory Market, selected not-imported Procedure. The status badge remains beside the selected item title; the actionable button appears in `header.actions` and no duplicate action remains in `.memory-workspace`.
- Interaction checked: the live Header action follows the selected Market item; the importing-state action navigates to its ChangeSet. Memory detail and ChangeSet page-level actions use the same Header placement. Content-local and form controls remain in the Page.
- Fonts/typography: the action uses the established Shell button typography rather than retaining Module-local button styling.
- Spacing/layout rhythm: the action aligns with the Header account divider and does not alter the Memory content grid.
- Colors/tokens: the action uses Shell border, surface, foreground, hover, focus, disabled, and busy tokens.
- Image quality/assets: no image assets were introduced or replaced; existing Shell icons remain unchanged.
- Copy/content: Import/Reimport/View ChangeSet/Edit/Add/Abandon/Archive/Comments labels remain state-appropriate.
- Firefox console: 0 errors and 0 warnings.
- Comparison history: initial P2 inconsistency placed page-level actions inside each Module workspace. The fix made `header.actions` live, moved only the title-right action group into the Host-rendered Header, removed Page duplicates, and preserved local controls. The post-fix focused and full captures show no remaining P0/P1/P2 mismatch.

final result: passed
