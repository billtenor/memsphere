import assert from "node:assert/strict";

import test from "node:test";



import { layoutGraph } from "../modules/org.memsphere.run/adapter/view/graph-layout.js";

const a = (id: string, dependencies: string[] = [], revisedFrom?: string) => ({ id, stepId: `step-${id}`, name: id, tags: ["default"], status: "submitted", dependencies: dependencies.map(id => ({ kind: "artifact", id })), ...(revisedFrom ? { revisedFrom } : {}) });

test("measured layered layout retains every dependency and avoids unrelated nodes", async () => {
  const nodes = [{ id: "source", dependencies: [] }, { id: "A", dependencies: ["source"] }, { id: "B", dependencies: ["source", "A"] }, { id: "C", dependencies: ["source", "A", "B"] }, { id: "disconnected", dependencies: [] }].map((n,i) => ({ ...n, width: 226, height: 150 + i * 25, cardHeight: 120 + i * 25 }));
  const layout = await layoutGraph(nodes);
  assert.equal(layout.edges.length, 6);
  const sourceEdges = layout.edges.filter(e => e.from === "source");
  assert.equal(new Set(sourceEdges.map(e => e.points[0].y)).size, 3);
  for (const edge of layout.edges) {
    for (const node of nodes.filter(n => n.id !== edge.from && n.id !== edge.to)) {
      const p = layout.positions.get(node.id)!;
      for (let i=1; i<edge.points.length; i++) {
        const a=edge.points[i-1], b=edge.points[i];
        const crosses = a.x === b.x ? a.x > p.x && a.x < p.x+node.width && Math.max(a.y,b.y)>p.y && Math.min(a.y,b.y)<p.y+node.height : a.y>p.y && a.y<p.y+node.height && Math.max(a.x,b.x)>p.x && Math.min(a.x,b.x)<p.x+node.width;
        assert.equal(crosses, false, `${edge.from}→${edge.to} intersects ${node.id}`);
      }
    }
  }
  for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
    const a=nodes[i], b=nodes[j], p=layout.positions.get(a.id)!, q=layout.positions.get(b.id)!;
    assert.ok(p.x+a.width<=q.x || q.x+b.width<=p.x || p.y+a.height<=q.y || q.y+b.height<=p.y);
  }
});
