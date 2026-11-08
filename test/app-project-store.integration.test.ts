import assert from "node:assert/strict";
import test from "node:test";
import { appManifestSchema } from "../src/app/contracts.js";
import { projectStoreBinding, updateProjectStoreGenerations } from "../src/app/project-stores.js";
import type { AppInstallation, AppProject } from "../src/app/state.js";
import { removeBusinessStore } from "../src/project/business-stores.js";
import { businessFixture } from "./helpers/business-data.js";

test("Project Store binding resolves existing records and changes identity when re-registered", async t => {
  const fixture = await businessFixture(t);
  await fixture.createStore();
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "expenses", model: "record.json", kind: "ValueStore", configKey: "store" }] });
  const app = { manifest, config: { store: "records" } } as AppInstallation;
  const project = { paths: { root: fixture.root }, memoryRoot: `${fixture.root}/memory` } as AppProject;
  updateProjectStoreGenerations(app);
  const first = await projectStoreBinding(project, app, "expenses");
  assert.equal(first.store.kind, "ValueStore");
  if (first.store.kind !== "ValueStore") throw new Error("wrong kind");
  await first.store.create({}, "one", { name: "first", count: 1 });
  await removeBusinessStore({}, fixture.root, "records");
  await fixture.createStore();
  const second = await projectStoreBinding(project, app, "expenses");
  assert.notEqual(second.token, first.token);
  assert.equal(second.store.kind, "ValueStore");
  if (second.store.kind !== "ValueStore") throw new Error("wrong kind");
  assert.deepEqual((await second.store.get({}, "one"))?.value, { name: "first", count: 1 });
});

test("Project Store binding rejects an incompatible Store instead of creating another", async t => {
  const fixture = await businessFixture(t);
  await fixture.createStore();
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "expenses", model: "record.json", kind: "DataStore", configKey: "store" }] });
  const app = { manifest, config: { store: "records" } } as AppInstallation;
  const project = { paths: { root: fixture.root }, memoryRoot: `${fixture.root}/memory` } as AppProject;
  await assert.rejects(projectStoreBinding(project, app, "expenses"), { code: "APP_STORE_MISMATCH" });
});

test("Project Store binding rejects a different model of the same kind", async t => {
  const fixture=await businessFixture(t);await fixture.createStore();
  const manifest=appManifestSchema.parse({schemaVersion:1,id:"example.app",name:"Example",version:"1.0.0",description:"Example",projectStores:[{key:"expenses",model:"other.json",kind:"ValueStore",configKey:"store"}]});
  const project={paths:{root:fixture.root},memoryRoot:`${fixture.root}/memory`} as AppProject;
  await assert.rejects(projectStoreBinding(project,{manifest,config:{store:"records"}} as AppInstallation,"expenses"),{code:"APP_STORE_MISMATCH"});
});

test("Project Store binding rejects undeclared keys",async t=>{
  const fixture=await businessFixture(t);const project={paths:{root:fixture.root},memoryRoot:`${fixture.root}/memory`} as AppProject;
  const manifest=appManifestSchema.parse({schemaVersion:1,id:"example.app",name:"Example",version:"1.0.0",description:"Example"});
  await assert.rejects(projectStoreBinding(project,{manifest,config:{}} as AppInstallation,"missing"),{code:"APP_STORE_NOT_FOUND"});
});

test("App binding rejects the internal context-control Stores", async t => {
  const fixture = await businessFixture(t);
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "runs", model: "record.json", kind: "ValueStore", configKey: "store" }] });
  const app = { manifest, config: { store: "context_control/runs" } } as AppInstallation;
  const project = { paths: { root: fixture.root }, memoryRoot: `${fixture.root}/memory` } as AppProject;
  await assert.rejects(projectStoreBinding(project, app, "runs"), { code: "APP_STORE_FORBIDDEN" });
});

test("a declared DataStore resolves the Project's existing DataStore", async t => {
  const fixture = await businessFixture(t);
  await fixture.createStore("files", "record.json", "data");
  const manifest = appManifestSchema.parse({ schemaVersion: 1, id: "example.app", name: "Example", version: "1.0.0", description: "Example", projectStores: [{ key: "files", model: "record.json", kind: "DataStore", configKey: "store" }] });
  const app = { manifest, config: { store: "files" } } as AppInstallation;
  const project = { paths: { root: fixture.root }, memoryRoot: `${fixture.root}/memory` } as AppProject;
  const binding = await projectStoreBinding(project, app, "files");
  assert.equal(binding.store.kind, "DataStore");
  assert.equal(binding.store.id, "files");
});
