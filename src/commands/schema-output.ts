import { z } from "zod";
import { flattenEffectiveRules, type EffectiveRuleTree } from "../memory/rules.js";
import type { RunStep } from "../run/store.js";
import { nextAction } from "../prompts/cli-output.js";
import type { PromptLocale } from "../prompts/locale.js";
import { cliCommand, emitCliResult, previewText, type CliFormat } from "./output.js";

const exportResult = z.object({
  runId: z.string(), stepId: z.string(), artifactId: z.string(), exported: z.string(), nextAction
}).strict();

const rule = z.object({ scope: z.string(), text: z.string() }).strict();
const schemaResult = z.object({
  runId: z.string(), stepId: z.string(), artifactId: z.string().optional(), phase: z.string(),
  position: z.string().optional(), effective: z.boolean().optional(),
  progress: z.object({
    completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), remaining: z.number().int().nonnegative()
  }).strict().optional(),
  current: z.object({
    id: z.string(), kind: z.string(), path: z.string().optional(), instruction: z.string(),
    type: z.string().optional(), format: z.string().optional(), optional: z.boolean().optional(),
    min: z.number().optional(), max: z.number().optional()
  }).strict().optional(),
  validation: z.object({ status: z.string(), issueCount: z.number().int().nonnegative() }).strict().optional(),
  rules: z.array(rule).max(8).optional(), ruleCount: z.number().int().nonnegative().optional(),
  nextAction
}).strict();

export function emitSchemaExport(data: Omit<z.input<typeof exportResult>, "nextAction">, options: {
  project: string; phase: string; format?: CliFormat; locale?: PromptLocale;
}) {
  const scope = ["--project", options.project, "run"];
  const target = ["--run", data.runId, "--step", data.stepId];
  const inspect = cliCommand([...scope, "schema", "show", ...target]);
  const action = options.phase === "awaiting_finalization"
    ? cliCommand([...scope, "report", ...target, "--artifact-file", data.exported])
    : options.phase === "writing" ? inspect : undefined;
  emitCliResult("run artifact export", exportResult, { ...data, nextAction: action }, {
    ...options, saved: { id: data.artifactId, inspect }
  });
}

export function emitSchemaWriting(command: string, data: {
  runId: string;
  stepId: string;
  artifactId?: string;
  draft?: { id: string };
  phase: string;
  position?: string;
  effective?: boolean;
  progress?: { completed: number; total: number; remaining: number };
  current?: RunStep;
  validation?: { status: string; issues?: unknown[] };
  rules?: Record<string, EffectiveRuleTree>;
}, options: { project: string; format?: CliFormat; locale?: PromptLocale }): void {
  const scope = ["--project", options.project, "run"];
  const target = ["--run", data.runId, "--step", data.stepId];
  const inspect = cliCommand([...scope, "schema", "show", ...target]);
  let action: z.input<typeof nextAction>;
  if (data.effective !== false) {
    if (data.phase === "not_started") action = cliCommand([...scope, "enter-schema", ...target]);
    else if (data.phase === "awaiting_finalization") action = cliCommand([...scope, "artifact", "export", ...target, "--file", "<local-copy>"]);
    else if (data.phase === "writing" && data.position) {
      const position = ["--position", data.position];
      if (data.current?.kind === "repeat") action = cliCommand([...scope, "repeat", "<count>", ...target, ...position]);
      else {
        const report = cliCommand([...scope, "schema", "report", ...target, ...position, "--artifact-file", "<field-content>"]);
        action = data.current?.optional ? { kind: "choose", choices: [
          report, cliCommand([...scope, "skip", ...target, ...position])
        ] } : report;
      }
    } else action = cliCommand([...scope, "status", "--run", data.runId]);
  }
  const { progress, current, validation } = data;
  const rules = Object.entries(data.rules ?? {}).flatMap(([scope, tree]) =>
    flattenEffectiveRules(tree).map(item => ({ scope, text: item.text })));
  for (const source of current?.schemaContext?.sources ?? []) {
    const collect = (scope: string, tree: EffectiveRuleTree | undefined, text: string[] = []) => {
      for (const item of tree ? flattenEffectiveRules(tree).map(item => item.text) : text) rules.push({ scope, text: item });
    };
    collect("field_assert", source.assertTree, source.asserts);
    collect("field_suggest", source.suggestTree, source.suggests);
  }
  emitCliResult(command, schemaResult, {
    runId: data.runId, stepId: data.stepId, phase: data.phase,
    artifactId: data.artifactId ?? data.draft?.id, effective: data.effective,
    position: data.position,
    progress: progress && { completed: progress.completed, total: progress.total, remaining: progress.remaining },
    current: current && {
      id: current.id, kind: current.kind ?? "action", path: current.schemaContext?.path,
      instruction: previewText(current.instruction, 256).text, type: current.type, format: current.format?.name,
      optional: current.optional, min: current.repeat?.min, max: current.repeat?.max
    },
    validation: validation && { status: validation.status, issueCount: validation.issues?.length ?? 0 },
    rules: rules.length ? rules.slice(0, 8).map(({ scope, text }) => ({ scope, text: previewText(text, 160).text })) : undefined,
    ruleCount: rules.length || undefined,
    nextAction: action
  }, { format: options.format, locale: options.locale, maximumBytes: 8192, saved: { id: data.stepId, inspect } });
}
