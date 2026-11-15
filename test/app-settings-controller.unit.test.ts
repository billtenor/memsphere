import assert from "node:assert/strict";
import test from "node:test";
import { AppSettingsController } from "../src/view/app-settings-controller.js";
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(r => resolve = r); return { promise, resolve }; };
function fixture(transport: any = async (_: unknown, body: any) => ({ ...body, revision: "new" }), deadlines = { validate: 15000, save: 30000 }) {
    return new AppSettingsController("project", { id: "example.app", name: "Example" }, true, { config: { name: "A", prefs: { color: "blue" } }, revision: "old" }, transport, async () => ({ candidates: [] }), deadlines);
}
test("save captures one candidate and rejects editing, reset and duplicate requests until confirmed", async () => {
    const done = deferred();
    let submitted: any;
    const c = fixture(async (_: unknown, body: any) => { submitted = body; return done.promise; });
    c.setValue(["name"], "B");
    const saving = c.save();
    assert.equal(c.getState().busy, true);
    for (const edit of [() => c.setValue(["name"], "C"), () => c.setText(["prefs"], "{}"), () => c.removeValue(["name"]), () => c.reset()])
        assert.throws(edit, { code: "APP_SETTINGS_BUSY" });
    await assert.rejects(c.save(), { code: "APP_SETTINGS_BUSY" });
    await assert.rejects(c.validate(), { code: "APP_SETTINGS_BUSY" });
    assert.equal(submitted.config.name, "B");
    done.resolve({ config: submitted.config, revision: "new" });
    await saving;
    assert.equal(c.getState().draft.name, "B");
    assert.equal(c.getState().dirty, false);
    c.setValue(["name"], "C");
    assert.equal(c.getState().dirty, true);
    c.dispose();
});
test("invalid and formatting-only JSON stay dirty; invalid text never reaches transport", async () => {
    let requests = 0;
    const c = fixture(async () => { requests++; });
    c.setText(["prefs"], '{"color":');
    assert.equal(c.getState().dirty, true);
    assert.equal(c.getState().textBuffers[0].text, '{"color":');
    await assert.rejects(c.save(), { code: "APP_SETTINGS_INVALID_TEXT" });
    await assert.rejects(c.validate(), { code: "APP_SETTINGS_INVALID_TEXT" });
    assert.equal(requests, 0);
    c.setText(["prefs"], '{  "color": "blue" }');
    assert.equal(c.getState().dirty, true);
    assert.equal(c.getState().textBuffers[0].error, undefined);
    c.reset();
    assert.equal(c.getState().dirty, false);
    c.dispose();
});
test("text path conflicts preserve every byte and issue, including valid ancestors and root", () => {
    const c = fixture();
    c.setText(["prefs"], '{"color":"red"}');
    const before = c.getState();
    for (const edit of [() => c.setText([], "{}"), () => c.setText(["prefs", "color"], '"green"'), () => c.setValue(["prefs"], {}), () => c.removeValue(["prefs", "color"])]) {
        assert.throws(edit, { code: "APP_SETTINGS_TEXT_CONFLICT" });
        assert.deepEqual(c.getState(), before);
    }
    c.setText(["preferences"], "{}");
    c.reset();
    c.setText([], "{}");
    assert.throws(() => c.setText(["prefs"], "{}"), { code: "APP_SETTINGS_TEXT_CONFLICT" });
    c.dispose();
});
test("conflicts and failed validation retain drafts; snapshots cannot mutate the authority", async () => {
    const c = fixture(async () => { throw Object.assign(Error("Changed elsewhere"), { code: "APP_CONFIG_CONFLICT" }); });
    c.setValue(["name"], "B");
    await assert.rejects(c.save(), { code: "APP_CONFIG_CONFLICT" });
    assert.equal(c.getState().status, "conflict");
    assert.equal(c.getState().dirty, true);
    const snapshot = c.getState();
    snapshot.draft.name = "bad";
    assert.equal(c.getState().draft.name, "B");
    c.dispose();
});
test("timeout releases busy, retains unconfirmed draft and ignores late success", async () => {
    const done = deferred();
    const c = fixture(() => done.promise, { validate: 5, save: 5 });
    c.setValue(["name"], "B");
    await assert.rejects(c.save(), { code: "APP_SETTINGS_TIMEOUT" });
    assert.equal(c.getState().status, "unconfirmed");
    assert.equal(c.getState().busy, false);
    c.setValue(["name"], "C");
    done.resolve({ config: { name: "B" }, revision: "late" });
    await Promise.resolve();
    assert.equal(c.getState().draft.name, "C");
    assert.equal(c.getState().revision, "old");
    c.dispose();
});
test("disposal invalidates pending and future callbacks; JSON APIs reject lossy values", async () => {
    const done = deferred();
    const c = fixture(() => done.promise);
    for (const value of [NaN, Infinity, undefined, { bad: undefined }, new Date()])
        assert.throws(() => c.setValue(["name"], value));
    const pending = c.validate();
    c.dispose();
    await assert.rejects(pending, { code: "APP_SETTINGS_CLOSED" });
    assert.throws(() => c.setValue(["name"], "later"), { code: "APP_SETTINGS_CLOSED" });
    await assert.rejects(c.save(), { code: "APP_SETTINGS_CLOSED" });
    done.resolve({ config: { name: "late" }, revision: "late" });
});

test("numeric fields retain lossy, fractional and nonnumeric raw inputs without submitting old values",async()=>{
 let requests=0;const c=fixture(async()=>{requests++;});
 for(const text of ["","-","1e999","false","1.5"]){c.setText(["count"],text,"integer");assert.equal(c.getState().textBuffers[0].text,text);await assert.rejects(c.save(),{code:"APP_SETTINGS_INVALID_TEXT"});}
 assert.equal(requests,0);c.setText(["count"],"2","integer");assert.equal(c.getState().draft.count,2);c.dispose();
});

test("nested edits preserve array siblings and reject scalar traversal without partial changes",()=>{
 const c=fixture();c.setValue(["rows"],[{name:"first"},{name:"second"}]);c.setValue(["rows","0","name"],"changed");assert.deepEqual(c.getState().draft.rows,[{name:"changed"},{name:"second"}]);c.removeValue(["rows","0"]);assert.deepEqual(c.getState().draft.rows,[{name:"second"}]);const before=c.getState();assert.throws(()=>c.setValue(["name","child"],1),{code:"APP_SETTINGS_PATH"});assert.deepEqual(c.getState(),before);assert.throws(()=>c.setValue(["rows","extra"],1),{code:"APP_SETTINGS_PATH"});assert.deepEqual(c.getState(),before);c.dispose();
});
