import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkPoint } from "elkjs/lib/elk-api.js";
export type GraphNode = {
    id: string;
    dependencies: string[];
    dependencyIds?: string[];
    width: number;
    height: number;
    cardHeight?: number;
};
export type GraphEdge = {
    id: string;
    from: string;
    to: string;
    path: string;
    points: ElkPoint[];
};
const elk = new (ELK as unknown as {
    new (): import("elkjs/lib/elk-api.js").ELK;
})();
/** Round only within each routed corner, preserving ELK's obstacle-avoiding corridor. */
function rounded(points: ElkPoint[]) {
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1], b = points[i], c = points[i + 1];
        const before = Math.hypot(b.x - a.x, b.y - a.y), after = Math.hypot(c.x - b.x, c.y - b.y);
        if (!before || !after)
            continue;
        const radius = Math.min(6, before / 2, after / 2);
        path += ` L ${b.x + (a.x - b.x) * radius / before} ${b.y + (a.y - b.y) * radius / before} Q ${b.x} ${b.y} ${b.x + (c.x - b.x) * radius / after} ${b.y + (c.y - b.y) * radius / after}`;
    }
    const last = points.at(-1)!;
    const previous = points.slice(0, -1).reverse().find(point => point.x !== last.x || point.y !== last.y) ?? { x: last.x - 1, y: last.y };
    const length = Math.hypot(last.x - previous.x, last.y - previous.y);
    const dx = (last.x - previous.x) / length, dy = (last.y - previous.y) / length;
    return `${path} L ${last.x} ${last.y} m ${-6 * dx + 3 * dy} ${-6 * dy - 3 * dx} l ${6 * dx - 3 * dy} ${6 * dy + 3 * dx} l ${-6 * dx - 3 * dy} ${-6 * dy + 3 * dx}`;
}
/** Keep routes orthogonal and remove needless detours when the corridor is clear. */
function tidyRoute(points: ElkPoint[], boxes: ElkNode[], selfLoop = false): ElkPoint[] {
    const clear = (a: ElkPoint, b: ElkPoint) => {
        if (a.x !== b.x && a.y !== b.y)
            return false;
        return !boxes.some(node => {
            const left = node.x! + .5, right = node.x! + node.width! - .5;
            const top = node.y! + .5, bottom = node.y! + node.height! - .5;
            return a.x === b.x ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
                : a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
        });
    };
    const start = points[0], end = points.at(-1)!;
    // Only simplify distinct-node routes; a self-loop must retain its outer corridor.
    if (!selfLoop && (start.x !== end.x || start.y !== end.y) && clear(start, end))
        return [start, end];
    const orthogonal: ElkPoint[] = [start];
    for (const point of points.slice(1)) {
        const previous = orthogonal.at(-1)!;
        if (previous.x !== point.x && previous.y !== point.y) {
            const first = { x: point.x, y: previous.y }, second = { x: previous.x, y: point.y };
            const corner = clear(previous, first) && clear(first, point) ? first : second;
            orthogonal.push(corner);
        }
        if (orthogonal.at(-1)!.x !== point.x || orthogonal.at(-1)!.y !== point.y)
            orthogonal.push(point);
    }
    if (selfLoop)
        return orthogonal;
    const simplified: ElkPoint[] = [orthogonal[0]];
    for (let i = 0; i < orthogonal.length - 1;) {
        let next = i + 1;
        for (let j = orthogonal.length - 1; j > i + 1; j--)
            if (clear(orthogonal[i], orthogonal[j])) {
                next = j;
                break;
            }
        simplified.push(orthogonal[next]);
        i = next;
    }
    return simplified;
}
/** Local, measured, layered layout. Every dependency receives its own stable port and route. */
export async function layoutGraph(nodes: GraphNode[]) {
    const ids = new Set(nodes.map(n => n.id));
    const edges = nodes.flatMap(node => node.dependencies.map((from, index) => ({ id: node.dependencyIds?.[index] ?? `${node.id}:${index}:${from}`, from, to: node.id })).filter(edge => ids.has(edge.from)));
    const graph: ElkNode = { id: "graph", layoutOptions: {
            "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL",
            "elk.padding": "[top=36,left=36,bottom=36,right=36]", "elk.spacing.nodeNode": "32",
            "elk.layered.spacing.nodeNodeBetweenLayers": "56", "elk.spacing.edgeEdge": "14",
            "elk.layered.spacing.edgeEdgeBetweenLayers": "14", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES"
        }, children: nodes.map(node => ({ id: node.id, width: node.width, height: node.height,
            layoutOptions: { "elk.portConstraints": "FREE" },
            ports: edges.flatMap((edge, i) => [...(edge.from === node.id ? [{ id: `${i}:out`, width: 0, height: 0 }] : []), ...(edge.to === node.id ? [{ id: `${i}:in`, width: 0, height: 0 }] : [])])
        })), edges: edges.map((_, i) => ({ id: `edge:${i}`, sources: [`${i}:out`], targets: [`${i}:in`] })) };
    // First find node neighborhoods, then choose the nearest outward-facing sides.
    const preliminary = await elk.layout(graph);
    type Side = "WEST" | "EAST" | "NORTH" | "SOUTH";
    const sides: Side[] = ["WEST", "EAST", "NORTH", "SOUTH"];
    const boxes = new Map(preliminary.children!.map(node => [node.id, node]));
    function anchor(node: ElkNode, side: Side) {
        const x = node.x!, y = node.y!, w = node.width!, h = node.height!;
        return side === "WEST" ? { x, y: y + h / 2, nx: -1, ny: 0 } : side === "EAST" ? { x: x + w, y: y + h / 2, nx: 1, ny: 0 } : side === "NORTH" ? { x: x + w / 2, y, nx: 0, ny: -1 } : { x: x + w / 2, y: y + h, nx: 0, ny: 1 };
    }
    edges.forEach((edge, i) => {
        let pair: [
            Side,
            Side
        ] = ["EAST", "WEST"], distance = Infinity;
        if (edge.from === edge.to)
            pair = ["NORTH", "NORTH"];
        else
            for (const from of sides)
                for (const to of sides) {
                    const a = anchor(boxes.get(edge.from)!, from), b = anchor(boxes.get(edge.to)!, to);
                    const dx = b.x - a.x, dy = b.y - a.y;
                    if (dx * a.nx + dy * a.ny < 0 || dx * b.nx + dy * b.ny > 0)
                        continue;
                    // Penalize a direct connection through another card; prefer its upper/lower corridor.
                    const obstacles = preliminary.children!.filter(node => {
                        if (node.id === edge.from || node.id === edge.to)
                            return false;
                        let low = 0, high = 1;
                        for (const [origin, delta, min, max] of [[a.x, dx, node.x! + 1, node.x! + node.width! - 1], [a.y, dy, node.y! + 1, node.y! + node.height! - 1]]) {
                            if (Math.abs(delta) < 0.001) {
                                if (origin < min || origin > max)
                                    return false;
                            }
                            else {
                                const t1 = (min - origin) / delta, t2 = (max - origin) / delta;
                                low = Math.max(low, Math.min(t1, t2));
                                high = Math.min(high, Math.max(t1, t2));
                                if (low > high)
                                    return false;
                            }
                        }
                        return true;
                    }).length;
                    const source = boxes.get(edge.from)!, target = boxes.get(edge.to)!;
                    const hasIntermediateColumn = preliminary.children!.some(node => node.id !== edge.from && node.id !== edge.to && node.x! > Math.min(source.x!, target.x!) + 1 && node.x! < Math.max(source.x!, target.x!) - 1);
                    const horizontalBypass = hasIntermediateColumn && (from === "WEST" || from === "EAST") && (to === "WEST" || to === "EAST");
                    const score = Math.hypot(dx, dy) + obstacles * 300 + (horizontalBypass ? Math.abs(dx) * 0.35 : 0);
                    if (score < distance) {
                        distance = score;
                        pair = [from, to];
                    }
                }
        for (const [id, portId, side] of [[edge.from, `${i}:out`, pair[0]], [edge.to, `${i}:in`, pair[1]]] as const) {
            const port = graph.children!.find(node => node.id === id)!.ports!.find(port => port.id === portId)!;
            port.layoutOptions = { "elk.port.side": side };
        }
    });
    graph.children!.forEach(node => {
        node.layoutOptions = { "elk.portConstraints": "FIXED_SIDE" };
    });
    const result = await elk.layout(graph);
    // Keep reciprocal two-action loops local, with the main-flow action as the lower anchor.
    const originalPositions = new Map(result.children!.map(node => [node.id, { x: node.x!, y: node.y! }]));
    const loopPairs = new Map<string, {
        upper: string;
        lower: string;
    }>(), placed = new Set<string>();
    for (const edge of edges) {
        if (edge.from === edge.to || placed.has(edge.from) || placed.has(edge.to) || !edges.some(other => other.from === edge.to && other.to === edge.from))
            continue;
        const externalDegree = (id: string, partner: string) => edges.filter(e => (e.from === id && e.to !== partner && e.to !== id) || (e.to === id && e.from !== partner && e.from !== id)).length;
        const lowerId = externalDegree(edge.from, edge.to) >= externalDegree(edge.to, edge.from) ? edge.from : edge.to;
        const upperId = lowerId === edge.from ? edge.to : edge.from;
        const lower = result.children!.find(node => node.id === lowerId)!, upper = result.children!.find(node => node.id === upperId)!;
        upper.x = lower.x! + (lower.width! - upper.width!) / 2;
        upper.y = lower.y! - upper.height! - 48;
        while (result.children!.some(node => node.id !== upperId && node.id !== lowerId && upper.x! < node.x! + node.width! + 16 && upper.x! + upper.width! > node.x! - 16 && upper.y! < node.y! + node.height! + 24 && upper.y! + upper.height! > node.y! - 24))
            upper.y -= upper.height! + 32;
        const pair = { upper: upperId, lower: lowerId };
        loopPairs.set(`${upperId}:${lowerId}`, pair);
        loopPairs.set(`${lowerId}:${upperId}`, pair);
        placed.add(upperId);
        placed.add(lowerId);
    }
    const shiftY = Math.max(0, 36 - Math.min(...result.children!.map(node => node.y!)));
    result.children!.forEach(node => {
        node.y! += shiftY;
    });
    result.height = Math.max(result.height! + shiftY, ...result.children!.map(node => node.y! + node.height! + 36));
    const positions = new Map(result.children!.map(n => [n.id, { x: n.x!, y: n.y! }]));
    const routes = edges.map((edge, i): GraphEdge => {
        const section = result.edges?.find(e => e.id === `edge:${i}`)?.sections;
        if (section?.length !== 1)
            throw Error(`Missing dependency route: ${edge.from} → ${edge.to}`);
        let raw = [section[0].startPoint, ...(section[0].bendPoints ?? []), section[0].endPoint].map(p => ({ x: p.x, y: p.y + shiftY }));
        const source = result.children!.find(node => node.id === edge.from)!, target = result.children!.find(node => node.id === edge.to)!;
        const pair = loopPairs.get(`${edge.from}:${edge.to}`);
        if (pair) {
            const downward = edge.from === pair.upper, fraction = downward ? 2 / 3 : 1 / 3;
            raw = [{ x: source.x! + source.width! * fraction, y: source.y! + (downward ? source.height! : 0) }, { x: target.x! + target.width! * fraction, y: target.y! + (downward ? 0 : target.height!) }];
        }
        else {
            for (const [id, index] of [[edge.from, 0], [edge.to, raw.length - 1]] as const) {
                const node = result.children!.find(n => n.id === id)!, original = originalPositions.get(id)!;
                raw[index] = { x: raw[index].x + node.x! - original.x, y: raw[index].y + node.y! - shiftY - original.y };
            }
        }
        const points = tidyRoute(raw, result.children!, edge.from === edge.to);
        return { ...edge, points, path: rounded(points) };
    });
    // Order shared-side endpoints by their actual routing corridor, rather than declaration order.
    function orderEndpoints() {
        for (const node of result.children!) {
            for (const side of ["WEST", "EAST", "NORTH", "SOUTH"] as const) {
                const vertical = side === "WEST" || side === "EAST";
                const entries = routes.flatMap(route => {
                    const endpoints = [...(route.from === node.id ? [true] : []), ...(route.to === node.id ? [false] : [])];
                    return endpoints.flatMap(atStart => {
                        const ordered = atStart ? route.points : [...route.points].reverse(), point = ordered[0];
                        const onSide = side === "WEST" ? Math.abs(point.x - node.x!) < .1 : side === "EAST" ? Math.abs(point.x - node.x! - node.width!) < .1 : side === "NORTH" ? Math.abs(point.y - node.y!) < .1 : Math.abs(point.y - node.y! - node.height!) < .1;
                        if (!onSide)
                            return [];
                        const coordinate = (p: ElkPoint) => vertical ? p.y : p.x;
                        const corridor = ordered.slice(1).find(p => Math.abs(coordinate(p) - coordinate(point)) > .1) ?? ordered.at(-1)!;
                        return [{ route, atStart, lane: coordinate(corridor) }];
                    });
                }).sort((a, b) => a.lane - b.lane);
                if (entries.length < 2)
                    continue;
                const length = vertical ? node.height! : node.width!, offset = vertical ? node.y! : node.x!;
                entries.forEach((entry, index) => {
                    const points = entry.atStart ? entry.route.points : [...entry.route.points].reverse();
                    const old = { ...points[0] }, value = offset + length * (index + 1) / (entries.length + 1);
                    if (points.length === 2) {
                        const end = points[1], mid = vertical ? (old.x + end.x) / 2 : (old.y + end.y) / 2;
                        points.splice(1, 0, vertical ? { x: mid, y: old.y } : { x: old.x, y: mid }, vertical ? { x: mid, y: end.y } : { x: end.x, y: mid });
                    }
                    if (vertical) {
                        points[0].y = value;
                        if (points[1].y === old.y)
                            points[1].y = value;
                    }
                    else {
                        points[0].x = value;
                        if (points[1].x === old.x)
                            points[1].x = value;
                    }
                    entry.route.points = entry.atStart ? points : points.reverse();
                });
            }
        }
    }
    orderEndpoints();
    // Separate parallel corridors after endpoint ordering, which can otherwise merge lanes.
    type Segment = {
        route: GraphEdge;
        index: number;
        a: ElkPoint;
        b: ElkPoint;
        horizontal: boolean;
    };
    const segments = (): Segment[] => routes.flatMap(route => route.points.slice(1).map((b, index) => ({ route, index, a: route.points[index], b, horizontal: route.points[index].y === b.y })));
    const conflicts = (a: Segment, b: Segment) => {
        if (a.route === b.route || a.horizontal !== b.horizontal)
            return false;
        const coordinate = (s: Segment) => s.horizontal ? s.a.y : s.a.x;
        const span = (s: Segment) => s.horizontal ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)] : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
        const [a0, a1] = span(a), [b0, b1] = span(b);
        return Math.abs(coordinate(a) - coordinate(b)) < 10 && Math.min(a1, b1) - Math.max(a0, b0) > 1;
    };
    const hitsCard = (a: ElkPoint, b: ElkPoint) => result.children!.some(node => {
        const left = node.x! + .5, right = node.x! + node.width! - .5, top = node.y! + .5, bottom = node.y! + node.height! - .5;
        return a.y === b.y ? a.y > top && a.y < bottom && Math.min(a.x, b.x) < right && Math.max(a.x, b.x) > left : a.x > left && a.x < right && Math.min(a.y, b.y) < bottom && Math.max(a.y, b.y) > top;
    });
    function separateLanes() {
        for (let pass = 0; pass < 12; pass++) {
            let moved = false;
            const current = segments();
            for (const segment of current) {
                if (!current.some(other => conflicts(segment, other)))
                    continue;
                const { route, index, horizontal } = segment;
                if (index === 0 || index + 1 === route.points.length - 1)
                    continue;
                const a = { ...segment.a }, b = { ...segment.b };
                for (let step = 1; step <= 24; step++) {
                    let accepted = false;
                    for (const sign of [1, -1]) {
                        const delta = step * 14 * sign;
                        if (horizontal) {
                            segment.a.y = a.y + delta;
                            segment.b.y = b.y + delta;
                        }
                        else {
                            segment.a.x = a.x + delta;
                            segment.b.x = b.x + delta;
                        }
                        const affected = segments().filter(s => s.route === route && s.index >= index - 1 && s.index <= index + 1);
                        if (affected.every(s => s.a.x >= 8 && s.b.x >= 8 && s.a.y >= 8 && s.b.y >= 8 && !hitsCard(s.a, s.b)) && !affected.some(s => segments().some(other => conflicts(s, other)))) {
                            accepted = true;
                            moved = true;
                            break;
                        }
                        Object.assign(segment.a, a);
                        Object.assign(segment.b, b);
                    }
                    if (accepted)
                        break;
                }
            }
            if (!moved)
                break;
        }
    }
    separateLanes();
    // Repair any corridor obscured by an unrelated card, including a visible clearance.
    function repairRoute(route: GraphEdge): void {
        const clearance = 12;
        const blocked = (a: ElkPoint, b: ElkPoint) => result.children!.some(node => {
            const margin = node.id === route.from || node.id === route.to ? -.5 : clearance;
            const left = node.x! - margin, right = node.x! + node.width! + margin, top = node.y! - margin, bottom = node.y! + node.height! + margin;
            return a.y === b.y ? a.y > top && a.y < bottom && Math.min(a.x, b.x) < right && Math.max(a.x, b.x) > left : a.x > left && a.x < right && Math.min(a.y, b.y) < bottom && Math.max(a.y, b.y) > top;
        });
        const source = result.children!.find(n => n.id === route.from)!, target = result.children!.find(n => n.id === route.to)!;
        const start = route.points[0], end = route.points.at(-1)!;
        const stub = (p: ElkPoint, n: ElkNode): ElkPoint => Math.abs(p.x - n.x!) < .1 ? { x: p.x - 16, y: p.y } : Math.abs(p.x - n.x! - n.width!) < .1 ? { x: p.x + 16, y: p.y } : Math.abs(p.y - n.y!) < .1 ? { x: p.x, y: p.y - 16 } : { x: p.x, y: p.y + 16 };
        const first = stub(start, source), last = stub(end, target);
        const normal = (point: ElkPoint, neighbor: ElkPoint, outside: ElkPoint) => outside.x === point.x ? neighbor.x === point.x && (neighbor.y - point.y) * (outside.y - point.y) > 0 : neighbor.y === point.y && (neighbor.x - point.x) * (outside.x - point.x) > 0;
        if (normal(start, route.points[1], first) && normal(end, route.points.at(-2)!, last) && !route.points.slice(1).some((b, i) => blocked(route.points[i], b)) && !segments().filter(segment => segment.route === route).some(segment => segments().some(other => conflicts(segment, other))))
            return;
        const xs = [...new Set([first.x, last.x, 8, result.width! + 24, ...result.children!.flatMap(n => [n.x! - 16, n.x! + n.width! + 16])])].sort((a, b) => a - b);
        const ys = [...new Set([first.y, last.y, 8, result.height! + 24, ...result.children!.flatMap(n => [n.y! - 16, n.y! + n.height! + 16])])].sort((a, b) => a - b);
        type State = {
            x: number;
            y: number;
            direction: number;
            cost: number;
            priority: number;
            key: string;
        };
        const queue: State[] = [], costs = new Map<string, number>(), previous = new Map<string, string>();
        const firstX = xs.indexOf(first.x), firstY = ys.indexOf(first.y), lastX = xs.indexOf(last.x), lastY = ys.indexOf(last.y);
        const initialDirection = first.x === start.x ? 2 : 1;
        const push = (x: number, y: number, direction: number, cost: number, parent?: string) => {
            const key = `${x}:${y}:${direction}`;
            if (cost >= (costs.get(key) ?? Infinity))
                return;
            costs.set(key, cost);
            if (parent)
                previous.set(key, parent);
            const state = { x, y, direction, cost, key, priority: cost + Math.abs(xs[x] - last.x) + Math.abs(ys[y] - last.y) };
            let lo = 0, hi = queue.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (queue[mid].priority < state.priority)
                    lo = mid + 1;
                else
                    hi = mid;
            }
            queue.splice(lo, 0, state);
        };
        push(firstX, firstY, initialDirection, 0);
        let finish: string | undefined;
        while (queue.length) {
            const current = queue.shift()!;
            if (current.cost !== costs.get(current.key))
                continue;
            if (current.x === lastX && current.y === lastY) {
                finish = current.key;
                break;
            }
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const x = current.x + dx, y = current.y + dy;
                if (x < 0 || y < 0 || x >= xs.length || y >= ys.length)
                    continue;
                const a = { x: xs[current.x], y: ys[current.y] }, b = { x: xs[x], y: ys[y] };
                if (blocked(a, b))
                    continue;
                const direction = dx ? 1 : 2;
                const shared = segments().some(other => conflicts({ route, index: 0, a, b, horizontal: !!dx }, other));
                push(x, y, direction, current.cost + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (direction !== current.direction ? 18 : 0) + (shared ? 10000 : 0), current.key);
            }
        }
        if (!finish)
            throw Error(`Unable to route dependency without crossing a node: ${route.from} → ${route.to}`);
        const middle: ElkPoint[] = [];
        for (let key: string | undefined = finish; key; key = previous.get(key)) {
            const [x, y] = key.split(':').map(Number);
            middle.push({ x: xs[x], y: ys[y] });
        }
        const points = [start, ...middle.reverse(), end], simplified: ElkPoint[] = [];
        for (const p of points) {
            const a = simplified.at(-2), b = simplified.at(-1);
            if (b && b.x === p.x && b.y === p.y)
                continue;
            if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)))
                simplified.pop();
            simplified.push(p);
        }
        route.points = simplified;
    }
    for (const route of routes)
        repairRoute(route);
    orderEndpoints();
    separateLanes();
    for (const route of routes)
        repairRoute(route);
    for (const route of routes) {
        route.points = route.points.filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
        route.path = rounded(route.points);
    }
    return { positions, edges: routes, width: Math.max(400, result.width!, ...routes.flatMap(route => route.points.map(p => p.x + 36))), height: Math.max(330, result.height!, ...routes.flatMap(route => route.points.map(p => p.y + 36))) };
}
