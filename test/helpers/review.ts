import type { RunReviewConfiguration } from "../../src/control-plane/index.js";

export function reviewConfiguration(input: {
  procedure: string;
  flowIndexes?: number[];
  slots: Record<string, string[] | "skip">;
  permissionGrants?: Record<string, string[]>;
  policy?: string;
}): RunReviewConfiguration {
  const policy = input.policy ?? "artifact_acceptance.unanimous";
  const permissionGrants = input.permissionGrants ?? {};
  return {
    reviews: Object.fromEntries((input.flowIndexes ?? [1]).map((index) => [
      `${input.procedure}#flow[${index}]`,
      { policy, permissionGrants }
    ])),
    slots: Object.fromEntries(Object.entries(input.slots).map(([slot, actors]) => [
      `${input.procedure}::${slot}`,
      actors === "skip" ? { skip: true } : { actorIds: actors }
    ]))
  };
}
