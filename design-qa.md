# ChangeSet inline diff — design QA

- Source visual truth: `/data00/home/liuyanjun.lyj/.codex/attachments/f0855b95-5998-47cc-9c01-3491fde92122/codex-clipboard-97bb13d7-c465-4864-a079-bfa9b6d25841.png`
- Implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-inline-diff-final.png`
- Latest implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-inline-diff-round2.png`
- Final implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-inline-diff-round4.png`
- Final combined comparison evidence: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-design-comparison-round4.png`
- Alignment implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-inline-diff-round5.png`
- Alignment combined comparison evidence: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-design-comparison-round5.png`
- Inline comment implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-inline-comment-round6.png`
- Inline comment combined comparison evidence: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-comment-comparison-round6.png`
- Inline content comment screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-inline-content-comment-round7.png`
- Wide row-comment implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-row-comment-wide-round9.png`
- Wide row-comment combined comparison evidence: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-design-comparison-round9.png`
- Collapsed wide implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-collapsed-wide-round10.png`
- Collapsed wide combined comparison evidence: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-design-comparison-round10.png`
- Section row-comment implementation screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-section-comment-scope-round11.png`
- Section row-comment combined comparison evidence: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-section-comparison-round11.png`
- Focused review-state screenshot: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-inline-diff-review-state.png`
- Combined comparison evidence: `/data00/home/liuyanjun.lyj/.codex/worktrees/dfc4/vibe-mem/changeset-design-comparison.png`
- Viewport: 1587 × 1076 CSS px, device scale factor 1
- Source pixels: 1587 × 1076; implementation pixels: 1587 × 1076; no density normalization required
- State: active real ChangeSet, Diff mode, first Memory selected; focused capture scrolls the same page to the review-completion control

## Findings

No actionable P0, P1, or P2 differences remain for the requested change.

- Fonts and typography: the implementation keeps the current master View typography, weights, compact metadata, and readable diff copy. The older reference shell has slightly different headings and navigation labels; this is expected master drift rather than a local redesign.
- Spacing and layout rhythm: the current three-column shell, target list, comments rail, toggle, summary, and Memory document retain the current product spacing. Inline before/after rows add only local vertical space at changed fields.
- Colors and visual tokens: red is used only for removed/replaced-before content, green only for added/replaced-after content, using the existing muted semantic palette and borders. Replacement rows share the original neutral list marker; only pure additions/removals color their single marker.
- Image quality and assets: no new raster or custom-drawn assets were introduced. Existing product icons remain supplied by the current View asset set.
- Copy and content: “修改前 / 修改后” labels are adjacent to their values; unchanged text remains unlabelled. Validation, progress, per-Memory state, Diff/Full content switch, comments, and review-completion copy remain present.
- Accessibility and interaction: semantic buttons remain keyboard-operable. Diff/Full content switching, mark-reviewed auto-advance, progress update, and console-error checks passed in the browser.
- Review controls: the comment toggle now reads “收起意见” while the rail is open and “展开意见” while collapsed. The review-completion button is placed before its explanatory copy.
- Diff list semantics: each logical list item retains exactly one native bullet at its original indentation. Replacements use one neutral bullet around adjacent old/new rows; pure removals use one red bullet; pure additions use one green bullet. Multi-token artifact metadata remains grouped into one old row and one new row without gaining a bullet.
- Current-shell fit: the ChangeSet identifier stays on one compact ellipsized line, target review states remain inside the list column, and validation uses the lightweight green status pill from the reference.
- Review rail: the 260px rail keeps the reference title/count/close and scrollable comment summary. Comment creation lives with the reviewed content, so the rail no longer presents a competing generic composer.
- View controls: “差异 / 完整内容” controls render above the selected Memory card. Real `baseRevision` and candidate content `digest` values are shown as seven-character hashes with the existing caret asset between them.
- Edge alignment: pure-addition rows and replacement rows share the same inner diff-line structure. Browser geometry confirms identical left/right coordinates (`701px` / `1260px`) in the real ChangeSet.
- Rail alignment: the review rail cancels only the workspace's 22px top padding, so its top border begins exactly at the page separator (`100px`) without moving the Memory document.
- Inline comment composition: hovering unchanged or changed content reveals its existing “+” action. Activating it inserts an auto-focused textarea directly beneath that anchored content, with local cancel/submit actions; no browser prompt, modal, or right-rail composer is opened. Real-page inspection confirms this also works inside green “修改后” diff rows.
- Deleted-content comments: pure-red delete rows retain the base renderer's stable anchor and exactly one row-level “+”; browser regression opens the inline editor and verifies the submitted Comment payload targets the deleted Memory and base field anchor.
- Locally removed fields: update/rename comparisons move the detached base row instead of cloning away its event handlers, so a red-only removed field retains its base anchor and one working inline comment action.
- Technical anchor paths such as `procedure.goals[1]` remain internal metadata and are not rendered above the comment textarea.
- Wide-screen layout: the ChangeSet workspace uses the full detail surface, keeps the Memory document capped at its readable width, and anchors the 260px comment summary rail to the far-right edge.
- Collapsed review layout: when the comment rail is hidden on a wide screen, the Memory document expands from 720px to a 960px reading width instead of leaving excessive empty space.
- Comment granularity: each visual content row has one trailing comment action. Multi-token artifact rows submit one row-level comment rather than separate comments for artifact name, format, or reviewer chips.
- Section comment scope: a parent section no longer reveals every nested row action. Hovering a content row reveals exactly one action for that row; the section-level action appears only while its own header is hovered.
- Comment action placement: row actions participate in inline text flow, so the “+” sits 8px after the last rendered text fragment instead of at the far-right edge. Browser geometry confirms `gap: 8px`, `trailing space: 0px`, one visible action, and no console errors.

