export type JoinFrame = {
    joins: Array<{
        actionId: string;
        dependencyIndex: number;
        arrivals: Record<string, unknown>;
    }>;
    triggers?: Array<{
        actionId: string;
        dependencyIndex: number;
        stepId?: string;
        inputs?: unknown;
    }>;
};
/** Empty arrival sets are consumed history, never evidence that every source is missing. */
export function joinEvidence(frame: JoinFrame | undefined, actionId: string, dependencyIndex: number, sources: string[]) {
    const join = frame?.joins.find(item => item.actionId === actionId && item.dependencyIndex === dependencyIndex);
    const arrived = sources.filter(id => join && Object.hasOwn(join.arrivals, id));
    if (arrived.length)
        return { state: 'arrivals' as const, arrived, missing: sources.filter(id => !arrived.includes(id)) };
    const trigger = frame?.triggers?.filter(item => item.actionId === actionId && item.dependencyIndex === dependencyIndex).at(-1);
    if (trigger?.stepId)
        return { state: 'triggered' as const, stepId: trigger.stepId };
    if (trigger?.inputs !== undefined)
        return { state: 'condition-not-accepted' as const };
    return { state: 'unavailable' as const };
}
