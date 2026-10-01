# Memory / Run Shared Content Design QA

- Source visual truth: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/07-memory-shared-default-final.png`
- Implementation default: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/06-run-shared-default-final.png`
- Implementation expanded: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/08-run-shared-expanded-final.png`
- Viewport: 1440 × 1100 CSS px, device scale factor 1
- Source pixels: 1440 × 1100
- Implementation pixels: 1440 × 1100
- State: light theme; same `memsphere-agile-requirement-development` Procedure; Memory default state compared with Run default state, plus Run expanded state

## Full-view comparison

Memory and Run now use the same flow rhythm and visual hierarchy. Runtime metadata, review bindings, and the collapsible produced artifact are intentional Run-only additions. The flow title remains hidden in both views.

## Focused comparison

The first shared flow node was measured in Playwright on both pages. Both produce the same computed values:

- Label: 36 × 19.390625 px, 11 px type, 2 px 7 px padding, 4 px radius
- Head: flex, 10 px gap, 8 px 0 padding, 35.84375 px height
- Action: 13 px type, 18.85 px line height
- Contract: flex
- Disclosure: no border, transparent background, 12 px type, 4 px 5 px 4 px 0 padding

Focused comparison was sufficient without image crops because the relevant text and controls are readable in the 1:1 captures and their geometry was verified from computed layout values.

## Required fidelity surfaces

- Fonts and typography: passed. Shared labels, actions, artifact names, review counts, and disclosures use identical computed sizes, weights, and line heights.
- Spacing and layout rhythm: passed. Shared flow heads use the same flex layout, gap, padding, and height. Run-only fields sit beneath the same step head rather than changing its grid.
- Colors and visual tokens: passed. Both views resolve the shared `mem-content-*` rules against the same semantic theme tokens.
- Image quality and assets: not applicable. The compared content contains no product imagery or custom raster assets.
- Copy and content: passed. Run uses “产出物” for the produced value and “评审人” for reviewer information; Procedure contract text remains “产物”.

## Comparison history

### Iteration 1 — blocked

- P1: Run flow heads were overridden to grid, while Memory used flex.
- P1: Run step labels stretched to 118 px and actions rendered at 15 px; Memory used a 36 px label and 13 px action.
- P1: Run artifact contracts wrapped below the action instead of remaining right-aligned.
- P2: Run produced-artifact disclosures retained boxed card styling.

### Fixes

- Changed Run steps and calls to the same non-collapsible flow-node skeleton as Memory.
- Restricted expand/collapse behavior to actual fields such as rules and produced artifacts.
- Raised shared `mem-content-*` primitives above legacy module rules through a common document scope.
- Added shared artifact and reviewer summary primitives used by both Memory and Run.
- Removed the boxed Run artifact disclosure treatment in the borderless package.
- Added browser regression assertions for shared layout geometry and semantics.

### Iteration 2 — passed

- Default Memory and Run captures now share the same visible flow language.
- Run expanded state preserves the shared step structure and adds only runtime-specific output content.
- Expand/collapse interaction passed.
- Browser console: 0 errors, 0 warnings.
- Browser integration tests: passed.
- Production build: passed.

## Follow-up polish

No actionable P0, P1, or P2 visual differences remain. Runtime metadata above the flow and actual produced-artifact content are accepted product differences rather than visual drift.

final result: passed