## Focused comparison

The full-view comparison establishes that the reference interaction elements are preserved in the current master shell. A focused bottom-of-document capture was required because realistic Procedure content is longer than the reference sample; it confirms the “看完这条 Memory 了吗？” card and primary review action remain visible and usable after scrolling.

## Comparison history

1. Initial inline implementation used array indexes as identity. A middle insertion made later unchanged list items appear as red/green replacements (P2: misleading review signal).
2. Fixed by aligning primitive list values with a longest-common-subsequence pass, pairing only true replacements and classifying remaining entries as additions or removals.
3. Post-fix evidence in `changeset-inline-diff-final.png` shows unchanged goals without diff color while the inserted goal is green; browser regression explicitly verifies a middle insertion does not color the unchanged trailing item.
4. Follow-up evidence in `changeset-inline-diff-round2.png` verifies the requested current-shell refinements: compact list heading, lightweight validation state, colored list markers, and adjacent old/new rows. Automated browser coverage verifies grouped artifact rows, non-overflowing review states, comment-toggle copy, and review-action ordering.
5. Final evidence in `changeset-inline-diff-round4.png` and `changeset-design-comparison-round4.png` verifies one marker per logical item, original list indentation, the compact full-height review rail, its bottom composer, and the page-level mode/hash row above the Memory card.
6. Alignment evidence in `changeset-inline-diff-round5.png` and `changeset-design-comparison-round5.png` verifies that single additions no longer paint the `<li>` box itself and the review rail no longer inherits the main content's top whitespace.
7. The initial inline-comment pass kept composition in the rail footer; product review clarified that the editor belongs inside the reviewed content instead.
8. Corrected evidence in `changeset-inline-content-comment-round7.png` verifies that changed green content exposes the “+” action and expands its editor in the document while the rail remains summary-only.
9. Wide-screen and row-level evidence in `changeset-row-comment-wide-round9.png` and `changeset-design-comparison-round9.png` verifies that the rail reaches the viewport edge, the Memory document remains 720px wide, and the complete artifact row exposes exactly one trailing comment action.
10. Collapsed-wide evidence in `changeset-collapsed-wide-round10.png` and `changeset-design-comparison-round10.png` verifies that hiding the review rail expands the document to 960px with no horizontal overflow.
11. Section-scope evidence in `changeset-section-comment-scope-round11.png` and `changeset-section-comparison-round11.png` verifies that only the hovered row exposes a comment action and that the action follows the row text rather than the container edge.

## Implementation checklist

- [x] Render one current Memory document rather than two complete versions.
- [x] Place old content immediately before its replacement.
- [x] Keep additions and removals at their structural location.
- [x] Preserve validation, mode switch, target progress/state, comments, and review completion.
- [x] Use “收起意见 / 展开意见” for the comment-rail toggle.
- [x] Keep colored bullets and group same-line metadata as the minimum diff interval.
- [x] Preserve one original marker and indentation per logical list item.
- [x] Match the prototype review rail and top-level “差异 / 完整内容” hash row.
- [x] Align single-addition and replacement diff backgrounds to identical horizontal bounds.
- [x] Remove the review rail's inherited top gap without moving the main content.
- [x] Compose ChangeSet comments beneath the anchored Memory content, including changed diff rows, with cancel and submit actions.
- [x] Preserve stable base anchors and row-level comment submission on pure deletion rows.
- [x] Preserve stable base anchors and row-level comment submission on locally removed update/rename fields.
- [x] Keep internal Memory anchor paths out of the product-facing comment editor.
- [x] Align the comment summary rail to the far right on wide screens without widening the Memory document.
- [x] Expand the Memory document to 960px on wide screens when the comment rail is collapsed.
- [x] Align one comment action at the end of each content row and group artifact metadata into one comment target.
- [x] Isolate nested section hover states so one row never reveals sibling comment actions.
- [x] Verify typecheck, build, browser interaction tests, real ChangeSet rendering, core interactions, and console errors.

## Follow-up polish

No blocking polish remains. A future iteration could offer optional collapsing of long unchanged sections, but that is outside this request.

final result: passed
