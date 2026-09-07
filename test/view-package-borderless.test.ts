import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createViewServer } from "../src/commands/view.js";
import { readProjectConfig } from "../src/config.js";

test("borderless content Package removes solid Memory and Run card outlines", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "memsphere-borderless-package-"));
  const home = join(temporary, "home");
  const projectRoot = join(home, "projects", "demo");
  const packageRoot = resolve("examples/view-packages/borderless-content");
  await mkdir(join(projectRoot, "memory"), { recursive: true });
  await mkdir(join(projectRoot, "runs"), { recursive: true });
  await mkdir(join(projectRoot, "archives"), { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({
    view: { host: "127.0.0.1", port: 0 },
    view_packages: { installed: [{ path: packageRoot }] },
    view_composition: {
      packages: [{ id: "org.example.memsphere.borderless-content", version: "1.0.0", enabled: true }],
      slots: {
        "styles.global@1": ["org.example.memsphere.borderless-content:org.example.memsphere.borderless-content:borderless-content"]
      }
    }
  }));
  await writeFile(join(projectRoot, "config.json"), JSON.stringify({
    store: { type: "managed", branch: "master", published_revision: "test" }
  }));
  await writeFile(join(projectRoot, "project.json"), JSON.stringify({
    format_version: 1,
    name: "demo",
    created_at: new Date(0).toISOString()
  }));
  await writeFile(join(home, "registry.json"), JSON.stringify({
    format_version: 1,
    projects: { demo: { root: projectRoot } },
    workspaces: {}
  }));

  const server = createViewServer(await readProjectConfig("demo", home));
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/projects/demo/memories`);
    await page.locator('style[data-view-package-scope="global"]').waitFor({ state: "attached" });
    const result = await page.evaluate(() => {
      const memoryModule = document.createElement("div");
      memoryModule.className = "memory-module";
      memoryModule.style.setProperty("--soft", "#eef1ed");
      memoryModule.style.setProperty("--surface", "#ffffff");
      memoryModule.style.setProperty("--accent-soft", "#dfeeea");
      memoryModule.style.setProperty("--text", "#222629");
      memoryModule.style.setProperty("--muted", "#6c7379");
      memoryModule.style.setProperty("--memory-page-line-compact", "1.4");
      const memoryFlow = document.createElement("div");
      memoryFlow.className = "memory-flow mem-content-flow";
      const memoryCard = document.createElement("div");
      memoryCard.className = "memory-flow-item mem-content-flow-node";
      const memoryHead = document.createElement("div");
      memoryHead.className = "memory-flow-head mem-content-flow-head";
      const memoryLabel = document.createElement("span");
      memoryLabel.className = "memory-flow-label mem-content-flow-label";
      memoryLabel.textContent = "步骤";
      const memoryAction = document.createElement("span");
      memoryAction.className = "memory-flow-action mem-content-flow-action";
      memoryAction.textContent = "执行任务";
      memoryHead.append(memoryLabel, memoryAction);
      memoryCard.append(memoryHead);
      memoryFlow.append(memoryCard);
      const memoryProcedure = document.createElement("div");
      memoryProcedure.className = "memory-document mem-content-document";
      memoryProcedure.append(memoryFlow);
      memoryModule.append(memoryProcedure);
      const runModule = document.createElement("div");
      runModule.className = "run-module";
      runModule.style.setProperty("--soft", "#eef1ed");
      runModule.style.setProperty("--surface", "#ffffff");
      runModule.style.setProperty("--accent", "#286c67");
      const runCard = document.createElement("div");
      runCard.className = "run-step";
      const runDetail = document.createElement("div");
      runDetail.className = "run-detail-content mem-content-document";
      const runFlowTitle = document.createElement("div");
      runFlowTitle.className = "run-section-title mem-content-flow-title";
      runFlowTitle.textContent = "执行流程";
      const runFlow = document.createElement("div");
      runFlow.className = "run-flow mem-content-flow";
      const runStep = document.createElement("div");
      runStep.className = "run-step flow-item mem-content-flow-node";
      const runHead = document.createElement("div");
      runHead.className = "flow-head mem-content-flow-head";
      const runLabel = document.createElement("span");
      runLabel.className = "flow-label mem-content-flow-label";
      runLabel.textContent = "步骤";
      const runAction = document.createElement("span");
      runAction.className = "flow-action mem-content-flow-action";
      runAction.textContent = "执行任务";
      const runContract = document.createElement("div");
      runContract.className = "run-meta artifact-row mem-content-artifact-contract";
      const runStatus = document.createElement("span");
      runStatus.className = "run-pill done";
      runStatus.textContent = "已完成";
      const runArtifactName = document.createElement("span");
      runArtifactName.className = "run-pill strong mem-content-artifact-name";
      runArtifactName.textContent = "验证报告";
      const runArtifactSummary = document.createElement("span");
      runArtifactSummary.className = "mem-content-artifact-summary";
      const runArtifactLabel = document.createElement("span");
      runArtifactLabel.className = "mem-content-artifact-label";
      runArtifactLabel.textContent = "产物";
      runArtifactSummary.append(runArtifactLabel, runArtifactName);
      runContract.append(runStatus, runArtifactSummary);
      runHead.append(runLabel, runAction, runContract);
      const runBody = document.createElement("div");
      runBody.className = "run-disclosure-body mem-content-flow-node-body";
      const runRules = document.createElement("details");
      runRules.className = "effective-rule-tree run-collapsible mem-content-disclosure";
      const runRulesSummary = document.createElement("summary");
      runRulesSummary.className = "block-title run-disclosure-summary mem-content-disclosure-summary";
      const runRulesChevron = document.createElement("span");
      runRulesChevron.className = "mem-content-disclosure-chevron";
      runRulesChevron.textContent = "›";
      const runRulesTitle = document.createElement("span");
      runRulesTitle.className = "mem-content-disclosure-title";
      runRulesTitle.textContent = "必须遵守";
      runRulesSummary.append(runRulesChevron, runRulesTitle);
      runRules.append(runRulesSummary);
      const runResult = document.createElement("details");
      runResult.className = "run-collapsible task-result mem-content-disclosure";
      const runResultSummary = document.createElement("summary");
      runResultSummary.className = "run-disclosure-summary run-artifact-summary mem-content-disclosure-summary";
      const runResultChevron = document.createElement("span");
      runResultChevron.className = "mem-content-disclosure-chevron";
      runResultChevron.textContent = "›";
      const runResultTitle = document.createElement("h3");
      runResultTitle.className = "mem-content-disclosure-title";
      runResultTitle.textContent = "验证报告";
      const runResultMeta = document.createElement("div");
      runResultMeta.className = "run-meta artifact-meta-line";
      const runResultMetaPill = document.createElement("span");
      runResultMetaPill.className = "run-pill";
      runResultMetaPill.textContent = "file: report.md";
      runResultMeta.append(runResultMetaPill);
      runResultSummary.append(runResultChevron, runResultTitle);
      const runResultBody = document.createElement("div");
      runResultBody.className = "run-disclosure-body mem-content-disclosure-body";
      runResultBody.append(runResultMeta);
      runResult.append(runResultSummary, runResultBody);
      runBody.append(runRules, runResult);
      runStep.append(runHead, runBody);
      const runBranch = runStep.cloneNode(true) as HTMLDivElement;
      runBranch.className = "run-step flow-item mem-content-flow-node branch is-branch";
      runBranch.querySelector<HTMLElement>(".flow-label")!.classList.add("is-branch");
      runBranch.querySelector<HTMLElement>(".flow-label")!.textContent = "如果";
      const runBranchBody = runBranch.querySelector<HTMLElement>(":scope > .run-disclosure-body")!;
      runBranchBody.replaceChildren();
      const runChildren = document.createElement("div");
      runChildren.className = "flow-children mem-content-flow-children";
      const runChild = runStep.cloneNode(true) as HTMLDivElement;
      runChildren.append(runChild);
      runBranchBody.append(runChildren);
      runFlow.append(runStep, runBranch);
      runDetail.append(runFlowTitle, runFlow);
      runModule.append(runCard, runDetail);
      const artifactSummary = document.createElement("span");
      artifactSummary.className = "memory-artifact-summary mem-content-artifact-summary";
      const artifactName = document.createElement("span");
      artifactName.className = "memory-pill strong mem-content-artifact-name";
      artifactName.textContent = "交付物";
      const artifactDetails = document.createElement("span");
      artifactDetails.className = "memory-artifact-details mem-content-artifact-details";
      artifactDetails.textContent = "markdown";
      artifactSummary.append(artifactName, artifactDetails);
      const reviewSummary = document.createElement("span");
      reviewSummary.className = "memory-review-summary mem-content-review-summary";
      const reviewCount = document.createElement("span");
      reviewCount.className = "memory-review-count mem-content-review-count";
      reviewCount.textContent = "评审人：2";
      const reviewDetails = document.createElement("span");
      reviewDetails.className = "memory-review-details mem-content-review-details";
      reviewDetails.textContent = "产品负责人、架构师";
      reviewSummary.append(reviewCount, reviewDetails);
      const collapsible = document.createElement("details");
      collapsible.className = "memory-collapsible-list mem-content-disclosure memory-list-block";
      const collapsibleSummary = document.createElement("summary");
      collapsibleSummary.className = "memory-collapsible-summary mem-content-disclosure-summary";
      const collapsibleChevron = document.createElement("span");
      collapsibleChevron.className = "memory-list-chevron mem-content-disclosure-chevron";
      const collapsibleLabel = document.createElement("span");
      collapsibleLabel.className = "memory-block-title";
      collapsibleLabel.textContent = "必须遵守";
      const collapsibleCount = document.createElement("span");
      collapsibleCount.className = "memory-list-count";
      collapsibleCount.textContent = "2";
      collapsibleSummary.append(collapsibleChevron, collapsibleLabel, collapsibleCount);
      const collapsibleBody = document.createElement("div");
      collapsibleBody.className = "memory-collapsible-body mem-content-disclosure-body";
      const textList = document.createElement("ul");
      textList.className = "text-list";
      textList.append(document.createElement("li"));
      collapsibleBody.append(textList);
      collapsible.append(collapsibleSummary, collapsibleBody);
      const memoryDocument = document.createElement("div");
      memoryDocument.className = "memory-document mem-content-document";
      memoryDocument.append(collapsible);
      const flowDocument = document.createElement("div");
      flowDocument.className = "memory-document mem-content-document";
      const flowTitle = document.createElement("div");
      flowTitle.className = "memory-block-title mem-content-flow-title";
      flowTitle.textContent = "执行流程";
      flowDocument.append(flowTitle, document.createElement("div"));
      flowDocument.lastElementChild!.className = "memory-flow mem-content-flow";
      const statementDocument = document.createElement("section");
      statementDocument.className = "memory-section memory-node memory-statement-document open";
      const statementBody = document.createElement("div");
      statementBody.className = "memory-section-body";
      const statementField = collapsible.cloneNode(true) as HTMLDetailsElement;
      statementBody.append(statementField);
      statementDocument.append(statementBody);
      const schemaDocument = document.createElement("div");
      schemaDocument.className = "memory-document";
      const schemaRoot = document.createElement("section");
      schemaRoot.className = "memory-section memory-node memory-disclosure-root open";
      const schemaHeader = document.createElement("button");
      schemaHeader.className = "memory-section-header";
      const schemaChevron = document.createElement("span");
      schemaChevron.className = "memory-chevron";
      const schemaTitle = document.createElement("span");
      schemaTitle.className = "memory-node-title";
      const schemaBadges = document.createElement("span");
      schemaBadges.className = "node-badges";
      const schemaTag = document.createElement("span");
      schemaTag.className = "memory-pill";
      schemaTag.textContent = "!schema";
      const schemaType = document.createElement("span");
      schemaType.className = "memory-pill";
      schemaType.textContent = "类型：短文本";
      schemaBadges.append(schemaTag, schemaType);
      schemaHeader.append(schemaChevron, schemaTitle, schemaBadges);
      const schemaBody = document.createElement("div");
      schemaBody.className = "memory-section-body";
      const schemaFieldRow = document.createElement("div");
      schemaFieldRow.className = "memory-schema-field";
      schemaFieldRow.textContent = "问题摘要";
      schemaBody.append(schemaFieldRow);
      schemaRoot.append(schemaHeader, schemaBody);
      schemaDocument.append(schemaRoot);
      const inlineSchema = schemaRoot.cloneNode(true) as HTMLElement;
      inlineSchema.classList.add("memory-artifact-schema");
      inlineSchema.querySelector(".memory-node-title")!.textContent = "产物格式与结构";
      const inlineSchemaHeader = inlineSchema.querySelector<HTMLElement>(".memory-section-header")!;
      const inlineSchemaChevron = inlineSchema.querySelector<HTMLElement>(".memory-chevron")!;
      const inlineSchemaBadges = inlineSchema.querySelector<HTMLElement>(".node-badges")!;
      memoryCard.append(inlineSchema);
      const stepCollapsible = collapsible.cloneNode(true) as HTMLDetailsElement;
      memoryCard.append(stepCollapsible);
      const branch = document.createElement("div");
      branch.className = "memory-flow-item mem-content-flow-node branch is-branch";
      const branchHead = document.createElement("div");
      branchHead.className = "memory-flow-head mem-content-flow-head";
      const branchLabel = memoryLabel.cloneNode(true) as HTMLSpanElement;
      branchLabel.classList.add("is-branch");
      branchLabel.textContent = "循环";
      branchHead.append(branchLabel);
      const branchWrap = document.createElement("div");
      branchWrap.className = "memory-flow-branch mem-content-flow-branch";
      const branchCondition = document.createElement("div");
      branchCondition.className = "memory-flow-condition mem-content-flow-condition is-else";
      branchCondition.textContent = "否则";
      const emptyBranchCondition = document.createElement("div");
      emptyBranchCondition.className = "memory-flow-condition mem-content-flow-condition";
      const branchChildren = document.createElement("div");
      branchChildren.className = "memory-flow-children mem-content-flow-children";
      const childStep = memoryCard.cloneNode(true) as HTMLDivElement;
      branchChildren.append(childStep);
      branchWrap.append(emptyBranchCondition, branchCondition, branchChildren);
      branch.append(branchHead, branchWrap);
      memoryFlow.append(branch);
      memoryProcedure.append(artifactSummary, reviewSummary);
      memoryModule.append(memoryDocument, flowDocument, statementDocument, schemaDocument);
      document.body.append(memoryModule, runModule);
      const stepSummary = stepCollapsible.querySelector("summary")!;
      const stepLabel = memoryHead.querySelector<HTMLElement>(".memory-flow-label")!;
      const inlineSchemaTitle = inlineSchema.querySelector<HTMLElement>(".memory-node-title")!;
      const disclosureTitle = stepCollapsible.querySelector<HTMLElement>(".memory-block-title")!;
      const inlineHeaderStyle = getComputedStyle(inlineSchemaHeader);
      const disclosureStyle = getComputedStyle(stepSummary);
      const inlineTitleStyle = getComputedStyle(inlineSchemaTitle);
      const disclosureTitleStyle = getComputedStyle(disclosureTitle);
      return {
        memoryBorder: getComputedStyle(memoryCard).borderTopStyle,
        memoryRail: getComputedStyle(memoryCard).boxShadow,
        memoryStepGap: getComputedStyle(memoryFlow).gap,
        memoryStepBackground: getComputedStyle(memoryCard).backgroundColor,
        memoryStepLabelRadius: getComputedStyle(memoryLabel).borderRadius,
        memoryFieldAligned: Math.abs(stepSummary.getBoundingClientRect().left - stepLabel.getBoundingClientRect().left) < 1,
        flowTitleDisplay: getComputedStyle(flowTitle).display,
        statementBorder: getComputedStyle(statementDocument).borderLeftStyle,
        statementFieldAligned: Math.abs(statementField.getBoundingClientRect().left - statementDocument.getBoundingClientRect().left) < 1,
        schemaBorder: getComputedStyle(schemaRoot).borderLeftStyle,
        schemaRootHeader: getComputedStyle(schemaHeader).display,
        schemaTagDisplay: getComputedStyle(schemaTag).display,
        schemaTypeBorder: getComputedStyle(schemaType).borderTopStyle,
        schemaTypeBackground: getComputedStyle(schemaType).backgroundColor,
        schemaBodyAligned: Math.abs(schemaBody.getBoundingClientRect().left - schemaRoot.getBoundingClientRect().left) < 1,
        schemaFieldBackground: getComputedStyle(schemaFieldRow).backgroundColor,
        schemaFieldRadius: getComputedStyle(schemaFieldRow).borderRadius,
        inlineSchemaAligned: Math.abs(inlineSchema.getBoundingClientRect().left - memoryCard.getBoundingClientRect().left) < 1,
        inlineSchemaHeaderGap: getComputedStyle(inlineSchemaHeader).gap,
        inlineSchemaHeaderMinHeight: getComputedStyle(inlineSchemaHeader).minHeight,
        inlineSchemaHeaderPadding: getComputedStyle(inlineSchemaHeader).padding,
        inlineSchemaHeaderDisplay: getComputedStyle(inlineSchemaHeader).display,
        inlineSchemaHeaderFillsRow: Math.abs(inlineSchemaHeader.getBoundingClientRect().width - memoryCard.getBoundingClientRect().width) < 1,
        inlineSchemaChevronSize: getComputedStyle(inlineSchemaChevron).fontSize,
        inlineSchemaBadgesDisplay: getComputedStyle(inlineSchemaBadges).display,
        inlineSchemaTitleSize: getComputedStyle(inlineSchema.querySelector(".memory-node-title")!).fontSize,
        inlineSchemaMatchesDisclosure: inlineHeaderStyle.gap === disclosureStyle.gap
          && inlineHeaderStyle.minHeight === disclosureStyle.minHeight
          && inlineHeaderStyle.padding === disclosureStyle.padding
          && inlineHeaderStyle.borderRadius === disclosureStyle.borderRadius
          && inlineHeaderStyle.color === disclosureStyle.color,
        inlineSchemaTitleMatchesDisclosure: inlineTitleStyle.minHeight === disclosureTitleStyle.minHeight
          && inlineTitleStyle.color === disclosureTitleStyle.color
          && inlineTitleStyle.fontSize === disclosureTitleStyle.fontSize
          && inlineTitleStyle.fontWeight === disclosureTitleStyle.fontWeight
          && inlineTitleStyle.lineHeight === disclosureTitleStyle.lineHeight,
        branchLabelBackground: getComputedStyle(branchLabel).backgroundColor,
        branchConditionBackground: getComputedStyle(branchCondition).backgroundColor,
        branchConditionRadius: getComputedStyle(branchCondition).borderRadius,
        branchConditionDisplay: getComputedStyle(branchCondition).display,
        branchConditionAligned: Math.abs(branchCondition.getBoundingClientRect().left - branch.getBoundingClientRect().left) < 1,
        emptyBranchConditionDisplay: getComputedStyle(emptyBranchCondition).display,
        elseBranchConnectorTop: getComputedStyle(branchWrap, "::before").top,
        branchConnector: getComputedStyle(branchWrap, "::before").content,
        childConnector: getComputedStyle(childStep, "::before").content,
        runBorder: getComputedStyle(runCard).borderTopStyle,
        runRail: getComputedStyle(runCard).boxShadow,
        runFlowTitleDisplay: getComputedStyle(runFlowTitle).display,
        runFlowGap: getComputedStyle(runFlow).gap,
        runStepBorder: getComputedStyle(runStep).borderTopStyle,
        runStepBackground: getComputedStyle(runStep).backgroundColor,
        runHeadDisplay: getComputedStyle(runHead).display,
        runHeadGap: getComputedStyle(runHead).gap,
        runLabelRadius: getComputedStyle(runLabel).borderRadius,
        runLabelSize: getComputedStyle(runLabel).fontSize,
        runLabelWidthMatchesMemory: getComputedStyle(runLabel).width === getComputedStyle(memoryLabel).width,
        runActionSize: getComputedStyle(runAction).fontSize,
        runStatusDisplay: getComputedStyle(runStatus).display,
        runArtifactNameDisplay: getComputedStyle(runArtifactName).display,
        runResultBorder: getComputedStyle(runResult).borderTopStyle,
        runResultBackground: getComputedStyle(runResult).backgroundColor,
        runResultTitleSize: getComputedStyle(runResultTitle).fontSize,
        runResultMetaVisibility: getComputedStyle(runResultMeta).visibility,
        runDisclosureRowsMatch: getComputedStyle(runRulesSummary).padding === getComputedStyle(runResultSummary).padding
          && getComputedStyle(runRulesSummary).borderRadius === getComputedStyle(runResultSummary).borderRadius
          && getComputedStyle(runRulesSummary).color === getComputedStyle(runResultSummary).color
          && getComputedStyle(runRulesSummary).fontSize === getComputedStyle(runResultSummary).fontSize
          && getComputedStyle(runRulesSummary).fontWeight === getComputedStyle(runResultSummary).fontWeight
          && getComputedStyle(runRulesSummary).lineHeight === getComputedStyle(runResultSummary).lineHeight,
        runDisclosureChevronWidth: getComputedStyle(runRulesChevron).width,
        runDisclosureChevronHasMask: getComputedStyle(runRulesChevron).maskImage !== "none",
        sharedFlowPrimitive: memoryFlow.classList.contains("mem-content-flow") && runFlow.classList.contains("mem-content-flow"),
        sharedDisclosurePrimitive: collapsible.classList.contains("mem-content-disclosure") && runRules.classList.contains("mem-content-disclosure") && runResult.classList.contains("mem-content-disclosure"),
        sharedFlowStylesMatch: getComputedStyle(memoryFlow).gap === getComputedStyle(runFlow).gap
          && getComputedStyle(memoryHead).gap === getComputedStyle(runHead).gap
          && getComputedStyle(memoryLabel).borderRadius === getComputedStyle(runLabel).borderRadius
          && getComputedStyle(memoryLabel).fontSize === getComputedStyle(runLabel).fontSize
          && getComputedStyle(memoryLabel).width === getComputedStyle(runLabel).width
          && getComputedStyle(memoryLabel).padding === getComputedStyle(runLabel).padding
          && getComputedStyle(memoryAction).fontSize === getComputedStyle(runAction).fontSize
          && getComputedStyle(memoryAction).lineHeight === getComputedStyle(runAction).lineHeight,
        sharedDisclosureStylesMatch: getComputedStyle(stepSummary).minHeight === getComputedStyle(runRulesSummary).minHeight
          && getComputedStyle(stepSummary).padding === getComputedStyle(runRulesSummary).padding
          && getComputedStyle(stepSummary).fontSize === getComputedStyle(runRulesSummary).fontSize
          && getComputedStyle(stepSummary).fontWeight === getComputedStyle(runRulesSummary).fontWeight,
        runBranchBorder: getComputedStyle(runBranch).borderLeftStyle,
        runBranchBackground: getComputedStyle(runBranch).backgroundColor,
        runBranchConnector: getComputedStyle(runBranchBody, "::before").content,
        runChildConnector: getComputedStyle(runChild, "::before").content,
        artifactName: artifactName.textContent,
        artifactNameBorder: getComputedStyle(artifactName).borderTopStyle,
        artifactNameBackground: getComputedStyle(artifactName).backgroundColor,
        reviewCount: reviewCount.textContent,
        disclosureBorder: getComputedStyle(collapsibleSummary).borderTopStyle,
        disclosureBackground: getComputedStyle(collapsibleSummary).backgroundColor,
        disclosureMinHeight: getComputedStyle(collapsibleSummary).minHeight,
        disclosureFillsRow: Math.abs(collapsibleSummary.getBoundingClientRect().width - memoryDocument.getBoundingClientRect().width) < 1,
        disclosureRail: getComputedStyle(collapsibleSummary).boxShadow,
        disclosureKeywordBackground: getComputedStyle(collapsibleLabel).backgroundColor,
        disclosureKeywordRadius: getComputedStyle(collapsibleLabel).borderRadius,
        disclosureKeywordSize: getComputedStyle(collapsibleLabel).fontSize,
        disclosureCountSize: getComputedStyle(collapsibleCount).fontSize,
        disclosureCountOrder: getComputedStyle(collapsibleCount).order,
        disclosureChevronOrder: getComputedStyle(collapsibleChevron).order,
        disclosureListPadding: getComputedStyle(textList).paddingLeft,
        disclosureListMarker: getComputedStyle(textList).listStylePosition,
        artifactDetailsVisibility: getComputedStyle(artifactDetails).visibility,
        reviewDetailsVisibility: getComputedStyle(reviewDetails).visibility
      };
    });
    assert.deepEqual({ ...result, memoryStepBackground: undefined }, {
      memoryBorder: "none",
      memoryRail: "none",
      memoryStepGap: "6px",
      memoryStepBackground: undefined,
      memoryStepLabelRadius: "4px",
      memoryFieldAligned: true,
      flowTitleDisplay: "none",
      statementBorder: "none",
      statementFieldAligned: true,
      schemaBorder: "none",
      schemaRootHeader: "none",
      schemaTagDisplay: "none",
      schemaTypeBorder: "none",
      schemaTypeBackground: "rgba(0, 0, 0, 0)",
      schemaBodyAligned: true,
      schemaFieldBackground: "rgba(0, 0, 0, 0)",
      schemaFieldRadius: "0px",
      inlineSchemaAligned: true,
      inlineSchemaHeaderGap: "5px",
      inlineSchemaHeaderMinHeight: "28px",
      inlineSchemaHeaderPadding: "4px 5px 4px 0px",
      inlineSchemaHeaderDisplay: "flex",
      inlineSchemaHeaderFillsRow: false,
      inlineSchemaChevronSize: "13px",
      inlineSchemaBadgesDisplay: "none",
      inlineSchemaTitleSize: "12px",
      inlineSchemaMatchesDisclosure: true,
      inlineSchemaTitleMatchesDisclosure: true,
      branchLabelBackground: "color(srgb 0.974745 0.920941 0.828706)",
      branchConditionBackground: "color(srgb 0.974745 0.920941 0.828706)",
      branchConditionRadius: "4px",
      branchConditionDisplay: "block",
      branchConditionAligned: true,
      emptyBranchConditionDisplay: "none",
      elseBranchConnectorTop: "30px",
      branchConnector: '\"\"',
      childConnector: '\"\"',
      runBorder: "none",
      runRail: "none",
      runFlowTitleDisplay: "none",
      runFlowGap: "6px",
      runStepBorder: "none",
      runStepBackground: "rgba(0, 0, 0, 0)",
      runHeadDisplay: "flex",
      runHeadGap: "10px",
      runLabelRadius: "4px",
      runLabelSize: "11px",
      runLabelWidthMatchesMemory: true,
      runActionSize: "13px",
      runStatusDisplay: "none",
      runArtifactNameDisplay: "block",
      runResultBorder: "none",
      runResultBackground: "rgba(0, 0, 0, 0)",
      runResultTitleSize: "12px",
      runResultMetaVisibility: "visible",
      runDisclosureRowsMatch: true,
      runDisclosureChevronWidth: "13px",
      runDisclosureChevronHasMask: false,
      sharedFlowPrimitive: true,
      sharedDisclosurePrimitive: true,
      sharedFlowStylesMatch: true,
      sharedDisclosureStylesMatch: true,
      runBranchBorder: "none",
      runBranchBackground: "rgba(0, 0, 0, 0)",
      runBranchConnector: '\"\"',
      runChildConnector: '\"\"',
      artifactName: "交付物",
      artifactNameBorder: "none",
      artifactNameBackground: "rgba(0, 0, 0, 0)",
      reviewCount: "评审人：2",
      disclosureBorder: "none",
      disclosureBackground: "rgba(0, 0, 0, 0)",
      disclosureMinHeight: "28px",
      disclosureFillsRow: false,
      disclosureRail: "none",
      disclosureKeywordBackground: "rgba(0, 0, 0, 0)",
      disclosureKeywordRadius: "0px",
      disclosureKeywordSize: "12px",
      disclosureCountSize: "11px",
      disclosureCountOrder: "0",
      disclosureChevronOrder: "0",
      disclosureListPadding: "0px",
      disclosureListMarker: "inside",
      artifactDetailsVisibility: "hidden",
      reviewDetailsVisibility: "hidden"
    });
    assert.equal(result.memoryStepBackground, "rgba(0, 0, 0, 0)");
    await page.locator(".memory-collapsible-list > summary").first().click();
    assert.equal(await page.locator(".memory-collapsible-list").first().getAttribute("open"), "");
    await page.locator(".memory-artifact-summary").hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".memory-artifact-details")!).visibility === "visible");
    assert.equal(await page.locator(".memory-artifact-details").evaluate(node => getComputedStyle(node).visibility), "visible");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    await page.locator(".memory-review-summary").hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".memory-review-details")!).visibility === "visible");
    assert.equal(await page.locator(".memory-review-details").evaluate(node => getComputedStyle(node).visibility), "visible");
    await page.locator(".run-artifact-summary").first().hover();
    assert.equal(await page.locator(".artifact-meta-line").first().isVisible(), false);
    await page.locator(".run-artifact-summary").first().click();
    assert.equal(await page.locator(".artifact-meta-line").first().isVisible(), true);
    assert.equal(await page.locator(".artifact-meta-line").first().evaluate(node => getComputedStyle(node).position), "static");
  } finally {
    await browser.close();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(temporary, { recursive: true, force: true });
  }
});
