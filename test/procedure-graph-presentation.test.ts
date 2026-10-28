import test from 'node:test';
import assert from 'node:assert/strict';
import { procedureEdges, type ProcedureDefinition } from '../modules/shared/view/procedure-graph.js';
import { layoutGraph } from '../modules/shared/view/graph-layout.js';
test('definition preserves separate triggers, join members, conditions and collection edges', () => {
    const graph: ProcedureDefinition = { actions: [{ id: 'a', description: 'A', dependencies: [{ from: 'START' }] }, { id: 'b', description: 'B', dependencies: [{ from: 'a', when: 'artifacts.a.ok = true' }, { from: 'a' }, { from: ['a', 'b'] }], collect: ['a'] }] };
    const edges = procedureEdges(graph);
    assert.equal(new Set(edges.map(e => e.id)).size, edges.length);
    assert.equal(edges.filter(e => e.from === 'a' && e.to === 'b').length, 4);
    assert.equal(edges.find(e => e.when)?.when, 'artifacts.a.ok = true');
    assert.deepEqual(edges.filter(e => e.group.length === 2).map(e => e.group), [['a', 'b'], ['a', 'b']]);
    assert.equal(edges.filter(e => e.collect).length, 1);
});
for (const [name, dependencies] of Object.entries({ cycle: [['b'], ['a']], self: [['a']], parallel: [[], ['a', 'a']] }))
    test(`actual layout routes ${name} without losing edges`, async () => {
        const nodes = dependencies.map((deps, i) => ({ id: String.fromCharCode(97 + i), dependencies: deps, width: 180, height: 100 }));
        const result = await layoutGraph(nodes);
        assert.equal(result.edges.length, dependencies.flat().length);
        for (const edge of result.edges) {
            for (let i = 1; i < edge.points.length; i++)
                assert.ok(edge.points[i].x === edge.points[i - 1].x || edge.points[i].y === edge.points[i - 1].y);
            assert.ok(edge.points.length >= 2);
            assert.ok(!edge.path.includes('NaN'));
            for (const point of edge.points) {
                assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
            }
        }
        if (name === 'parallel')
            assert.notEqual(result.edges[0].path, result.edges[1].path);
    });
