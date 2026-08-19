import assert from "node:assert/strict";
import test from "node:test";
import {
  PromptRenderError,
  renderPrompt,
  validatePromptAssets
} from "../src/prompts/renderer.js";
import {
  listPromptTemplateIds,
  promptDefinition
} from "../src/prompts/registry.js";

const acpModel = {
  rolePrompts: ["Focus on correctness."],
  contract: {
    actionInstruction: "Produce a report.",
    procedureAsserts: ["Keep the scope stable."],
    actionAsserts: ["Include evidence."],
    suggestions: ["Be concise."],
    details: ["Inspect the workspace."],
    artifact: {
      name: "report",
      type: "string",
      format: "markdown",
      schema: "none",
      final: false,
      reviewPolicy: "artifact_acceptance.unanimous"
    }
  },
  earlierArtifacts: [{ stepId: "flow[1]", artifactName: "requirements" }],
  permissions: [{
    id: "artifact.read",
    description: "Read the Artifact."
  }]
};

test("Prompt registry has paired assets for every supported locale", () => {
  assert(listPromptTemplateIds().length >= 9);
  assert.doesNotThrow(() => validatePromptAssets());
  for (const id of listPromptTemplateIds()) {
    assert(promptDefinition(id).audience);
    assert(promptDefinition(id).purpose);
  }
  assert(!listPromptTemplateIds().includes("run.state" as never));
  assert(!listPromptTemplateIds().includes("run.report-authorization" as never));
});

test("Prompt rendering fails with a diagnosable id and locale when input is incomplete", () => {
  assert.throws(
    () => renderPrompt(
      "control-plane.permission-guidance",
      "en",
      { actorId: "runner" } as never
    ),
    (error: unknown) => {
      assert(error instanceof PromptRenderError);
      assert.equal(error.templateId, "control-plane.permission-guidance");
      assert.equal(error.locale, "en");
      assert.equal(error.stage, "input");
      return true;
    }
  );
});

test("run Prompt schemas reject invalid discriminators and field types at input", () => {
  const invalidCases = [
    {
      id: "run.review-next-action" as const,
      input: { kind: "wait", reviewId: 123 }
    },
    {
      id: "run.current-step" as const,
      input: {
        runId: "run-invalid",
        procedureAsserts: [],
        step: { kind: "bogus" }
      }
    },
    {
      id: "run.review-summary" as const,
      input: {
        reviewId: "review-invalid",
        roundId: "round-invalid",
        round: 1,
        status: "pending"
      }
    }
  ];

  for (const testCase of invalidCases) {
    assert.throws(
      () => renderPrompt(testCase.id, "en", testCase.input as never),
      (error: unknown) => {
        assert(error instanceof PromptRenderError);
        assert.equal(error.templateId, testCase.id);
        assert.equal(error.locale, "en");
        assert.equal(error.stage, "input");
        return true;
      }
    );
  }
});

test("Review configuration retry prompts require the Run name", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const output = renderPrompt("run.review-configuration-required", locale, { preflightJson: "{}" });
    assert.match(output, /run start <procedure> --name <run-name> --review-config <path>/);
  }
});

test("run Prompt schemas reject malformed nested models", () => {
  assert.throws(
    () => renderPrompt("run.schema-overview", "zh-CN", {
      procedureName: "procedure",
      action: {
        instruction: "write",
        asserts: [],
        suggests: []
      },
      artifact: {
        name: "artifact",
        final: false
      },
      progress: {
        completed: 0,
        total: 1,
        pendingRepeatControls: 0,
        fields: [{ path: "field", status: 42 }]
      }
    } as never),
    (error: unknown) => {
      assert(error instanceof PromptRenderError);
      assert.equal(error.templateId, "run.schema-overview");
      assert.equal(error.locale, "zh-CN");
      assert.equal(error.stage, "input");
      return true;
    }
  );

  assert.throws(
    () => renderPrompt("run.report-receipt", "en", {
      runId: "run",
      artifactName: 42
    } as never),
    (error: unknown) => {
      assert(error instanceof PromptRenderError);
      assert.equal(error.templateId, "run.report-receipt");
      assert.equal(error.locale, "en");
      assert.equal(error.stage, "input");
      return true;
    }
  );
});

test("ACP reviewer templates preserve the same contract facts and commands in both languages", () => {
  const english = renderPrompt("acp.artifact-review.initial", "en", acpModel);
  const chinese = renderPrompt("acp.artifact-review.initial", "zh-CN", acpModel);

  for (const output of [english, chinese]) {
    assert.match(output, /Produce a report\./);
    assert.match(output, /flow\[1\].*requirements/);
    assert.match(output, /artifact\.read/);
    assert.match(output, /run artifact show --assignment/);
    assert.match(output, /run review submit --assignment/);
  }
  assert.match(english, /# Memsphere Artifact Reviewer/);
  assert.match(chinese, /# Memsphere 产物评审员/);
  assert.match(renderPrompt("acp.artifact-review.reminder", "en", {}), /without a formal review submission/);
  assert.match(renderPrompt("acp.artifact-review.reminder", "zh-CN", {}), /尚未正式提交评审/);
});

test("ACP reviewer omits empty contract sections and implementation terminology", () => {
  const output = renderPrompt("acp.artifact-review.initial", "zh-CN", {
    ...acpModel,
    contract: {
      ...acpModel.contract,
      procedureAsserts: [],
      actionAsserts: [],
      suggestions: []
    }
  });
  assert.doesNotMatch(output, /Procedure 断言|Action 断言|### 建议|本次 Assignment|完成 Assignment|ACP 自然语言/);
  assert.match(output, /本次评审/);
  assert.match(output, /--assignment/);
});

test("permission descriptions remain localized Prompt assets", () => {
  assert.equal(
    renderPrompt("control-plane.permission-description", "en", { id: "artifact.submit" }),
    "You may submit the current Artifact through run report."
  );
  assert.equal(
    renderPrompt("control-plane.permission-description", "zh-CN", { id: "artifact.submit" }),
    "你可以通过 run report 提交当前 Artifact。"
  );
});
