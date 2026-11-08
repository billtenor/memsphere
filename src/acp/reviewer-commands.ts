import type { Command } from "commander";
import { readConfig } from "../config.js";
import { boundAgentReviewSession } from "./review-session.js";
import { failure } from "../context_control/errors.js";

import { reviewerCommands, reviewerCapabilities, validateReviewerIdentities, reviewerCommandDefaults, type ReviewerIdentityOption } from "./reviewer-command-policy.js";
export { reviewerCommands, reviewerCapabilities, type ReviewerProtocol } from "./reviewer-command-policy.js";

export const inReviewerSession = () => Boolean(process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID);
function path(command: Command) {
  const names: string[] = [];
  for (let c: Command | null = command; c?.parent; c = c.parent) names.unshift(c.name());
  return names.join(" ");
}

export function installReviewerCommands(program: Command) {
  if (!inReviewerSession()) return;
  const identities: ReviewerIdentityOption[] = [];
  const helpCommands = process.env.MEMSPHERE_REVIEW_HANDLE
    ? reviewerCapabilities(process.env.MEMSPHERE_REVIEW_HANDLE.startsWith("graph-review-") ? "graph" : "flow").commands
    : reviewerCommands;
  if (!process.env.MEMSPHERE_REVIEW_HANDLE) program.addHelpText("afterAll", "\nSession protocol hint is unavailable. Help lists both protocols; use run review assignment show to inspect the bound protocol. Fixed Artifact/External/confirmation targets require graph; flow supports pinned assignment/step reads.\n");
  const visit = (command: Command) => {
    for (const option of command.options) {
      const key = option.attributeName();
      if (["project", "run", "assignment"].includes(key)) command.on(`option:${key}`, value => identities.push([key as ReviewerIdentityOption[0], value]));
      if (["assignment", "run"].includes(key)) option.mandatory = false;
    }
    command.configureHelp({ visibleCommands: c => c.commands.filter(child => {
      const p = path(child);
      return p === "continue" || helpCommands.some(allowed => allowed === p || allowed.startsWith(`${p} `));
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
    const expected = { project: config.project?.name, run: process.env.MEMSPHERE_REVIEW_RUN_ID, assignment: process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID };
    validateReviewerIdentities(p, identities, expected, Boolean(process.env.MEMSPHERE_REVIEW_MEMORY_RUN_ID));
    process.env.MEMSPHERE_PROJECT = expected.project;
    const binding = await boundAgentReviewSession();
    const capabilities = reviewerCapabilities(binding.reviewId.startsWith("graph-review-") ? "graph" : "flow");
    if (p !== "continue" && !capabilities.commands.includes(p as typeof reviewerCommands[number])) throw failure("INVALID_ARGUMENT", `Command is unsupported in this ${capabilities.protocol} Review protocol: ${p}. ${capabilities.targets}`);
    for (const [key, value] of Object.entries(reviewerCommandDefaults(p, action.opts(), expected)))
      action.setOptionValue(key, value);
  });
}
