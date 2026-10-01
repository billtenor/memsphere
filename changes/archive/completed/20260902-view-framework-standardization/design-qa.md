# Design QA

## Target and evidence

- Source reference: `source-side-panel-reference.png` (Feishu-style contextual panel).
- Implementation: open the stable route `/reference` in the formal Memsphere View.
- Viewport: 1900×936 at DPR 1; narrow regression: 390×844.
- Final screenshot: `reference-components-confirm-final-1900x936.png`.
- Side-by-side evidence: `design-qa-comparison.html` and `design-qa-comparison.png`.

## Visual and interaction checks

- Shell geometry: the optional right panel starts below the global Header, defaults hidden, squeezes the desktop page at 300px, and becomes an overlay on narrow screens.
- Hierarchy copy: primary Module, secondary menu, list Header, breadcrumb and page Header use one path: “原型 / 组件参考”.
- Buttons: primary and danger use white text/icons; primary hover stays dark; disabled is visibly lower contrast, uses `not-allowed`, and has no hover/press response.
- Confirmation: cancel receives initial focus; Escape closes; focus returns to the trigger; confirm closes after the action.
- Typography, spacing, borders and radius consume public Theme tokens. System icons come from the shared icon library; no approximate inline assets were introduced.
- Runtime metrics: panel hidden by default, open width 300px, document overflow 0, console warnings/errors 0.
- Standard list filtering preserves focus while typing multiple Chinese characters and returns the single matching item.

## Fix history

- Reduced the contextual panel from 340px to 300px to match the source proportion.
- Corrected dark-button icons and hover colors so foreground contrast stays coherent.
- Added a distinct disabled state instead of reusing the light secondary appearance.
- Unified inconsistent labels across all shell levels.
- Corrected Escape focus restoration by returning focus after the trigger is re-enabled.

final result: passed
