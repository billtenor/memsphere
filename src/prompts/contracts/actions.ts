import { AsyncLocalStorage } from "node:async_hooks";
import type { Command } from "commander";
import { reviewerCapabilities, validateReviewerIdentities, type ReviewerIdentityOption } from "../../acp/reviewer-command-policy.js";
import type { CliCommand } from "../cli-command.js";

type ActionScope = { program: Command; reviewer: boolean; project?: string; protocol?: "graph" | "flow" };
const scope = new AsyncLocalStorage<ActionScope>();
const routers = new WeakMap<Command, Command>();
const roots = new WeakMap<Command, Command>();
export function setActionRouter(command: Command, router: Command) {
  routers.set(command, router);
  let root = command;
  while (root.parent) root = root.parent;
  roots.set(router, root);
}
export function actionRouter(command: Command) { return routers.get(command) ?? command; }
export function withActionScope<T>(context: ActionScope, callback: () => T) { return scope.run(context, callback); }

export function validPublicCommand(command: CliCommand): boolean {
  const context = scope.getStore();
  const args = command.args;
  if (!args.length || args.some(arg => /[\x00-\x1f\x7f-\x9f]/u.test(arg))) return false;
  // A delivery reference belongs only to its addressed wake-up notification.
  if (args.some(arg => arg === "--callback" || arg.startsWith("--callback="))) return false;
  if (!context) return true;
  if ((command.launcher === "reviewer") !== context.reviewer) return false;
  let current = roots.get(context.program) ?? context.program;
  const root = current;
  let index = 0;
  const path: string[] = [];
  const supplied = new Set<string>();
  let help = false;
  const identities: ReviewerIdentityOption[] = [];
  if (current.name() === "continue") {
    if (args[0] !== "continue") return false;
    path.push("continue");
    index++;
  }
  const positional: string[] = [];
  while (index < args.length) {
    const arg = args[index++];
    if (arg.startsWith("-")) {
      // The Continue router handles its own contextual help before Commander parses the tail.
      if (path.length === 1 && path[0] === "continue" && (arg === "--help" || arg === "-h") && index === args.length) { help = true; continue; }
      const equal = arg.indexOf("=");
      const flag = equal < 0 ? arg : arg.slice(0, equal);
      const opt = [...current.createHelp().visibleOptions(current), ...root.options].find(o => o.long === flag || o.short === flag);
      if (!opt) return false;
      supplied.add(opt.attributeName());
      if (opt.required || opt.optional) {
        const value = equal >= 0 ? arg.slice(equal + 1) : args[index++];
        if (value === undefined || value.startsWith("--")) return false;
        if (opt.argChoices && !opt.argChoices.includes(value) && !/^<[^>]+>$/.test(value)) return false;
        const key = opt.attributeName();
        if (key === "project" || key === "assignment" || key === "run") identities.push([key, value]);
      } else if (equal >= 0) return false;
    } else {
      const child = !positional.length && current.commands.find(c => c.name() === arg || c.aliases().includes(arg));
      if (child) { path.push(child.name()); current = actionRouter(child); }
      else positional.push(arg);
    }
  }
  if (!path.length || (current as Command & { _hidden?: boolean })._hidden) return false;
  if (!help) {
    if (!(current as Command & { _actionHandler?: unknown })._actionHandler) return false;
    if (positional.length < current.registeredArguments.filter(arg => arg.required).length) return false;
    for (let parent: Command | null = current; parent; parent = parent.parent) {
      if (parent.options.some(option => option.mandatory && option.defaultValue === undefined && !supplied.has(option.attributeName()))) return false;
    }
  }
  if (positional.length > current.registeredArguments.length && !current.registeredArguments.at(-1)?.variadic) return false;
  if (context.reviewer) {
    const protocol = context.protocol;
    if (!protocol) return false;
    const native = path[0] === "continue" ? ["run", "review", ...path.slice(1)].join(" ") : path.join(" ");
    if (!reviewerCapabilities(protocol).commands.some(candidate => candidate === native)) return false;
    try {
      validateReviewerIdentities(native, identities, { project: context.project, run: process.env.MEMSPHERE_REVIEW_RUN_ID,
        assignment: process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID }, Boolean(process.env.MEMSPHERE_REVIEW_MEMORY_RUN_ID));
    } catch { return false; }
  }
  return true;
}
