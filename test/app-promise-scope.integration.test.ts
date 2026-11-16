import assert from "node:assert/strict";
import test from "node:test";


test("App Promise tracking leaves unrelated unhandled rejections unchanged", async () => {
  const {spawnSync} = await import("node:child_process");
  const module = new URL("../src/app/promise-scope.ts", import.meta.url).href;
  const script = `import {AppPromiseScope} from ${JSON.stringify(module)};const scope=new AppPromiseScope();Promise.reject(new Error('outside-operation'));setImmediate(()=>scope.close());`;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {encoding:"utf8"});
  assert.equal(child.status, 1);
  assert.match(child.stderr, /outside-operation/);
});

test("App Promise tracking does not suppress detached failures after its scope closes", async () => {
  const {spawnSync} = await import("node:child_process");
  const module = new URL("../src/app/promise-scope.ts", import.meta.url).href;
  const script = `import {AppPromiseScope} from ${JSON.stringify(module)};const scope=new AppPromiseScope();scope.run(()=>new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('after-operation')),20)));scope.close();`;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {encoding:"utf8"});
  assert.equal(child.status, 1);
  assert.match(child.stderr, /after-operation/);
});
