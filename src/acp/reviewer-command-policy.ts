import { failure } from "../context_control/errors.js";

/** Native capabilities shared by Session help, prompts and command dispatch. */
export const reviewerCommands = [
  "memory list", "memory read", "memory change show", "run show", "run step show",
  "run artifact show", "run artifact contract show", "run external show",
  "run review assignment show", "run review show", "run review list", "run review comment",
  "run review comment add", "run review comment update", "run review comment delete",
  "run review report", "run review update", "run review submit"
] as const;
export type ReviewerProtocol = "graph" | "flow";
export function reviewerCapabilities(protocol: ReviewerProtocol) {
  return {
    protocol,
    commands: reviewerCommands.filter(command => protocol === "graph" || command !== "run external show"),
    targets: protocol === "graph" ? "candidate, fixed Artifact/External and submitted upstream confirmations" : "candidate and pinned context via assignment/step; contract reads target the candidate only; fixed Artifact/External/confirmation targets are unsupported"
  };
}
export type ReviewerIdentities = { project?: string; run?: string; assignment?: string };
export type ReviewerIdentityOption = [keyof ReviewerIdentities, unknown];

/** Check every occurrence: a later matching value must not hide a conflict. */
export function validateReviewerIdentities(command: string, identities: ReviewerIdentityOption[], expected: ReviewerIdentities, hasFrozenMemoryRun: boolean) {
  for (const [key, value] of identities)
    if (!expected[key] || (key === "project" && typeof value === "string" ? value.trim() : value) !== expected[key])
      throw failure("REVIEW_IDENTITY_CONFLICT", `${key} conflicts with this Agent Review Session`);
  if (command.startsWith("memory ") && identities.some(([key]) => key === "run") && !hasFrozenMemoryRun)
    throw failure("REVIEW_IDENTITY_CONFLICT", "Session has no frozen Memory Run");
}

/** Supply only native protocol defaults; explicit Artifact reads keep their Run. */
export function reviewerCommandDefaults(command: string, options: Record<string, unknown>, expected: ReviewerIdentities): Record<string, string | undefined> {
  const defaults: Record<string, string | undefined> = {};
  if (command.startsWith("run review") && !["run review show", "run review list"].includes(command) || ["run artifact show", "run artifact contract show"].includes(command) && !options.artifact && !options.step && !options.run)
    defaults.assignment = expected.assignment;
  if (["run show", "run step show", "run external show"].includes(command) && !options.run)
    defaults.run = expected.run;
  return defaults;
}
