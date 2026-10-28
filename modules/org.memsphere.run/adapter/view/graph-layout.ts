import { loadGraphLayout } from '../../../shared/view/graph-layout-loader.js';
import type { GraphNode } from '../../../shared/view/graph-layout.js';
export type { GraphNode, GraphEdge } from '../../../shared/view/graph-layout.js';
export async function layoutGraph(nodes: GraphNode[]) {
  return (await loadGraphLayout()).layoutGraph(nodes);
}
