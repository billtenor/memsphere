import type { Command } from "commander";
import { readConfig } from "../config.js";
import { boundAgentReviewSession } from "./review-session.js";
import { failure } from "../context_control/errors.js";

/** Shared native capabilities. Continue delegates to the native Review protocol. */
export const reviewerCommands = [
  "memory list", "memory read", "memory change show", "run show", "run step show",
  "run artifact show", "run artifact contract show", "run external show",
  "run review assignment show", "run review show", "run review list", "run review comment",
  "run review comment add", "run review comment update", "run review comment delete",
  "run review report", "run review update", "run review submit"
] as const;
export const inReviewerSession = () => Boolean(process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID);
function path(command: Command) {
  const names: string[] = [];
  for (let c: Command | null = command; c?.parent; c = c.parent) names.unshift(c.name());
  return names.join(" ");
}

export function installReviewerCommands(program: Command) {
  if (!inReviewerSession()) return;
  const identities: Array<[string, unknown]> = [];
  const visit = (command: Command) => {
    for (const option of command.options) {
      const key = option.attributeName();
      if (["project", "run", "assignment"].includes(key)) command.on(`option:${key}`, value => identities.push([key, value]));
      if (["assignment", "run"].includes(key)) option.mandatory = false;
    }
    command.configureHelp({ visibleCommands: c => c.commands.filter(child => {
      const p = path(child);
      return p === "continue" || reviewerCommands.some(allowed => allowed === p || allowed.startsWith(`${p} `));
    }) });
    command.commands.forEach(visit);
  };
  visit(program);
  program.hook("preAction", async (_root, action) => {
    const p = path(action);
    if (p !== "continue" && !reviewerCommands.includes(p as typeof reviewerCommands[number])) throw failure("REVIEW_SESSION_DENIED", "command is not allowed in this Agent Review Session");
    const config = await readConfig(process.env.MEMSPHERE_CONFIG_PATH).catch(error => {
      throw failure("REVIEW_SESSION_INVALID", `Session Project identity is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    });
    const expected: Record<string, string | undefined> = { project: config.project?.name, run: process.env.MEMSPHERE_REVIEW_RUN_ID, assignment: process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID };
    for (const [key, value] of identities) if (!expected[key] || (key === "project" && typeof value === "string" ? value.trim() : value) !== expected[key]) throw failure("REVIEW_IDENTITY_CONFLICT", `${key} conflicts with this Agent Review Session`);
    process.env.MEMSPHERE_PROJECT = expected.project;
    if (p.startsWith("memory ") && identities.some(([key]) => key === "run") && !process.env.MEMSPHERE_REVIEW_MEMORY_RUN_ID) throw failure("REVIEW_IDENTITY_CONFLICT", "Session has no frozen Memory Run");
    await boundAgentReviewSession();
    if (p.startsWith("run review") && !["run review show", "run review list"].includes(p) || ["run artifact show", "run artifact contract show"].includes(p) && !action.opts().artifact && !action.opts().step && !action.opts().run) {
      action.setOptionValue("assignment", expected.assignment);
    }
    if (["run show", "run step show", "run external show"].includes(p) && !action.opts().run) action.setOptionValue("run", expected.run);
  });
}
