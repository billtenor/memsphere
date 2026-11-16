import assert from "node:assert/strict";
import test from "node:test";
import { appManifestSchema } from "../src/app/contracts.js";


test("manifest rejects duplicate App and Project Store keys",()=>{
  const manifest={schemaVersion:1,id:"example.app",name:"Example",version:"1.0.0",description:"Example",stores:[{key:"same",model:"record.json",kind:"ValueStore",factory:"memsphere/filesystem-json",config:{}}],projectStores:[{key:"same",model:"record.json",kind:"ValueStore",configKey:"store"}]};
  assert.equal(appManifestSchema.safeParse({...manifest,projectStores:[]}).success,true);
  const result=appManifestSchema.safeParse(manifest);assert.equal(result.success,false);
  if(!result.success)assert(result.error.issues.some(issue=>issue.message==="duplicate stores"));
});
