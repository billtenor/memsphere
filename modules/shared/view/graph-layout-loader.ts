import type { layoutGraph } from './graph-layout.js';
type Engine = {
    layoutGraph: typeof layoutGraph;
};
let pending: Promise<Engine> | undefined;
let retry = 0;
/** One same-origin runtime resource, shared by graph and artifact canvases. */
export function loadGraphLayout(): Promise<Engine> {
    const url = typeof window === 'undefined' ? './graph-layout.js' : '/assets/procedure-graph-layout.js';
    return pending ??= import(retry ? `${url}?retry=${retry}` : url).catch(error => {
        pending = undefined;
        retry++;
        throw error;
    });
}
