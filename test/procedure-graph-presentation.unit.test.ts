import test from 'node:test';

import assert from 'node:assert/strict';

import { procedureEdges, type ProcedureDefinition } from '../modules/shared/view/procedure-graph.js';



test('definition preserves separate triggers, join members, conditions and collection edges', () => {
    const graph: ProcedureDefinition = { actions: [{ id: 'a', description: 'A', dependencies: [{ from: 'START' }] }, { id: 'b', description: 'B', dependencies: [{ from: 'a', when: 'artifacts.a.ok = true' }, { from: 'a' }, { from: ['a', 'b'] }], collect: ['a'] }] };
    const edges = procedureEdges(graph);
    assert.equal(new Set(edges.map(e => e.id)).size, edges.length);
    assert.equal(edges.filter(e => e.from === 'a' && e.to === 'b').length, 4);
    assert.equal(edges.find(e => e.when)?.when, 'artifacts.a.ok = true');
    assert.deepEqual(edges.filter(e => e.group.length === 2).map(e => e.group), [['a', 'b'], ['a', 'b']]);
    assert.equal(edges.filter(e => e.collect).length, 1);
});
