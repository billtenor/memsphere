import assert from "node:assert/strict";
import test from "node:test";
import { isViewPagePath, renderMarkdownContent } from "../src/commands/view.js";
import { browserHtml, shouldRenderMarkdownArtifact, shouldRenderTaskStepArtifact } from "../src/view/browser.js";

test("embedded browser script is valid JavaScript", () => {
  const script = browserHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert(script);
  assert.doesNotThrow(() => new Function(script));
});

test("View page routes are explicit and never absorb API or unknown paths", () => {
  for (const path of [
    "/",
    "/memories",
    "/memories/concepts/Memory",
    "/projects/alpha/memories",
    "/projects/alpha/memories/concepts/Memory",
    "/projects/alpha/changes",
    "/projects/alpha/changes/change-1",
    "/projects/alpha/changes/change-1/reviews/review-1",
    "/tasks",
    "/tasks/run-1",
    "/tasks/run-1/artifact-reviews/review-1",
    "/settings/overview",
    "/settings/participants",
    "/projects/alpha/memories/concepts/Memory/reviews/review-1"
  ]) assert.equal(isViewPagePath(path), true, path);
  for (const path of [
    "/api/memories",
    "/api/unknown",
    "/unknown",
    "/tasks/run-1/other/review-1",
    "/projects/alpha/memories/concepts/Memory/reviews",
    "/memory-reviews/review-1"
  ]) {
    assert.equal(isViewPagePath(path), false, path);
  }
});

