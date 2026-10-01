# Design QA — Borderless Memory outline

- Source visual truth: `/data00/home/liuyanjun.lyj/.codex/generated_images/01a06d51-56fd-73a3-b246-2e9b9edab65f/exec-fe36e8fa-11e6-4415-ad5b-fb208bb3edb6.png`
- Final product refinements: hide the “执行流程” heading and reclaim its indentation; render disclosure labels at least as large as node keywords; remove expanded-list container indentation while retaining bullets; soften containment lines.
- Implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-borderless-final-implementation-v4.png`
- Expanded-state screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-borderless-expanded-final.png`
- Statement screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-statement-borderless-final.png`
- Standalone Schema screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-schema-borderless-final.png`
- Inline Schema screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-inline-schema-borderless-final.png`
- Inline Schema typography and Else-branch screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-inline-schema-typography-else-final.png`
- Unified disclosure and branch hierarchy screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-branch-schema-unified-final.png`
- Identical If/Else label screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-if-else-identical-final.png`
- Identical field/Schema disclosure screenshot: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-inline-disclosures-identical-final.png`
- Combined comparison: `/data00/home/liuyanjun.lyj/.codex/visualizations/2026/09/04/01a06d51-56fd-73a3-b246-2e9b9edab65f/memory-borderless-final-comparison-v4.png`
- Viewport: 1440 × 1024 CSS px; device scale factor 1.
- Source pixels: 1487 × 1058, proportionally normalized and padded to 1440 × 1024 for comparison.
- Implementation pixels: 1440 × 1024.
- State: real Procedure Memory; default-collapsed fields for the full-view comparison and expanded fields for the focused list check.

## Findings

No actionable P0, P1, or P2 differences remain for the requested extension-package redesign.

- Fonts and typography: the implementation retains the product font stack and hierarchy. Flow descriptions use a quieter 550 weight. Disclosure labels render at 12px and counts at 11px, versus 11px for the colored node keyword, satisfying the final readability request.
- Spacing and layout rhythm: the redundant “执行流程” heading is hidden, top-level steps reclaim the content start line, and each node's disclosure row shares the node's left edge. Child nodes retain only the indentation needed to communicate loop containment.
- Colors and visual tokens: teal and amber are reserved for compact node-type labels. The amber containment line and elbows use the same semantic hue at 34% opacity; ordinary fields remain neutral.
- Image quality and assets: this view introduces no raster imagery, custom icons, or replacement assets. Existing product assets remain unchanged.
- Copy and content: Memory content, field labels, artifact names, and reviewer counts are unchanged. Only the redundant flow grouping title is visually suppressed by explicit product direction.
- Interaction and accessibility: disclosure summaries remain native `details` controls with keyboard behavior. Open/close was tested in the browser. Artifact metadata remains available on hover/focus; a real artifact with details became visible on hover.
- Expanded lists: bullets are retained while list padding is `0px` and `list-style-position` is `inside`. Browser geometry confirms the field container and list share the same `672px` left edge.
- Statement and Schema consistency: statement roots, standalone Schema nodes, and inline artifact Schema nodes now use the same borderless hierarchy. Technical `!statement` / `!schema` badges are hidden, remaining metadata is plain text, and Schema field rows no longer introduce gray cards.
- Inline Schema geometry: the real `memsphere-usage-issue-reporting` Procedure confirms the inline Schema, its header, and its owning step share the same `672px` left edge. Field content retains one intentional `24px` hierarchy indent; all borders and field backgrounds compute to transparent/none.
- Inline Schema typography: its disclosure title now computes to `12px / 600`, matching the lightweight field-disclosure tier instead of the larger Schema node heading.
- Else branches: `否则` now uses the same `11px`, 4px-radius, soft amber semantic chip as other control-flow keywords instead of appearing as unstyled text.
- Disclosure controls: inline Schema headers use the same complete interaction and typography treatment as flow-item field disclosures, including matching hover behavior and hidden inline technical metadata.
- Final disclosure parity: after comparing against flow-item disclosures specifically, both controls now use content-width Flex layout, 5px gap, 28px height, `4px 5px 4px 0` padding, identical mixed text color, and matching 12px/600/16.8px title typography. Their title left edge is exactly `682.359px` in the real page.
- Branch hierarchy: the corresponding `如果` and `否则` labels both compute to the same `672px` left edge. Empty true-branch condition labels are `display:none`, removing the meaningless amber dash below `如果`.
- If/Else parity: the real page confirms both labels now compute to the same 36px × 19.39px box, display mode, padding, 11px/650 typography, 15.4px line height, colors, and 4px radius. The Else child connector starts at 30px, below the label, so no rail crosses its chip.
- Default state: 12 disclosure groups were confirmed collapsed after reload. “展开全部/收起全部” remains available.
- Runtime: the page reported zero browser console errors and warnings.

## Focused comparison

The full-view comparison was supplemented with an expanded-state capture because list indentation cannot be judged while fields are collapsed. The expanded capture confirms that bullets supply the only local list cue and no second container indent remains. The loop connector stays outside the list content and remains visibly subordinate to node labels.

## Comparison history

1. Initial implementation retained tinted field rows, colored field pills, repeated rails, and framed flow nodes (P2: excessive visual noise).
2. Replaced those treatments with neutral disclosure text, compact colored node-type labels, and containment-only connectors.
3. First containment pass left node fields indented beneath description text (P2: implied a false extra hierarchy level). Aligned each field row with its owning node.
4. The selected mock still included the “执行流程” grouping label and inset top-level nodes. Per final product feedback, hid that label and reclaimed the indentation.
5. Disclosure labels were technically the same 11px size as node keywords but appeared smaller without a colored surface (P2: weak legibility). Increased labels to 12px and counts to 11px.
6. Expanded content retained list-container padding in addition to bullets (P2: redundant indentation). Removed the padding, retained inside markers, and verified matching left-edge geometry.
7. Containment connectors were visually too solid (P3). Reduced the shared amber line and elbow opacity to 34%.
8. Post-fix evidence is recorded in `memory-borderless-final-implementation-v4.png`, `memory-borderless-expanded-final.png`, and the combined comparison. No actionable P0/P1/P2 issues remain.
9. Statement and Schema variants initially retained renderer-specific frames and technical badges (P2: inconsistent visual language). Unified their node hierarchy, removed technical markers and field-card backgrounds, and verified both standalone and inline Schema variants on real pages.
10. Inline Schema titles remained one typographic step larger than nearby disclosure labels, while `否则` lacked the semantic control-flow chip (P2: inconsistent hierarchy). Normalized the title to 12px/600 and applied the shared amber branch treatment to `否则`.
11. The initial Else-chip pass inherited the branch body's 30px content indent and also colored empty true-branch condition labels (P2: false hierarchy and stray visual mark). Pulled non-empty branch labels back to the owning condition's left edge and suppressed empty labels.
12. Inline Schema still used node-header spacing despite matching the field disclosure's font size (P2: inconsistent control appearance). Unified its complete header rhythm and hid inline technical metadata.
13. Although If/Else colors and alignment matched, the Else rail still crossed the chip and made it appear different (P2). Shared the entire label rule and delayed the Else child rail until below the chip.
14. Inline Schema was first matched against the generic disclosure rule, while flow-item fields use a more specific content-width rule (P2). Matched the actual flow-item rule instead; browser-computed container and title values now agree property-for-property.

## Implementation checklist

- [x] Use colored labels only for execution-node types.
- [x] Use connector lines only for loop containment.
- [x] Align node fields with their owning node.
- [x] Hide the redundant flow heading and reclaim top-level indentation.
- [x] Keep disclosure labels at least as large as node keywords.
- [x] Remove expanded-list container indentation while retaining bullets.
- [x] Keep artifact details available on hover/focus.
- [x] Preserve default collapse and global expand/collapse behavior.
- [x] Apply the same borderless hierarchy to Statement, standalone Schema, and inline Schema nodes.
- [x] Match inline Schema disclosure typography and style Else-branch keywords consistently.
- [x] Align sibling condition labels and suppress empty branch markers.
- [x] Use one disclosure-control style for fields and inline Schema.
- [x] Pass package regression test and full build.
- [x] Verify the real page, core interactions, geometry, and console output.

## Follow-up polish

No blocking polish remains. Dark-theme contrast for the 34%-opacity connector can be reviewed when a dark-theme visual target is provided.

final result: passed