test('self loops use top ports and arrowheads follow the final segment', async () => {
    const result = await layoutGraph([{ id: 'a', dependencies: ['a'], width: 180, height: 100 }]);
    const edge = result.edges[0], position = result.positions.get('a')!;
    assert.equal(edge.points[0].y, position.y);
    assert.equal(edge.points.at(-1)!.y, position.y);
    const tip = edge.points.at(-1)!, previous = edge.points.at(-2)!;
    assert.equal(tip.x, previous.x);
    assert.ok(tip.y > previous.y);
    assert.ok(edge.path.endsWith('l -3 -6'));
});
test('fan-out dependency corridors avoid unrelated cards and overlapping parallel segments', async () => {
    const dependencies = [[], ['a'], ['b'], ['a', 'b', 'c'], ['b', 'd'], ['a', 'b', 'd', 'e'], ['a', 'f']];
    const nodes = dependencies.map((deps, i) => ({ id: String.fromCharCode(97 + i), dependencies: deps, width: 178, height: 112 }));
    const result = await layoutGraph(nodes);
    const segments = result.edges.flatMap(edge => edge.points.slice(1).map((b, i) => ({ edge, a: edge.points[i], b })));
    for (const edge of result.edges)
        for (const [id, point, neighbor] of [[edge.from, edge.points[0], edge.points[1]], [edge.to, edge.points.at(-1)!, edge.points.at(-2)!]] as const) {
            const p = result.positions.get(id)!, node = nodes.find(n => n.id === id)!;
            const valid = Math.abs(point.x - p.x) < .1 ? neighbor.y === point.y && neighbor.x < point.x : Math.abs(point.x - p.x - node.width) < .1 ? neighbor.y === point.y && neighbor.x > point.x : Math.abs(point.y - p.y) < .1 ? neighbor.x === point.x && neighbor.y < point.y : neighbor.x === point.x && neighbor.y > point.y;
            assert.equal(valid, true, 'edge meets its node from outside, perpendicular to the side');
        }
    for (const { edge, a, b } of segments)
        for (const node of nodes) {
            if (node.id === edge.from || node.id === edge.to)
                continue;
            const p = result.positions.get(node.id)!;
            const crosses = a.y === b.y ? a.y >= p.y && a.y <= p.y + node.height && Math.min(a.x, b.x) < p.x + node.width && Math.max(a.x, b.x) > p.x : a.x >= p.x && a.x <= p.x + node.width && Math.min(a.y, b.y) < p.y + node.height && Math.max(a.y, b.y) > p.y;
            assert.equal(crosses, false, `${edge.from} → ${edge.to} crosses ${node.id}`);
        }
    for (let i = 0; i < segments.length; i++)
        for (let j = i + 1; j < segments.length; j++) {
            const x = segments[i], y = segments[j];
            if (x.edge === y.edge)
                continue;
            const horizontal = x.a.y === x.b.y && y.a.y === y.b.y && Math.abs(x.a.y - y.a.y) < 1 && Math.min(Math.max(x.a.x, x.b.x), Math.max(y.a.x, y.b.x)) - Math.max(Math.min(x.a.x, x.b.x), Math.min(y.a.x, y.b.x)) > 1;
            const vertical = x.a.x === x.b.x && y.a.x === y.b.x && Math.abs(x.a.x - y.a.x) < 1 && Math.min(Math.max(x.a.y, x.b.y), Math.max(y.a.y, y.b.y)) - Math.max(Math.min(x.a.y, x.b.y), Math.min(y.a.y, y.b.y)) > 1;
            assert.equal(horizontal || vertical, false, 'parallel dependency segments overlap');
        }
});
test('local reciprocal loop stacks above its main-flow anchor with distinct vertical arrows', async () => {
    const nodes = [{ id: 'pr', dependencies: [], width: 178, height: 112 }, { id: 'check', dependencies: ['pr', 'repair'], width: 178, height: 112 }, { id: 'repair', dependencies: ['check'], width: 178, height: 146 }, { id: 'finish', dependencies: ['check'], width: 178, height: 112 }];
    const result = await layoutGraph(nodes), check = result.positions.get('check')!, repair = result.positions.get('repair')!;
    assert.equal(repair.x, check.x);
    assert.ok(repair.y + 146 < check.y);
    const forward = result.edges.find(e => e.from === 'check' && e.to === 'repair')!, back = result.edges.find(e => e.from === 'repair' && e.to === 'check')!;
    assert.equal(forward.points[0].y, check.y);
    assert.equal(back.points[0].y, repair.y + 146);
    assert.notEqual(forward.points[0].x, back.points[0].x);
    assert.ok(forward.points.every(p => p.x === forward.points[0].x));
    assert.ok(back.points.every(p => p.x === back.points[0].x));
});
test('stable route IDs survive unknown sources and parallel edges', async () => {
    const layout = await layoutGraph([{ id: 'a', width: 178, height: 100, dependencies: [] }, { id: 'b', width: 178, height: 100, dependencies: ['missing', 'a', 'a'], dependencyIds: ['unknown', 'conditional', 'ordinary'] }]);
    assert.deepEqual(layout.edges.map(edge => edge.id), ['conditional', 'ordinary']);
    assert.notEqual(layout.edges[0].path, layout.edges[1].path);
});
test('the delivered agile graph routes every dependency outside unrelated cards', async () => {
    const { readFile } = await import('node:fs/promises');
    const { parseMemoryYaml } = await import('../src/memory/yaml.js');
    const p = parseMemoryYaml(await readFile(new URL('../.memsphere/memory/procedures/memsphere-agile-requirement-development-graph.yaml', import.meta.url), 'utf8')) as ProcedureDefinition;
    const edges = procedureEdges(p), nodes = [{ id: 'START', width: 44, height: 44, dependencies: [] as string[], dependencyIds: [] as string[] }, ...p.actions.map(action => ({ id: action.id, width: 178, height: 160, dependencies: edges.filter(e => e.to === action.id).map(e => e.from), dependencyIds: edges.filter(e => e.to === action.id).map(e => e.id) }))];
    const layout = await layoutGraph(nodes);
    assert.equal(p.actions.length, 14);
    assert.equal(layout.edges.length, edges.length);
    assert.equal(new Set(layout.edges.map(e => e.id)).size, edges.length);
    for (const edge of layout.edges)
        for (const node of nodes.filter(n => n.id !== edge.from && n.id !== edge.to)) {
            const p = layout.positions.get(node.id)!;
            for (let i = 1; i < edge.points.length; i++) {
                const a = edge.points[i - 1], b = edge.points[i];
                const hit = a.x === b.x ? a.x > p.x && a.x < p.x + node.width && Math.max(a.y, b.y) > p.y && Math.min(a.y, b.y) < p.y + node.height : a.y > p.y && a.y < p.y + node.height && Math.max(a.x, b.x) > p.x && Math.min(a.x, b.x) < p.x + node.width;
                assert.equal(hit, false, `${edge.id} crosses ${node.id}`);
            }
        }
});
