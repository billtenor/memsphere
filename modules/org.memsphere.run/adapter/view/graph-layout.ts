import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkPoint } from "elkjs/lib/elk-api.js";

export type GraphNode = { id: string; dependencies: string[]; width: number; height: number; cardHeight?: number };
export type GraphEdge = { from: string; to: string; path: string; points: ElkPoint[] };
const elk = new (ELK as unknown as { new(): import("elkjs/lib/elk-api.js").ELK })();

/** Round only within each routed corner, preserving ELK's obstacle-avoiding corridor. */
function rounded(points: ElkPoint[]) {
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const before = Math.hypot(b.x - a.x, b.y - a.y), after = Math.hypot(c.x - b.x, c.y - b.y);
    if (!before || !after) continue;
    const radius = Math.min(6, before / 2, after / 2);
    path += ` L ${b.x + (a.x - b.x) * radius / before} ${b.y + (a.y - b.y) * radius / before} Q ${b.x} ${b.y} ${b.x + (c.x - b.x) * radius / after} ${b.y + (c.y - b.y) * radius / after}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y} l -6 -3 m 6 3 l -6 3`;
}

/** Local, measured, layered layout. Every dependency receives its own stable port and route. */
export async function layoutGraph(nodes: GraphNode[]) {
  const ids = new Set(nodes.map(n => n.id));
  const edges = nodes.flatMap(node => node.dependencies.filter(id => ids.has(id)).map(from => ({ from, to: node.id })));
  const graph: ElkNode = { id: "graph", layoutOptions: {
    "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL",
    "elk.padding": "[top=36,left=36,bottom=36,right=36]", "elk.spacing.nodeNode": "48",
    "elk.layered.spacing.nodeNodeBetweenLayers": "90", "elk.spacing.edgeEdge": "14",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "14", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES"
  }, children: nodes.map(node => {
    const incoming = edges.filter(e => e.to === node.id), outgoing = edges.filter(e => e.from === node.id);
    const ports = (items: typeof edges, side: "WEST" | "EAST") => items.map((edge, index) => ({
      id: `${edges.indexOf(edge)}:${side}`, width: 0, height: 0, x: side === "WEST" ? 0 : node.width,
      y: 20 + (index + 1) * (Math.max(40, node.cardHeight ?? node.height) - 40) / (items.length + 1),
      layoutOptions: { "elk.port.side": side }
    }));
    return { id: node.id, width: node.width, height: node.height, layoutOptions: { "elk.portConstraints": "FIXED_POS" }, ports: [...ports(incoming, "WEST"), ...ports(outgoing, "EAST")] };
  }), edges: edges.map((_, i) => ({ id: `edge:${i}`, sources: [`${i}:EAST`], targets: [`${i}:WEST`] })) };
  const result = await elk.layout(graph);
  const positions = new Map(result.children!.map(n => [n.id, { x: n.x!, y: n.y! }]));
  const routes = edges.map((edge, i): GraphEdge => {
    const section = result.edges?.find(e => e.id === `edge:${i}`)?.sections;
    if (section?.length !== 1) throw Error(`Missing dependency route: ${edge.from} → ${edge.to}`);
    const points = [section[0].startPoint, ...(section[0].bendPoints ?? []), section[0].endPoint];
    return { ...edge, points, path: rounded(points) };
  });
  return { positions, edges: routes, width: Math.max(400, result.width!), height: Math.max(330, result.height!) };
}
