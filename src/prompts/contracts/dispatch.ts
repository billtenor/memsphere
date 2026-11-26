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

function allowed(scope: OutputScope, entry: ReceiptCase, value: Record<string, unknown>) {
  const { options, route } = scope;
  const key = route.replace(/^continue /, scope.role === "reviewerContinue" ? "run review " : "run ");
  const fields = entry.fields;
  if (key === "data read") {
    if (value.deleted === true) return entry.scenario === "删除标记";
    if (options.metadataOnly) return entry.scenario === "--metadata-only";
    return entry.scenario === (options.path === undefined ? "正常读取" : "--path 选择内容");
  }
  if (key === "model read") return entry.scenario.startsWith("--part " + (options.part ?? "definition"));
  if (key === "model validate") return Boolean(fields.data) === Boolean(options.checkData);
  if (key === "memory change show") return entry.scenario === "--part " + (options.part ?? "summary");
  if (key === "memory read") {
    if (options.effective) return Boolean(fields.declared);
    if (options.node) return Boolean(fields.fragment);
    return !fields.declared && !fields.fragment;
  }
  if (key === "data validate") return Boolean(fields.storeId) === (options.model === undefined);
  if (key === "data export") return Boolean(fields.out) === (options.out !== "-");
  if (key === "run review show") {
    if (entry.scenario.startsWith("--all")) return options.all === true;
    if (entry.scenario.includes("当前节点或")) return !options.all;
    if (entry.scenario.includes("无当前节点") && (value.progress as { phase?: string } | undefined)?.phase === "reviewing") return false;
  }
  if (key === "run review list" && (scope.role === "native" || scope.role === "runnerContinue")) return scope.options.progressive
    ? entry.scenario.includes("渐进") : !entry.scenario.includes("渐进");
  if (key === "run step rewind") return entry.scenario === (options.dryRun ? "--dry-run" : "已回溯");
  if (/^(?:model (?:create|delete|update)|data (?:create|delete|edit|upsert|update|store (?:create|remove)))$/.test(key))
    return Boolean(options.dryRun) === Boolean(fields.dryRun);
  if (key === "run artifact show" || key === "run external show") {
    if (options.out !== undefined) return Boolean(fields.out || fields.exported);
    if (fields.out && !fields.out.isOptional()) return false;
  }
  return true;
}

/** Select only among this invocation's authorized results. A different
 * command's perfectly valid schema offers no authority to publish a field. */
export function publicReceipt(scope: OutputScope, input: unknown, explicitScope = true) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an object receipt");
  const entries = commandCases(scope.role, scope.route);
  const value = input as Record<string, unknown>;
  const failures: string[] = [];
  for (const entry of entries ?? []) {
    if (explicitScope && !allowed(scope, entry, value)) continue;
    const checked = entry.schema.safeParse(value);
    if (checked.success) return checked.data;
    const issues = checked.error.issues.slice(0, 4).map(issue => issue.path.slice(0, 4).join(".") + "/" + issue.code);
    failures.push(entry.id + ": " + issues.join(", "));
  }
  throw new Error("CLI contract mismatch for " + scope.role + " " + scope.route + " (" + failures.join(" | ") + ")");
}
