import assert from "node:assert/strict";
import test from "node:test";
import { artifactHistory } from "../modules/org.memsphere.run/adapter/view/context-control.js";
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

test("fifty revisions stay folded and selecting a version projects its actual continuation", () => {
  const records = [a("input"), a("v0", ["input"])];
  for (let i = 1; i <= 50; i++) records.push(a(`v${i}`, ["input"], `v${i - 1}`));
  records.push(a("summary", ["v50"]));
  const history = artifactHistory(records);
  assert.deepEqual(history.latest().map(a => a.id), ["input", "v50", "summary"]);
  assert.deepEqual(history.around("v25").map(a => a.id), ["input", "v25"]);
  assert.equal(history.versions("v25").length, 51);
});

test("graph projections preserve explicitly required multiple versions and exact delivery roots", () => {
  const history = artifactHistory([a("a1"), a("a2", [], "a1"), a("comparison", ["a1", "a2"]), a("other")]);
  assert.deepEqual(history.latest(["comparison"]).map(a => a.id), ["a1", "a2", "comparison"]);
  assert.deepEqual(history.around("a1").map(a => a.id), ["a1", "a2", "comparison"]);
});

test("a newer branch from an old revision is latest even when another branch has more revisions", () => {
  const history = artifactHistory([a("root"), a("long-1", [], "root"), a("long-2", [], "long-1"), a("new-branch", [], "root")]);
  assert.deepEqual(history.latest().map(a => a.id), ["new-branch"]);
  assert.deepEqual(history.versions("long-2").map(a => a.id), ["root", "long-1", "long-2", "new-branch"]);
});
