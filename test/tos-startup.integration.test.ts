import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("ordinary CLI startup leaves the TOS SDK unloaded until the cloud client is requested",{timeout:15000},async t=>{
  const code=`import {createRequire} from "node:module"; import {sep} from "node:path";
    const require=createRequire(import.meta.url);
    const loaded=()=>Object.keys(require.cache).some(path=>path.split(sep).join("/").includes("@volcengine/tos-sdk"));
    await import("./src/cli-program.ts");const before=loaded();
    await import("./src/data/extensions/tos-datastore/client.ts");
    console.log(JSON.stringify({before,after:loaded()}));`;
  const result=await promisify(execFile)(process.execPath,["--import",import.meta.resolve("tsx"),"--input-type=module","-e",code],{cwd:fileURLToPath(new URL("../",import.meta.url)),signal:t.signal,timeout:10000});
  assert.deepEqual(JSON.parse(result.stdout),{before:false,after:true});
});
