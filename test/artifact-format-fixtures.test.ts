import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  compileArtifactContract,
  createBuiltInArtifactValidatorRegistry,
  prepareArtifactCandidate,
  type ArtifactValidationContext
} from "../src/artifact-validation.js";
import type { SchemaNode } from "../src/memory/ast.js";
import { artifactNodeSchema, conceptMemorySchema, schemaMemorySchema } from "../src/memory/schema.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";

const fixtureRoot = join(process.cwd(), "test", "fixtures", "artifact-format-validation");
const registry = createBuiltInArtifactValidatorRegistry();

const cases: Array<{
  id: string;
  expected: Array<{ code: string; fieldPath: string }>;
}> = [
  { id: "001-bookkeeping", expected: ["日期", "类型", "金额", "分类", "备注"].map(expectedHeading) },
  { id: "002-bookkeeping-with-title", expected: ["日期", "类型", "金额", "分类", "备注"].map(expectedHeading) },
  { id: "003-bookkeeping-text-variant", expected: ["日期", "类型", "金额", "分类", "备注"].map(expectedHeading) },
  { id: "004-meeting-note", expected: ["会议主题", "日期", "结论", "待办"].map(expectedHeading) },
  { id: "005-reimbursement", expected: ["发生日期", "费用内容", "金额", "业务用途", "凭证编号"].map(expectedHeading) },
  { id: "006-release-record", expected: ["版本", "发布日期", "变更内容", "发布结果"].map(expectedHeading) },
  {
    id: "007-incident-review",
    expected: [
      "基本信息 / 发生时间",
      "基本信息 / 恢复时间",
      "影响 / 受影响服务",
      "影响 / 用户影响"
    ].map(expectedHeading)
  },
  { id: "008-release-check", expected: ["版本", "数据库迁移检查", "接口冒烟检查", "回滚版本"].map(expectedHeading) },
  {
    id: "009-release-change-verification",
    expected: [
      expectedHeading("核验项[1]"),
      expectedHeading("核验项[2]"),
      invalidParent("核验项[1] / 核验方式"),
      invalidParent("核验项[1] / 核验结果"),
      invalidParent("核验项[2] / 核验方式"),
      invalidParent("核验项[2] / 核验结果")
    ]
  }
];

for (const fixture of cases) {
  test(`Artifact format fixture ${fixture.id} reports every structural issue`, async () => {
    const directory = join(fixtureRoot, fixture.id);
    const schema = await readFixtureSchema(join(directory, "memory.yaml"));
    const contract = compileArtifactContract(artifactNodeSchema.parse({
      tag: "!artifact",
      name: fixture.id,
      type: "object",
      format: { name: "markdown", layout: "outline" },
      schema
    }));
    const context: ArtifactValidationContext = {
      runId: "fixture-run",
      stepId: fixture.id,
      artifactPath: `${fixture.id}/artifact.md`,
      attemptId: "fixture-attempt"
    };
    const candidate = await prepareArtifactCandidate(contract, { kind: "file", path: join(directory, "artifact.md") }, context);
    const result = await registry.execute(registry.resolvePlan(contract), { contract, candidate, context });

    assert.equal(result.status, "failed");
    assert.equal(result.correctable, true);
    for (const expected of fixture.expected) {
      assert(result.issues.some((issue) => issue.code === expected.code && issue.fieldPath === expected.fieldPath),
        `missing ${expected.code} for ${expected.fieldPath}; got ${JSON.stringify(result.issues)}`);
    }
  });
}

function expectedHeading(fieldPath: string): { code: string; fieldPath: string } {
  return { code: "schema.format.outline.expected_heading", fieldPath };
}

function invalidParent(fieldPath: string): { code: string; fieldPath: string } {
  return { code: "schema.format.outline.invalid_parent", fieldPath };
}

async function readFixtureSchema(path: string): Promise<SchemaNode> {
  const parsed = parseMemoryYaml(await readFile(path, "utf8"));
  if (parsed && typeof parsed === "object" && (parsed as { tag?: unknown }).tag === "!schema") {
    return schemaMemorySchema.parse(parsed);
  }
  const concept = conceptMemorySchema.parse(parsed);
  const schema = concept.defines.find((definition): definition is SchemaNode =>
    typeof definition === "object" && definition.tag === "!schema"
  );
  assert(schema, `fixture ${path} must contain a Schema definition`);
  return schema;
}