test("browser script includes URL parsing, canonical history, and popstate restoration", () => {
  assert.match(browserHtml, /function parseBrowserRoute\(locationLike\)/);
  assert.match(browserHtml, /function currentBrowserUrl\(\)/);
  assert.match(browserHtml, /history\[method\]\(null, "", next\)/);
  assert.match(browserHtml, /window\.addEventListener\("popstate"/);
  assert.doesNotMatch(browserHtml, /\/memory-reviews\//);
  assert.match(browserHtml, /\/projects\/" \+ encodeRoutePart\(state\.currentProject\)/);
  assert.match(browserHtml, /prepareBrowserRoute/);
  assert.match(browserHtml, /\{ page: "memories", project, changeId, fragment \}/);
  assert.match(browserHtml, /memoryBase = state\.changeId && state\.currentProject/);
  assert.match(browserHtml, /\/artifact-reviews\//);
  assert.match(browserHtml, /pendingArtifactMaterial/);
});

test("browser loads summaries by route and fetches details on demand", () => {
  assert.match(browserHtml, /new URLSearchParams\(\{ representation: "summary" \}\)/);
  assert.match(browserHtml, /query\.set\("memory_id", subject\.id\)/);
  assert.match(browserHtml, /query\.set\("change_id", state\.selectedChangeId\)/);
  assert.match(browserHtml, /fetch\("\/api\/runs\?representation=summary"\)/);
  assert.match(browserHtml, /\/api\/memories\/" \+ encodeURIComponent\(summary\.kind\)/);
  assert.match(browserHtml, /\/api\/runs\/" \+ encodeURIComponent\(id\)/);
  assert.match(browserHtml, /\/artifact-reviews\/" \+ encodeURIComponent\(reviewId\)/);
  assert.match(browserHtml, /if \(!changed\) return;/);
  assert.doesNotMatch(browserHtml, /Promise\.all\(\[loadMemories\(\), loadReviews\(\), loadRuns\(\)\]\)/);
});

test("archived Run detail survives active summary refresh without joining Task navigation", () => {
  assert.match(browserHtml, /selectedArchivedDetail\?\.readOnly === true/);
  assert.match(browserHtml, /const activeRuns = state\.runs\.filter\(run => run\.archived !== true && run\.readOnly !== true\)/);
});

test("summary stores do not reuse full Memory or Review list readers", async () => {
  const viewSource = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/commands/view.ts", import.meta.url), "utf8")).then(source => source.replace(/\r\n/g, "\n"));
  const reviewSource = await import("node:fs/promises").then(fs => fs.readFile(new URL("../src/review/store.ts", import.meta.url), "utf8")).then(source => source.replace(/\r\n/g, "\n"));
  const memorySummaryBody = viewSource.match(/async function loadMemorySummaryPayload[\s\S]*?\n}\n\nasync function systemMemoryReferences/)?.[0] || "";
  const reviewSummaryBody = reviewSource.match(/export async function listReviewSummaries[\s\S]*?\n}\n\nasync function readReviewSummary/)?.[0] || "";
  assert.match(memorySummaryBody, /readMemoryFileSummary/);
  assert.doesNotMatch(memorySummaryBody, /loadMemoryPayload|readMemoryFile\(/);
  assert.match(reviewSummaryBody, /readReviewSummary/);
  assert.doesNotMatch(reviewSummaryBody, /listReviews\(/);
});

test("detail loaders ignore responses from a previous Project generation", () => {
  assert.match(browserHtml, /projectGeneration: 0/);
  assert.match(browserHtml, /function resetProjectState\(\) \{\s*state\.projectGeneration \+= 1;/);
  for (const loader of ["loadMemoryDetail", "loadReviewDetail", "loadRunDetail"]) {
    const body = browserHtml.match(new RegExp("async function " + loader + "[\\s\\S]*?\\n    }"))?.[0] || "";
    assert.match(body, /const projectGeneration = state\.projectGeneration/);
    assert.match(body, /if \(projectGeneration !== state\.projectGeneration\) return null;/);
  }
});

test("Review and Run detail loaders reject superseded requests and changed summary revisions", () => {
  for (const [loader, requests] of [["loadReviewDetail", "reviewDetailRequests"], ["loadRunDetail", "runDetailRequests"]]) {
    const body = browserHtml.match(new RegExp("async function " + loader + "[\\s\\S]*?\\n    }"))?.[0] || "";
    assert.match(body, new RegExp("state\\." + requests + "\\.get\\(id\\) !== requestId"));
    assert.match(body, /startingRevision/);
    assert.match(body, /updatedAt/);
  }
  assert.match(browserHtml, /expectedUpdatedAt: current\?\.updatedAt/);
  assert.match(browserHtml, /response\.status === 409/);
});

test("stale page loads cannot release the active route application guard", () => {
  assert.match(browserHtml, /finally \{\s*if \(isCurrentPageLoad\(options\)\) state\.routeApplying = false;/);
});

test("manual view switches supersede an in-flight page load", () => {
  assert.match(browserHtml, /async function setViewMode\(mode, options = \{\}\) \{\s*const generation = \+\+state\.pageLoadGeneration;\s*await projectSwitchChain;\s*if \(generation !== state\.pageLoadGeneration\) return;/);
});

test("ChangeSet preview renders persisted validation diagnostics", () => {
  assert.match(browserHtml, /function renderPreviewIssues\(\)/);
  assert.match(browserHtml, /heading\.textContent = "Validation diagnostics"/);
  assert.match(browserHtml, /const location = issue\.path/);
  assert.match(browserHtml, /item\.textContent = location \+ ": " \+ issue\.message/);
});

test("Settings separates the global and Project configuration workspaces", () => {
  assert.match(browserHtml, /id="settings-tab"/);
  assert.match(browserHtml, /class="brand-settings"/);
  assert.match(browserHtml, /<div class="brand">[\s\S]*<h1>memsphere<\/h1>[\s\S]*id="settings-tab"[\s\S]*&#9881;/);
  assert.match(browserHtml, /class="project-switcher"[\s\S]*id="project-select-label">Project<\/span>[\s\S]*class="project-select"[\s\S]*role="listbox"/);
  assert.doesNotMatch(browserHtml, /id="project-select" class="search"/);
  assert.match(browserHtml, /body\.settings-mode \.view-tabs/);
  assert.match(browserHtml, /state\.viewMode === "settings" \? state\.lastContentViewMode : "settings"/);
  assert.doesNotMatch(browserHtml, /class="view-tab" id="settings-tab"/);
  assert.match(browserHtml, /\["global", "Memsphere", \[\["overview", "概览"\]/);
  assert.match(browserHtml, /\["project", "Project · " \+ state\.currentProject, \[\["overview", "概览"\]/);
  assert.match(browserHtml, /className = "settings-nav-group"/);
  assert.doesNotMatch(browserHtml, /className = "settings-scope"/);
  assert.match(browserHtml, /\["overview", "概览"\]/);
  assert.match(browserHtml, /\["general", "常规"\]/);
  assert.doesNotMatch(browserHtml, /\["storage", "存储"\]/);
  assert.match(browserHtml, /storageTitle\.textContent = "存储位置"/);
  assert.match(browserHtml, /\["view", "View 服务"\]/);
  assert.match(browserHtml, /\["providers", "ACP Provider"\]/);
  assert.match(browserHtml, /\["participants", "参与者配置"\]/);
  assert.match(browserHtml, /执行者/);
  assert.doesNotMatch(browserHtml, /Runner 不能删除/);
  assert.match(browserHtml, /save\.textContent = "保存"/);
  assert.match(browserHtml, /\["general", "view", "providers", "participants"\]\.includes\(state\.settingsModule\)/);
  assert.match(browserHtml, /heading\.setAttribute\("aria-expanded"/);
  assert.doesNotMatch(browserHtml, /检查并保存/);
  assert.match(browserHtml, /settingsPermissionCheck\("使用默认值"/);
  assert.match(browserHtml, /确认配置变更/);
  assert.match(browserHtml, /memsphere view restart/);
  assert.doesNotMatch(browserHtml, /当前运行地址/);
  assert.doesNotMatch(browserHtml, /保存并重启后地址/);
  assert.match(browserHtml, /没有未保存修改/);
  assert.match(browserHtml, /"ACP Provider"/);
  assert.match(browserHtml, /\.settings-select-menu \{ position: absolute; top: calc\(100% \+ 4px\); right: 0; left: 0;/);
  assert.doesNotMatch(browserHtml, /document\.createElement\("select"\)/);
  assert.match(browserHtml, /document\.createElement\("details"\)/);
  assert.match(browserHtml, /Agent 只选择 ACP Provider 与 Model/);
  assert.match(browserHtml, /permissionCount \+ " 项权限"/);
  assert.doesNotMatch(browserHtml, /直接授予/);
  assert.doesNotMatch(browserHtml, /可授予/);
  assert.match(browserHtml, /configurablePermissionIds/);
  assert.doesNotMatch(browserHtml, /Prompt version|Working directory/);
  assert.doesNotMatch(browserHtml, />Debug</);
});

test("Artifact Review opinions render the server-provided Markdown projection", () => {
  assert.match(browserHtml, /if \(opinion\.renderedSummary\) summary\.innerHTML = opinion\.renderedSummary/);
  assert.match(browserHtml, /if \(vote\.renderedComment\) comment\.innerHTML = vote\.renderedComment/);
  assert.match(browserHtml, /if \(comment\.renderedBody\) body\.innerHTML = comment\.renderedBody/);
});

test("memory view recognizes only tagged actions and renders recursive typed structures", () => {
  assert.match(browserHtml, /syntax: \{ zh: "语法版本", yaml: "syntax" \}/);
  assert.match(browserHtml, /memory\.entity\.syntax/);
  assert.match(browserHtml, /step\.tag === "!action"/);
  assert.match(browserHtml, /while \(branch\)/);
  assert.match(browserHtml, /definition\.tag === "!schema"/);
  assert.match(browserHtml, /typeof child === "string"/);
});

test("browser renders current Schema type, format, layout, and item contracts", () => {
  assert.match(browserHtml, /type: \{ zh: "类型", yaml: "type" \}/);
  assert.match(browserHtml, /layout: \{ zh: "布局", yaml: "layout" \}/);
  assert.match(browserHtml, /if \(node\.type\) badges\.push\(t\("type"\) \+ ": " \+ node\.type\)/);
  assert.match(browserHtml, /formatOptions\(node\.format\)\.layout/);
  assert.doesNotMatch(browserHtml, /element_types/);
  assert.match(browserHtml, /item: \{ zh: "元素", yaml: "item" \}/);
  assert.match(browserHtml, /items: \{ zh: "候选元素", yaml: "items" \}/);
  assert.match(browserHtml, /if \(node\.item\)/);
  assert.match(browserHtml, /for \(const \[index, item\] of node\.items\.entries\(\)\)/);
});

test("browser shows explicit optional true metadata", () => {
  assert.match(browserHtml, /badges\.push\("optional: true"\)/);
  assert.match(browserHtml, /\(optional: true\)/);
});

test("browser renders Memory refs as direct navigation links", () => {
  assert.match(browserHtml, /function renderMemoryRef\(ref, path\)/);
  assert.match(browserHtml, /className = "memory-ref-link"/);
  assert.match(browserHtml, /function memoryByReference\(reference\)/);
  assert.match(browserHtml, /function openMemoryReference\(reference\)/);
  assert.match(browserHtml, /state\.selectedId = target\.id;/);
  assert.doesNotMatch(browserHtml, /className = "section ref-node"/);
});

test("browser renders Schema Repeat structure and its Run control command", () => {
  assert.match(browserHtml, /function renderSchemaRepeat\(node, depth, path\)/);
  assert.match(browserHtml, /child\.tag === "!repeat"/);
  assert.match(browserHtml, /body\.append\(children\)/);
  assert.doesNotMatch(browserHtml, /body\.append\(blockTitle\("body"\), children\)/);
  assert.match(browserHtml, /"memsphere run repeat <count> --run "/);
  assert.match(browserHtml, /const isRepeat = step\.kind === "repeat" && step\.repeat/);
});

test("task view renders Schema progress, managed draft, and global adjustment state", () => {
  assert.match(browserHtml, /function renderSchemaWriting\(run, step\)/);
  assert.match(browserHtml, /snapshot\.progress\.completed \+ "\/" \+ snapshot\.progress\.total/);
  assert.match(browserHtml, /snapshot\.currentField\?\.sources/);
  assert.match(browserHtml, /snapshot\.draft\.filePath/);
  assert.match(browserHtml, /snapshot\.draft\.renderedContent/);
  assert.match(browserHtml, /snapshot\.draft\.status === "awaiting_finalization"/);
  assert.match(browserHtml, /run\.schemaWriting\?\.parentStepId/);
});

test("task step artifact area is hidden when no event exists", () => {
  assert.equal(shouldRenderTaskStepArtifact(undefined), false);
  assert.equal(shouldRenderTaskStepArtifact(null), false);
});

test("task step artifact area is shown when an event exists", () => {
  assert.equal(shouldRenderTaskStepArtifact({ stepId: "flow-1", artifact: { value: "done" } }), true);
});

test("Task view exposes only Artifact Review and never falls back to Task Review", () => {
  assert.match(browserHtml, /el\.reviewToggle\.hidden = state\.viewMode === "task" \? !taskHasArtifactReview : false/);
  assert.match(browserHtml, /if \(!artifactReviewSummariesForRun\(\)\.length\) return/);
  assert.doesNotMatch(browserHtml, /Only done tasks can create a review/);
  assert.doesNotMatch(browserHtml, /Task review ·/);
});

test("Memory review creation has no Reserved source branch", () => {
  assert.doesNotMatch(browserHtml, /selectedMemory\(\)\?\.source === "reserved"/);
  assert.doesNotMatch(browserHtml, /Import reserved memory before creating a review/);
});

test("review mutations use button action guards", () => {
  assert.match(browserHtml, /runButtonAction\(el\.createReview, createReview\)/);
  assert.match(browserHtml, /runButtonAction\(el\.submitReview, submitReview\)/);
  assert.match(browserHtml, /runButtonAction\(save, async \(\) => \{/);
  assert.match(browserHtml, /runButtonAction\(save, \(\) => updateComment\(comment\.id, body\)\)/);
});

test("Artifact Review renders Agent progress and exposes retry only for failed Agents", () => {
  assert.match(browserHtml, /assignment\.actorKind === "agent"/);
  assert.match(browserHtml, /renderArtifactReviewAgentWorkspace\(context, selectedRound\)/);
  assert.match(browserHtml, /const currentRoundSelected = selectedRound\?\.id === review\.currentRoundId/);
  assert.match(browserHtml, /currentRoundSelected\s*&& assignment\.actorKind === "agent"\s*&& assignment\.status === "failed"\s*&& review\.status === "pending"/);
  assert.match(browserHtml, /retryArtifactReviewAgent\(context\)/);
  assert.match(browserHtml, /attempt\.failure\.code \+ ": " \+ attempt\.failure\.message/);
  assert.match(browserHtml, /state\.artifactReviewRetries/);
  assert.match(browserHtml, /Repeated advisory groups/);
  assert.match(browserHtml, /Decision intent: /);
  assert.match(browserHtml, /"实现证据：" \+ \(referenced \? "已引用" : "未引用"\)/);
});

test("Artifact Review comment severity belongs to the card header", () => {
  assert.match(browserHtml, /header\.className = "artifact-review-comment-head"/);
  assert.match(browserHtml, /header\.append\(pill\(artifactReviewSeverityLabel\(comment\.severity\)/);
  assert.match(browserHtml, /card\.append\(header, body\)/);
  assert.match(browserHtml, /\.artifact-review-comment-head \{ display: flex; justify-content: space-between;/);
});

test("Changes is a first-class route with immutable ChangeSet Review snapshots", () => {
  assert.match(browserHtml, /id="changes-tab"/);
  assert.match(browserHtml, /\/projects\/" \+ encodeRoutePart\(state\.currentProject\) \+ "\/changes"/);
  assert.match(browserHtml, /\/api\/changes\/" \+ encodeURIComponent\(changeId\)/);
  assert.match(browserHtml, /kind === "changeset"/);
  assert.match(browserHtml, /\/snapshots"/);
  assert.match(browserHtml, /Loading immutable Review snapshot/);
  assert.match(browserHtml, /Historical Review snapshot/);
  assert.match(browserHtml, /detail\.targetMemories/);
  assert.match(browserHtml, /comment\.source === "changeset" \? "changes" : "memory"/);
  assert.match(browserHtml, /review\.source !== "changeset" && !review\.comments\.length/);
  assert.match(browserHtml, /change\.valid !== true/);
  assert.match(browserHtml, /Fix the validation diagnostics and run memory change validate again/);
});

test("Artifact Review evidence is selected in the artifact pane", () => {
  assert.match(browserHtml, /artifactReviewMaterialBySubmission: \{\}/);
  assert.match(browserHtml, /function renderArtifactReviewMaterialSelector\(context, selectedMaterial\)/);
  assert.match(browserHtml, /artifact: context\.submission\.contractArtifact/);
  assert.match(browserHtml, /context\.submission\.contextArtifacts/);
  assert.match(browserHtml, /commentable: false/);
  assert.doesNotMatch(browserHtml, /function renderArtifactReviewEvidencePackage/);
});

test("Artifact Review exposes read-only Agent Activity inside participant rows", () => {
  assert.match(browserHtml, /artifactReviewActivities: \{\}/);
  assert.match(browserHtml, /function syncArtifactReviewActivities\(force = false\)/);
  assert.match(browserHtml, /function renderAgentActivity\(review, round, assignment, entry\)/);
  assert.match(browserHtml, /toggle\.setAttribute\("aria-expanded"/);
  assert.match(browserHtml, /row\.append\(renderAgentActivity\(review, selectedRound, assignment, activity\)\)/);
  assert.match(browserHtml, /entry\.pinnedToBottom = distance < 20/);
  assert.match(browserHtml, /entry\.events = \[\.\.\.byId\.values\(\)\]/);
  assert.match(browserHtml, /const assignments = \(review\.round\.assignments \|\| \[\]\)\.filter\(assignment => assignment\.actorKind !== "agent"\)/);
  assert.match(browserHtml, /\.artifact-review-activity \{ grid-column: 1 \/ -1;/);
  assert.match(browserHtml, /artifact-review-attempt-select/);
  assert.match(browserHtml, /artifact-review-agent-summary-row/);
  assert.match(browserHtml, /artifact-review-activity-toggle/);
  assert.match(browserHtml, /displayLanguage === "zh" \? "查看详情" : "View details"/);
  assert.match(browserHtml, /trigger\.setAttribute\("aria-label", displayLanguage === "zh" \? "选择 Attempt" : "Select attempt"\)/);
  assert.match(browserHtml, /existing\.querySelector\("\.artifact-review-select-menu:not\(\[hidden\]\)"\)/);
  assert.match(browserHtml, /message: "消息"/);
  assert.match(browserHtml, /tool: "工具调用"/);
  assert.match(browserHtml, /plan: "执行计划"/);
  assert.match(browserHtml, /thought: "分析"/);
  assert.match(browserHtml, /lifecycle: "运行状态"/);
  assert.match(browserHtml, /head\.append\(kind, time\)/);
  assert.match(browserHtml, /row\.append\(head, title\)/);
  assert.match(browserHtml, /\.artifact-review-activity-event-head time \{ flex: 0 0 auto; white-space: nowrap;/);
  assert.match(browserHtml, /event\.status && event\.status !== "completed"/);
  assert.match(browserHtml, /in_progress: "进行中"/);
  assert.doesNotMatch(browserHtml, /artifact-review-activity-head select/);
});

test("Artifact Review identity controls use Role names and an anchored custom menu", () => {
  assert.match(browserHtml, /function artifactReviewRoleName\(assignment\)/);
  assert.match(browserHtml, /artifact-review-actor-select/);
  assert.match(browserHtml, /option\.textContent = artifactReviewRoleName\(assignment\)/);
  assert.match(browserHtml, /name\.textContent = artifactReviewRoleName\(assignment\)/);
  assert.match(browserHtml, /\.artifact-review-select-menu \{ position: absolute; top: calc\(100% \+ 4px\); right: 0; left: 0;/);
});

test("Artifact Review uses a resizable evidence modal with stable Submission targets", () => {
  assert.match(browserHtml, /<dialog class="artifact-review-modal" id="artifact-review-modal"/);
  assert.match(browserHtml, /dialog\.artifact-review-modal \{[^}]*width: 90vw;[^}]*max-width: none;[^}]*height: 90dvh;[^}]*max-height: none;/);
  assert.match(browserHtml, /\.artifact-review-modal-pane \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/);
  assert.match(browserHtml, /role="separator" aria-controls="artifact-review-artifact-pane artifact-review-review-pane"/);
  assert.match(browserHtml, /artifact-review-mobile-tabs/);
  assert.match(browserHtml, /id="artifact-review-scope-panel"/);
  assert.match(browserHtml, /id="artifact-review-my-panel"/);
  assert.match(browserHtml, /id="artifact-review-progress-panel"/);
  assert.match(browserHtml, /id="artifact-review-record-panel"/);
  assert.doesNotMatch(browserHtml, /id="artifact-review-modal-meta"/);
  assert.doesNotMatch(browserHtml, /id="artifact-review-round-mode"/);
  assert.match(browserHtml, /controls\.append\(renderArtifactReviewRoundTimeline\(context\)\)/);
  assert.match(browserHtml, /scopeMeta\.append\(\s*pill\(/);
  assert.match(browserHtml, /pill\(review\.policyId\)/);
  assert.match(browserHtml, /artifactReviewProgressSummary\(scopeRound\)/);
  assert.match(browserHtml, /id="artifact-review-submit-area" class="artifact-review-operation-group artifact-review-submit-area"/);
  assert.match(browserHtml, /const voteGroup = artifactReviewOperationGroup\(/);
  assert.match(browserHtml, /const commentGroup = artifactReviewOperationGroup\(/);
  assert.match(
    browserHtml,
    /const commentGroup = artifactReviewOperationGroup\([\s\S]*el\.artifactReviewMyContent\.append\(commentGroup\);[\s\S]*const voteGroup = artifactReviewOperationGroup\([\s\S]*el\.artifactReviewMyContent\.append\(voteGroup\);/
  );
  assert.match(browserHtml, /state\.artifactReviewOpenSelect = open \? "identity:" \+ review\.id : ""/);
  assert.match(browserHtml, /submissionId: reviewContext\.submission\.id/);
  assert.match(browserHtml, /sourceHash: reviewContext\.submission\.digest/);
  assert.match(browserHtml, /context: String\(snapshot \?\? ""\)\.trim\(\)\.slice\(0, 500\)/);
  assert.match(browserHtml, /context\.rounds\.find\(round => round\.submissionId === comment\.anchor\.submissionId\)/);
  assert.match(browserHtml, /artifact-review-target-located/);
  assert.match(browserHtml, /Unable to locate:/);
  assert.match(browserHtml, /artifactReviewSummariesForRun\(run\)\.find\(review => review\.stepId === step\.id\)/);
  assert.match(browserHtml, /controls\.append\(renderArtifactReviewRoundTimeline\(context\)\)/);
  assert.match(browserHtml, /controls\.append\(renderArtifactReviewHistorySelector\(context\)\)/);
  assert.match(browserHtml, /blockTitle\(t\("voteSummary"\)\)/);
  assert.match(browserHtml, /blockTitle\(t\("reviewComments"\)\)/);
  assert.match(browserHtml, /scrollToArtifactReviewParticipant\(assignment\)/);
  assert.match(browserHtml, /artifact-review-opinion-located/);
  assert.match(browserHtml, /renderArtifactReviewSelector\(review\)/);
  assert.match(browserHtml, /state\.artifactReviewSelectedByRun\[run\.id\] = review\.id/);
  assert.match(browserHtml, /const artifactReview = state\.viewMode === "task" \? defaultArtifactReviewSummary\(run\) : null/);
  assert.match(browserHtml, /if \(run\.artifactReview\) return run\.artifactReview/);
  assert.match(browserHtml, /new Date\(review\.updatedAt \|\| review\.createdAt \|\| 0\)\.getTime\(\)/);
  assert.match(browserHtml, /run && state\.artifactReviewModalOpen \? state\.artifactReviewSelectedByRun\[run\.id\] : ""/);
  assert.match(browserHtml, /button\.className = "pill current-step-jump";/);
  assert.match(browserHtml, /button\.dataset\.artifactReviewId = review\.id;/);
  assert.match(browserHtml, /state\.artifactReviewReturnScrollY = window\.scrollY;/);
  assert.match(browserHtml, /html\.artifact-review-modal-open, body\.artifact-review-modal-open \{ overflow: hidden; overscroll-behavior: none; \}/);
  assert.match(browserHtml, /\.artifact-review-modal-pane \{[^}]*overscroll-behavior: contain;/);
  assert.match(browserHtml, /document\.documentElement\.classList\.toggle\("artifact-review-modal-open", state\.artifactReviewModalOpen\);/);
  assert.match(browserHtml, /state\.artifactReviewReturnFocusTop = active instanceof HTMLElement/);
  assert.match(browserHtml, /focusTarget\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(browserHtml, /window\.scrollBy\(0, focusTarget\.getBoundingClientRect\(\)\.top - returnFocusTop\);/);
  assert.match(browserHtml, /window\.scrollTo\(0, returnScrollY\);/);
  assert.doesNotMatch(browserHtml, /artifact-review-action-button/);
  assert.match(browserHtml, /renderArtifactReviewRoundSummary\(context, selectedRound, viewingHistory, el\.artifactReviewModalComments\);/);
  assert.match(browserHtml, /renderArtifactReviewSubmittedOpinions\(selectedRound, el\.artifactReviewModalComments, false\)/);
  assert.match(browserHtml, /allowDisposition\s*&& advisory\s*&& comment\.id/);
  assert.match(browserHtml, /entries\.sort\(\(left, right\) => new Date\(right\.submittedAt \|\| 0\)\.getTime\(\) - new Date\(left\.submittedAt \|\| 0\)\.getTime\(\)\)/);
  assert.ok(
    browserHtml.indexOf("renderArtifactReviewRoundSummary(context, selectedRound, viewingHistory, el.artifactReviewModalComments);")
      < browserHtml.indexOf("renderArtifactReviewSubmittedOpinions("),
    "round summary should render before the opinion timeline"
  );
});

test("memory and task artifacts show participating Review Slot names", () => {
  assert.match(browserHtml, /reviewers: \{ zh: "评审", yaml: "Review" \}/);
  assert.match(browserHtml, /state\.actorNames = state\.payload\.actorNames \|\| \{\}/);
  assert.match(browserHtml, /appendArtifactReviewRoles\(row, step\)/);
  assert.match(browserHtml, /artifactLine\.className = "artifact-meta-line"/);
  assert.match(browserHtml, /reviewLine\.className = "artifact-meta-line artifact-review-line"/);
  assert.match(browserHtml, /\.artifact-row \{ display: grid;[^}]*justify-items: start;[^}]*justify-content: start;/);
  assert.match(browserHtml, /\.artifact-meta-line \{ display: flex;[^}]*justify-content: flex-start;/);
  assert.match(browserHtml, /const slots = Array\.isArray\(artifact\.review\) \? artifact\.review : \[\]/);
  assert.match(browserHtml, /return Object\.fromEntries\(slots\.map\(slot => \[slot, \{ actorIds: \[\] \}\]\)\)/);
  assert.match(browserHtml, /roleId\.includes\("::"\) \? roleId\.slice\(roleId\.lastIndexOf\("::"\) \+ 2\) : roleId/);
});

test("task view supports audited runtime Review Slot rebinding", () => {
  assert.match(browserHtml, /function renderRunBindings\(run\)/);
  assert.match(browserHtml, /className = "run-binding-toggle"/);
  assert.match(browserHtml, /toggle\.setAttribute\("aria-expanded", String\(expanded\)\)/);
  assert.match(browserHtml, /body\.hidden = !expanded/);
  assert.match(browserHtml, /expandedRunBindings: new Set\(\)/);
  assert.match(browserHtml, /换绑只影响尚未创建的 Review/);
  assert.match(browserHtml, /function updateRunBinding\(run, slot, skip, actorIds\)/);
  assert.match(browserHtml, /settingsFetch\("\/api\/runs\/" \+ encodeURIComponent\(run\.id\) \+ "\/bindings/);
  assert.match(browserHtml, /run\.bindingChanges/);
  assert.match(browserHtml, /run\.bindingSnapshot\?\.slots/);
  assert.match(browserHtml, /existing Reviews preserved/);
  assert.match(browserHtml, /className = "run-binding-actors"/);
});

test("markdown artifacts use rendered markdown content when available", () => {
  assert.equal(shouldRenderMarkdownArtifact({ format: "markdown", renderedContent: "<h1>Title</h1>" }), true);
  assert.equal(shouldRenderMarkdownArtifact({ format: "markdown" }), false);
  assert.equal(shouldRenderMarkdownArtifact({ format: "string", renderedContent: "<h1>Title</h1>" }), false);
});

test("renderMarkdownContent renders basic markdown blocks", () => {
  const html = renderMarkdownContent("# Title\n\n- one\n- two\n\n```ts\nconst x = 1;\n```");

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<pre><code class="language-ts">const x = 1;\n<\/code><\/pre>/);
});

test("renderMarkdownContent renders GFM tables with semantic structure", () => {
  const html = renderMarkdownContent("| Name | Value |\n| --- | --- |\n| Alpha | `one` |\n| Beta | &lt;safe&gt; |");

  assert.match(html, /<div class="markdown-table-scroll"><table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /<th>Name<\/th>/);
  assert.match(html, /<td>Alpha<\/td>/);
  assert.match(html, /<td><code>one<\/code><\/td>/);
  assert.match(html, /&lt;safe&gt;/);
});

test("renderMarkdownContent does not mistake pipe text or code fences for tables", () => {
  const pipeText = renderMarkdownContent("Alpha | Beta");
  const codeBlock = renderMarkdownContent("```text\n| Name | Value |\n| --- | --- |\n| Alpha | Beta |\n```");

  assert.doesNotMatch(pipeText, /<table>/);
  assert.doesNotMatch(codeBlock, /<table>/);
  assert.match(codeBlock, /<pre><code class="language-text">/);
});

test("renderMarkdownContent escapes raw HTML", () => {
  const html = renderMarkdownContent("<script>alert(1)</script>");

  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("renderMarkdownContent rejects unsafe links and annotates safe links", () => {
  const unsafe = renderMarkdownContent("[bad](javascript:alert(1))");
  assert.doesNotMatch(unsafe, /href="javascript:/i);

  const safe = renderMarkdownContent("[ok](https://example.com)");
  assert.match(safe, /href="https:\/\/example\.com"/);
  assert.match(safe, /target="_blank"/);
  assert.match(safe, /rel="noopener noreferrer nofollow"/);
});

test("markdown body resets inherited pre-wrap whitespace", () => {
  assert.match(browserHtml, /\.markdown-body \{[^}]*white-space: normal;/);
});

test("artifact review comment targets preserve the shared markdown spacing", () => {
  assert.match(browserHtml, /\.artifact-review-artifact-content \.commentable \{ margin-block: 0; \}/);
  assert.match(browserHtml, /\.artifact-review-artifact-content \.commentable-body \{ white-space: normal; \}/);
  assert.match(
    browserHtml,
    /\.artifact-review-artifact-content \.markdown-body > \.commentable:first-child \.commentable-body > :first-child \{ margin-top: 0; \}/
  );
  assert.match(
    browserHtml,
    /\.artifact-review-artifact-content \.markdown-body > \.commentable:last-child \.commentable-body > :last-child \{ margin-bottom: 0; \}/
  );
});

test("markdown tables use a horizontal scrolling container", () => {
  assert.match(browserHtml, /\.markdown-table-scroll \{[^}]*max-width: 100%;[^}]*overflow-x: auto;/);
  assert.match(browserHtml, /\.markdown-body table \{[^}]*width: max-content;[^}]*min-width: 100%;/);
});

test("task view switches to two columns on compact desktop screens", () => {
  const compactLayout = browserHtml.match(/@media \(max-width: 1400px\) \{([\s\S]*?)\n    \}/)?.[1];
  const narrowLayout = browserHtml.match(/@media \(max-width: 1100px\) \{([\s\S]*?)\n    \}/)?.[1];

  assert(compactLayout);
  assert(narrowLayout);
  assert.match(compactLayout, /body\.task-mode \.shell \{ grid-template-columns: 280px minmax\(0, 1fr\) 0 0; \}/);
  assert.match(narrowLayout, /\.flow-head \{ grid-template-columns: 1fr;/);
  assert.match(narrowLayout, /\.artifact-row \{ justify-content: flex-start; min-width: 0; \}/);
});

test("Review expands the shell with a resizable divider on demand", () => {
  assert.match(browserHtml, /\.shell \{ display: grid; grid-template-columns: 300px minmax\(0, 1fr\) 0 0;/);
  assert.match(browserHtml, /body\.review-drawer-open \.shell \{ grid-template-columns: 300px minmax\(0, 1fr\) 8px var\(--review-width\); \}/);
  assert.match(browserHtml, /\.review \{ min-width: 0; overflow: hidden; visibility: hidden;/);
  assert.doesNotMatch(browserHtml, /position: fixed; z-index: 30;/);
  assert.doesNotMatch(browserHtml, /function isCompactReviewLayout/);
});

test("flow cards can shrink inside the task grid", () => {
  assert.match(browserHtml, /\.flow-item \{ min-width: 0;/);
});

test("Review has accessible open and close controls", () => {
  assert.match(browserHtml, /id="review-toggle"[^>]*aria-controls="review-panel"[^>]*aria-expanded="false"/);
  assert.match(browserHtml, /id="review-close"/);
  assert.match(browserHtml, /id="review-resizer"[^>]*role="separator"[^>]*aria-controls="review-panel"/);
  assert.match(browserHtml, /function beginReviewResize\(event\)/);
  assert.match(browserHtml, /localStorage\.setItem\(reviewPanelWidthKey, String\(clamped\)\)/);
  assert.match(browserHtml, /function setReviewDrawer\(open\)/);
  assert.match(browserHtml, /event\.key === "Escape" && state\.reviewDrawerOpen/);
  assert.match(browserHtml, /body\.review-drawer-open \.review \{ overflow: auto; visibility: visible; pointer-events: auto;/);
});

test("node comment controls stay contextual instead of permanently occupying headers", () => {
  assert.match(browserHtml, /\.target-add \{ width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; line-height: 1; opacity: 0;/);
  assert.match(browserHtml, /\.review-active \.section-header:hover \.target-add/);
  assert.match(browserHtml, /body:not\(\.review-active\) \.section-header \{ grid-template-columns: 22px minmax\(0, 1fr\) auto; \}/);
  assert.match(browserHtml, /body:not\(\.review-active\) \.schema-field-content \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
});

test("comment controls lead their node content and node editors open at the top", () => {
  assert.match(browserHtml, /grid-template-columns: 22px 24px minmax\(0, 1fr\) auto/);
  assert.match(browserHtml, /button\.insertBefore\(targetButton, button\.querySelector\("\.node-title"\)\)/);
  assert.match(browserHtml, /th\.prepend\(commentButton/);
  assert.match(browserHtml, /content\.append\(targetButton, title, meta\)/);
  assert.match(browserHtml, /if \(insertAtStart\) host\.prepend\(editor\);/);
});

test("comment freshness compares the saved source snapshot instead of rendered control text", () => {
  assert.match(browserHtml, /body\.dataset\.commentSnapshot = String\(snapshot \?\? ""\);/);
  assert.match(browserHtml, /button\.dataset\.commentSnapshot = String\(text \?\? ""\);/);
  assert.match(browserHtml, /data-legacy-anchor/);
  assert.match(browserHtml, /hashSnapshot\(snapshot\) === comment\.location\.hash/);
  assert.doesNotMatch(browserHtml, /hashSnapshot\(node\.textContent \|\| ""\)/);
});

test("saving a comment restores its expanded, anchored location", () => {
  assert.match(browserHtml, /const comment = await addComment\(target, snapshot, body, location, context\);/);
  assert.match(browserHtml, /if \(comment\) \{\s*state\.inlineCommentDraft = null;\s*editor\.remove\(\);\s*scrollToComment\(comment\);/);
  assert.match(browserHtml, /node\.dataset\.commentSnapshot \?\? node\.querySelector\("\.commentable-body"\)\?\.dataset\.commentSnapshot/);
});

test("Artifact Review draft conflicts recover without surfacing alert errors", () => {
  assert.match(browserHtml, /artifactReviewDrafts: \{\}/);
  assert.match(browserHtml, /function mergeArtifactReviewDraft\(serverDraft, entry\)/);
  assert.match(browserHtml, /response\.status === 409/);
  assert.match(browserHtml, /fetchArtifactReviewContext\(context\.review\.id, context\.review\.currentRoundId, context\.assignment\.actorId\)/);
  assert.match(browserHtml, /const retry = await fetch\(artifactReviewAssignmentUrl\(latestContext, "draft"\)/);
  assert.match(browserHtml, /function syncArtifactReviewStatusMessage\(context\)/);
  assert.match(browserHtml, /if \(hasOpenInlineEditor\(\)\) syncArtifactReviewStatusMessage\(state\.artifactReviewContext \|\| context\);/);
  assert.doesNotMatch(browserHtml, /throw new Error\(t\("round"\) \+ " revision conflict; your text is still in this page"\)/);
});

test("Artifact Review keeps local draft text across conflict recovery renders", () => {
  assert.match(browserHtml, /composerText: ""/);
  assert.match(browserHtml, /textarea\.value = entry\?\.composerText \|\| "";/);
  assert.match(browserHtml, /activeEntry\.composerText = textarea\.value/);
  assert.match(browserHtml, /completeArtifactReviewLocalDraft\(context, clearComposer = false\)/);
  assert.match(browserHtml, /clearComposerOnSuccess: true/);
  assert.match(browserHtml, /const artifactReviewScope = currentArtifactReviewDraftScope\(\);/);
  assert.match(browserHtml, /state\.inlineCommentDraft = artifactReviewScope\s*\?\s*\{\s*target,\s*snapshot,\s*location,\s*context,\s*insertAtStart,\s*body: initialBody,\s*artifactReviewScope\s*\}\s*: null;/);
  assert.match(browserHtml, /textarea\.addEventListener\("input", \(\) => \{[\s\S]*?state\.inlineCommentDraft\.body = textarea\.value;/);
  assert.match(browserHtml, /if \(comment\) \{\s*state\.inlineCommentDraft = null;\s*editor\.remove\(\);\s*scrollToComment\(comment\);/);
  assert.match(browserHtml, /function restoreOpenInlineEditor\(\)/);
  assert.match(browserHtml, /if \(!draft\?\.artifactReviewScope \|\| !canComment\(\)\) return;/);
  assert.match(browserHtml, /sameArtifactReviewDraftScope\(draft\.artifactReviewScope, currentArtifactReviewDraftScope\(\)\)/);
});

test("initial loading validates the saved review only after its subject data is available", () => {
  assert.match(browserHtml, /if \(targetMode === "memory"\) await loadMemories\(\);\s*else if \(targetMode === "task"\) await loadRuns\(\{ loadDetail: false \}\);\s*else if \(targetMode === "changes"\) await loadChanges\(\);\s*else await loadSettings\(\);[\s\S]*?ensureSelectedReview\(\);/);
});

test("task polling does not replace active editors or open Artifact Review selectors", () => {
  assert.match(browserHtml, /if \(hasActiveTaskInteraction\(\)\) \{\s*syncArtifactReviewActivities\(\)\.catch\(console\.error\);\s*\} else \{/);
  assert.match(browserHtml, /loadRuns\(\)\.then\(changed => \{\s*if \(!changed\) return;[\s\S]*if \(hasActiveTaskInteraction\(\)\) \{[\s\S]*taskPollingRenderPending = true/);
  assert.match(browserHtml, /function refreshAgentActivityDom\([\s\S]*existing\.replaceWith\(renderAgentActivity/);
  assert.match(browserHtml, /artifact-review-select-menu:not\(\[hidden\]\)/);
  assert.match(browserHtml, /document\.activeElement\?\.matches\?\.\("\.artifact-review-select"\)/);
  assert.match(browserHtml, /Object\.values\(state\.artifactReviewActivities\)\.some\(entry => entry\.expanded && !entry\.pinnedToBottom\)/);
  assert.match(browserHtml, /if \(nextCursor !== cursor \|\| entry\.error !== error \|\| entry\.loaded !== loaded\) \{\s*refreshAgentActivityDom/);
  assert.match(browserHtml, /if \(detail\) Object\.assign\(selected, detail, \{ eventCount: detail\.events\?\.length \|\| 0 \}\);\s*state\.taskDetailReloadPending = selected\.id;/);
  assert.match(browserHtml, /function flushPendingTaskDetail\(\)[\s\S]*loadRunDetail\(id\)\.then/);
});

test("section title comments render inline in the expanded node", () => {
  assert.match(browserHtml, /function appendSectionHeaderThread\(body, anchor, snapshot\)/);
  assert.match(browserHtml, /appendSectionHeaderThread\(body, headerAnchor, name\);/);
});

test("opening a legacy comment falls back to its nested legacy anchor", () => {
  assert.match(browserHtml, /\[data-legacy-anchor="' \+ CSS\.escape\(anchor\) \+ '"\]/);
  assert.match(browserHtml, /section\.contains\(target\)\) section\.classList\.add\("open"\)/);
});

test("comment cards label their navigation action as Go to", () => {
  assert.match(browserHtml, /open\.textContent = "Go to"/);
  assert.doesNotMatch(browserHtml, /open\.textContent = "Open"/);
});

test("browser does not expose Reserved Memory as a second runtime source", () => {
  assert.doesNotMatch(browserHtml, /\/api\/reserved-memories/);
  assert.doesNotMatch(browserHtml, /loadReservedMemories/);
  assert.doesNotMatch(browserHtml, /filteredReservedMemories/);
  assert.doesNotMatch(browserHtml, /importReservedMemory/);
});

test("browser can hide installed system memory from the Project Catalog", () => {
  assert.match(browserHtml, /hideSystemMemoriesKey = "memsphere\.hideSystemMemories\.v1"/);
  assert.match(browserHtml, /hideSystemMemories: localStorage\.getItem\(hideSystemMemoriesKey\) !== "false"/);
  assert.match(browserHtml, /if \(state\.hideSystemMemories && isSystemMemory\(memory\)\) return false;/);
  assert.match(browserHtml, /return memory\?\.system === true;/);
  assert.doesNotMatch(browserHtml, /systemMemoryPaths/);
  assert.match(browserHtml, /text\.textContent = t\("hideSystemMemories"\)/);
});

test("browser exposes archive controls for done reviews and runs", () => {
  assert.match(browserHtml, /review-archive/);
  assert.match(browserHtml, /task-card-archive/);
  assert.match(browserHtml, /\/api\/archive\/reviews\//);
  assert.match(browserHtml, /\/api\/archive\/runs\//);
  assert.match(browserHtml, /archiveDoneOnly/);
});

test("Task titles use the Run name and keep the Procedure name in details", () => {
  assert.match(browserHtml, /function runDisplayName\(run\)/);
  assert.match(browserHtml, /return run\?\.name\?\.trim\(\) \|\| run\?\.procedureName \|\| "";/);
  assert.match(browserHtml, /title\.textContent = runDisplayName\(run\);/);
  assert.match(browserHtml, /el\.title\.textContent = runDisplayName\(run\);/);
  assert.match(browserHtml, /pill\(t\("procedureName"\) \+ ": " \+ run\.procedureName\)/);
  assert.match(browserHtml, /run start &lt;procedure&gt; --name &lt;run-name&gt;/);
});

test("browser renders recursive Statement sections and keeps suggestions separate", () => {
  assert.match(browserHtml, /suggests: \{ zh: "建议", yaml: "suggests" \}/);
  assert.match(browserHtml, /sections: \{ zh: "章节", yaml: "sections" \}/);
  assert.match(browserHtml, /appendList\(target, t\("suggests"\), node\.suggests, "suggests", path\)/);
  assert.match(browserHtml, /memory\.kind === "statements"\) el\.detail\.append\(renderStatement/);
  assert.match(browserHtml, /function renderStatement\(node, depth, path, fallbackName = t\("statements"\), anchor = "statement:" \+ path\)/);
  assert.match(browserHtml, /for \(const \[index, child\] of node\.sections\.entries\(\)\)/);
  assert.match(browserHtml, /children\.append\(renderStatement\(child, depth \+ 1, childPath, t\("statements"\), anchor \+ ":sections\["/);
  assert.match(browserHtml, /sectionHeader\(name, "!statement", path, anchor\)/);
  assert.match(browserHtml, /renderStatement\(definition, 1, path, "", path\)/);
});

test("browser renders Action contracts, inline schemas, and final artifacts as distinct task UI", () => {
  assert.match(browserHtml, /function renderActionContracts\(step/);
  assert.match(browserHtml, /step\.asserts/);
  assert.match(browserHtml, /step\.suggests/);
  assert.match(browserHtml, /const fieldAnchor = key \+ "\[" \+ \(index \+ 1\) \+ "\]"/);
  assert.match(browserHtml, /anchorPrefix \? anchorPrefix \+ "\." \+ fieldAnchor : fieldAnchor/);
  assert.match(browserHtml, /item\.append\(commentable\(value, target, value, anchor/);
  assert.match(browserHtml, /function renderInlineSchemaDetails\(step, expanded = false\)/);
  assert.match(browserHtml, /inline schema/);
  assert.match(browserHtml, /const section = renderSchema\(schema, 1, "inline-schema:" \+ identity, t\("inlineSchema"\)\)/);
  assert.match(browserHtml, /section\.classList\.add\("inline-schema-section"\)/);
  assert.match(browserHtml, /wrap\.append\(blockTitle\(t\("artifact"\)\), section\)/);
  assert.match(browserHtml, /body\.append\(blockTitle\(t\("fields"\)\), children\)/);
  assert.match(browserHtml, /function renderSimpleSchemaField\(name, path\)[\s\S]*field\.className = "schema-field-plain"/);
  assert.doesNotMatch(browserHtml, /function renderSimpleSchemaField\(name, path\)[\s\S]*sectionHeader\(name, "string"/);
  assert.match(browserHtml, /function renderFinalArtifacts\(run\)/);
  assert.match(browserHtml, /event\.artifact\.final/);
  assert.match(browserHtml, /renderStructuredAction\(step, anchor\)[\s\S]*renderActionContracts\(step, null, anchor\)/);
  assert.match(browserHtml, /renderStructuredControlHead\(step, anchor, labelText[\s\S]*renderInlineSchemaDetails\(step\)/);
  assert.match(browserHtml, /function inlineSchemaTogglePill\(schema\)/);
  assert.match(browserHtml, /function inlineSchemaSummary\(schema\)/);
});

test("browser marks v1 runs read-only and shows v2 Artifact validation metadata", () => {
  assert.match(browserHtml, /legacyReadOnly: \{ zh: "旧版只读", yaml: "v1 read-only" \}/);
  assert.match(browserHtml, /run\.contractVersion === 1 \|\| run\.readOnly/);
  assert.match(browserHtml, /event\.artifact\.type/);
  assert.match(browserHtml, /event\.artifact\.validation\?\.status === "passed"/);
});

test("browser renders Procedure assertions in memory and active run views", () => {
  assert.match(browserHtml, /appendTextBlocks\(wrap, entity\)/);
  assert.match(browserHtml, /function renderRunProcedureAsserts\(run\)/);
  assert.match(browserHtml, /function activeRunProcedureAsserts\(run\)/);
  assert.match(browserHtml, /frame\.asserts/);
  assert.match(browserHtml, /"task:" \+ run\.id \+ ":procedure:asserts\["/);
  assert.match(browserHtml, /commentKind: "asserts"/);
});

test("task calls use task-scoped review anchors and navigate to Memory", () => {
  assert.match(browserHtml, /function renderTaskCall\(step, run\)/);
  assert.match(browserHtml, /taskAnchor\(run, step, "call"\)/);
  assert.match(browserHtml, /commentKind: "call"/);
  assert.match(browserHtml, /function renderCall\(name, anchor, context = \{\}\)/);
  assert.match(browserHtml, /state\.viewMode = "memory";[\s\S]*localStorage\.setItem\(viewModeKey, "memory"\)/);
  assert.match(browserHtml, /commentable\(content, "!call " \+ name, String\(name\), anchor, context\)/);
});

test("memory details render names as a field while using alias and reference in the page header", () => {
  assert.match(browserHtml, /names: \{ zh: "名称", yaml: "names" \}/);
  assert.match(browserHtml, /appendList\(target, t\("names"\), node\.names, "names"\)/);
  assert.match(browserHtml, /function memoryDisplayName\(entity\)/);
  assert.match(browserHtml, /return entity\.names\[1\] \|\| entity\.names\[0\] \|\| "\(unnamed\)"/);
  assert.match(browserHtml, /el\.title\.textContent = memoryDisplayName\(memory\.entity\);/);
  assert.match(browserHtml, /el\.subtitle\.textContent = memory\.id;/);
  assert.match(browserHtml, /button\.textContent = memory\.error \? invalidMemoryName\(memory\) : memorySummaryName\(memory\);/);
  assert.match(browserHtml, /button\.title = memory\.error \? errorText\(memory\.error\) : memory\.id;/);
  assert.match(browserHtml, /const identity = memory\.error \? memory\.path : memory\.id;/);
});

test("Artifact Review chooses comment severity before entering the comment", () => {
  assert.match(browserHtml, /severity\.className = "artifact-review-round-select artifact-review-severity-select"/);
  assert.match(browserHtml, /severityTrigger\.setAttribute\("role", "combobox"\)/);
  assert.match(browserHtml, /severityMenu\.setAttribute\("role", "listbox"\)/);
  assert.match(browserHtml, /wrap\.append\(severity, textarea, add\)/);
  assert.doesNotMatch(browserHtml, /wrap\.append\(textarea, severity, add\)/);
});
