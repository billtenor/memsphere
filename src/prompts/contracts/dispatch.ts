import { isDeepStrictEqual } from "node:util";
import { cliCommandSchema } from "../cli-output.js";
import { commandContracts } from "./registry.js";
import type { ReceiptCase } from "./types.js";
import { nativeProtocols } from "./protocols.js";

export type CliRole = keyof typeof commandContracts;
export type OutputScope = { role: CliRole; route: string; options: Record<string, unknown>; args: readonly unknown[] };
const routes: Record<CliRole, Record<string, ReceiptCase[]>> = commandContracts;

export function commandCases(role: CliRole, route: string) {
  return Object.hasOwn(routes[role], route) ? routes[role][route] : undefined;
}

export function cliProtocol(route: string) {
  return Object.hasOwn(nativeProtocols, route) ? nativeProtocols[route as keyof typeof nativeProtocols] : undefined;
}

/** Business facts that distinguish otherwise identical wire representations. */
export type ReceiptContext = "exploration-run" | "historical-round";

function pinnedInspection(input: unknown, args: readonly unknown[]) {
  const command = cliCommandSchema.safeParse(input);
  if (!command.success || command.data.launcher !== "memsphere") return false;
  const words = command.data.args;
  const scoped = words[0] === "--project" && words[1] && !words[1].startsWith("-");
  return isDeepStrictEqual(scoped ? words.slice(2) : words, args);
}

function allowed(scope: OutputScope, entry: ReceiptCase, value: Record<string, unknown>,
  explicit: boolean, context?: ReceiptContext) {
  const { options, route } = scope;
  const key = route.replace(/^continue /, scope.role === "reviewerContinue" ? "run review " : "run ");
  const prefix = scope.role.startsWith("reviewer") ? "reviewer" : "cli";
  const is = (variant: number) => entry.sourceId === prefix + "-" + key.replaceAll(" ", "-") + "-" + variant;
  if (key === "run start" || key === "run status") {
    if (value.runs !== undefined) return key === "run status" && is(7);
    if (value.status === "review_configuration_required") return key === "run start" && is(7);
    if (value.status === "done" || value.status === "abandoned") return is(6) && (value.details === undefined ||
      pinnedInspection(value.details, ["run", "show", "--run", value.runId]));
    if (value.status !== "running") return false;
    if (context === "exploration-run") return is(1);
    if (value.reviewId !== undefined) return is(4);
    if (value.actor !== undefined) return is(3);
    if (value.stepId !== undefined) return is(5);
    return is(2);
  }
  if (key === "run review wait") {
    if (context === "historical-round") return is(3) &&
      (value.details === undefined || pinnedInspection(value.details, ["run", "review", "show", "--review", value.reviewId, "--round", value.roundId, "--all"])) &&
      (value.nextAction === undefined || isDeepStrictEqual(value.nextAction, value.details));
    return is(value.taskId === undefined ? 2 : 1);
  }
  if (["run schema show", "run schema report", "run enter-schema", "run repeat", "run skip"].includes(key)) {
    if (value.name !== undefined || value.artifactName !== undefined) return is(5);
    if (value.phase === "not_started") return is(1);
    if (value.phase === "writing") return is(2);
    if (value.phase === "awaiting_finalization") return is(3);
    return (value.phase === "submitted" || value.phase === "submitting") && is(4);
  }
  if (key === "data read") {
    if (value.deleted === true) return is(4);
    if (options.metadataOnly || !explicit && value.value === undefined) return is(3);
    return is(options.path === undefined ? 1 : 2);
  }
  if (key === "memory read") {
    if (options.effective || !explicit && value.declared !== undefined) return is(7);
    if (options.node || !explicit && value.fragment !== undefined) return is(6);
    switch (value.tag) {
      case "!concept": return is(1);
      case "!statement": return is(2);
      case "!schema": return is(3);
      case "!procedure": return is(value.mode === "graph" ? 5 : 4);
      default: return false;
    }
  }
  if (key === "run review show") {
    const restricted = scope.role.startsWith("reviewer");
    const allNodes = options.all || !explicit && value.nodes !== undefined &&
      value.comments === undefined && (value.progress as { phase?: string } | undefined)?.phase === "reviewing";
    if (is(3)) return Boolean(allNodes);
    if (is(2)) return !options.all;
    if (is(restricted ? 4 : 5)) return !allNodes && (value.progress as { phase?: string } | undefined)?.phase !== "reviewing";
  }
  if (key === "run review list" && !scope.role.startsWith("reviewer")) return is(options.progressive ? 2 : 1);
  if (!explicit) return true;
  if (key === "model read") return is(options.part === "all" ? 3 : options.part === "registration" ? 2 : 1);
  if (key === "model validate") return is(options.checkData ? 2 : 1);
  if (key === "memory change show") return is(["summary", "validation", "memory", "diff"].indexOf(String(options.part ?? "summary")) + 1);
  if (key === "data validate") return is(options.model === undefined ? 1 : 2);
  if (key === "data export") return is(options.out === "-" ? 2 : 1);
  if (key === "run step rewind") return is(options.dryRun ? 1 : 2);
  if (/^(?:model (?:create|delete|update)|data (?:create|delete|edit|upsert|update|store (?:create|remove)))$/.test(key)) {
    return is(options.dryRun ? 2 : 1);
  }
  if (key === "run artifact show" || key === "run external show") {
    if (options.out !== undefined) return Boolean(entry.fields.out || entry.fields.exported);
    if (entry.fields.out && !entry.fields.out.isOptional()) return false;
  }
  return true;
}

/** The public result must belong to exactly one authorized scenario. */
export function selectReceipt(scope: OutputScope, input: unknown, explicitScope = true, context?: ReceiptContext) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an object receipt");
  const value = input as Record<string, unknown>;
  let selected: { id: string; data: Record<string, unknown> } | undefined;
  for (const entry of commandCases(scope.role, scope.route) ?? []) {
    if (!allowed(scope, entry, value, explicitScope, context)) continue;
    const checked = entry.schema.safeParse(value);
    if (!checked.success) continue;
    if (selected) throw new Error("Ambiguous CLI contract for " + scope.route + ": " + selected.id + ", " + entry.id);
    selected = { id: entry.id, data: checked.data };
  }
  if (!selected) throw new Error("CLI contract mismatch for " + scope.role + " " + scope.route);
  return selected;
}

export function publicReceipt(scope: OutputScope, input: unknown, explicitScope = true, context?: ReceiptContext) {
  return selectReceipt(scope, input, explicitScope, context).data;
}
