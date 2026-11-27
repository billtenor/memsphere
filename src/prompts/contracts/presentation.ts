import { parseListLimit } from "../../pagination.js";
import type { OutputScope } from "./dispatch.js";

export function nativeResultRoute(scope: Pick<OutputScope, "route" | "role">) {
  if (scope.role === "runnerContinue") return scope.route.replace(/^continue /, "run ");
  if (scope.role === "reviewerContinue") return scope.route.replace(/^continue /, "run review ");
  return scope.route;
}

/** Applied after closed-schema projection. Only registration and authorized fields decide the output budget. */
export function resultPresentation(scope: OutputScope, data: Record<string, unknown>) {
  const route = nativeResultRoute(scope);
  const itemsField = route === "app list" ? "apps"
    : (route === "run status" && "runs" in data) ? "runs"
    : (route === "run show" || route === "run try-run") && "steps" in data ? "steps"
    : route === "run report" && "nextMaterials" in data ? "nextMaterials"
    : /^(run start|run status|run step enter)$/.test(route) && "materials" in data ? "materials"
    : route === "run review show" && "nodes" in data ? "nodes"
    : route === "run review show" && "comments" in data ? "comments"
    : (route === "validate" || route === "memory change validate" || route.startsWith("migrate ")) ? "issues"
    : "items";
  const contentField = route === "model read" ? "definition"
    : route === "run start" && "example" in data ? "example" : undefined;
  const detail = Boolean(contentField) || ["run artifact contract show", "run schema show", "run step show"].includes(route)
    || route === "run artifact show" && ("artifact" in data || "contextArtifacts" in data)
    || route === "run review show" && (scope.options.all || "node" in data || "nodes" in data);
  const page = route.endsWith(" list") || "nextCursor" in data || Array.isArray(data.runs) || route === "run show" && Array.isArray(data.steps);
  const maximumBytes = route === "data list" ? 8192 + 2048 * parseListLimit(scope.options.limit)
    : detail ? undefined : page ? scope.options.limit === undefined ? 32768 : 131072 : 8192;
  return { itemsField, contentField, maximumBytes };
}
