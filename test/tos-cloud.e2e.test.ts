import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createTosClient } from "../src/data/extensions/tos-datastore/client.js";
import { TosDataStore } from "../src/data/extensions/tos-datastore/store.js";
import { validateCredentials, type TosConfig } from "../src/data/extensions/tos-datastore/config.js";
import { bytesContent, readAll } from "../src/data/extensions/shared/payload.js";

const credentialFile = process.env.MEMSPHERE_TOS_TEST_CREDENTIALS_FILE;

test("official SDK cloud calibration in an owned lyj-test prefix", { skip: !credentialFile, timeout: 180_000 }, async t => {
  // Explicitly enabled only with a private local file. Never print its contents.
  let credentials: ReturnType<typeof validateCredentials>;
  try { credentials = validateCredentials(JSON.parse(await readFile(credentialFile!, "utf8"))); }
  catch { throw Error("Unable to read valid private TOS credentials"); }
  const owner = randomUUID(), base = `memsphere-sdk-probes/${owner}/`, model = `probe-${owner}.json`;
  t.diagnostic(`Reserved cloud probe prefix: ${base}`);
  const common = { region: "cn-beijing", endpoint: "tos-cn-beijing.volces.com", bucket: "lyj-test", credentials: { source: "settings" as const, id: "probe" } };
  const config: TosConfig = { ...common, prefix: `${base}raw/`, mode: "raw" };
  const client = createTosClient(config, credentials);
  const context = { signal: AbortSignal.any([t.signal, AbortSignal.timeout(150_000)]) };
  assert.equal(await client.versioning(context), "", "Test bucket must never have enabled versioning");
  const marker = `${base}owner`, ownerBytes = Buffer.from(owner);
  const intentKeys = [`${base}raw/图像 one`, `${base}revision/item`, `${base}revision/second`];
  let markerEtag: string | undefined;
  t.after(async () => {
    const cleanup = { signal: AbortSignal.timeout(30_000) };
    let markerRead;
    try { markerRead = await client.read(cleanup, marker, markerEtag ? { ifMatch: markerEtag } : {}); }
    catch (error) {
      if ((error as { code?: string }).code !== "NoSuchKey") throw error;
      assert.deepEqual((await client.list(cleanup, { prefix: base, limit: 128 })).keys, [], `Marker absent but objects retained: ${base}`);
      return;
    }
    const { readBounded } = await import("../src/data/extensions/tos-datastore/context-sdk.js");
    assert.equal((await readBounded(markerRead.stream, 128)).toString(), owner, `Ownership changed: ${base}`);
    for (const key of intentKeys) {
      // These random keys were reserved before writes, including uncertain outcomes.
      try {
        const headers = await client.head(cleanup, key);
        assert.equal(headers["x-tos-meta-memsphere-model"], Buffer.from(model).toString("base64url"), `Foreign object retained: ${key}`);
        await client.delete(cleanup, key);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        // HEAD 404 is ambiguous: only NoSuchKey authorizes treating it as gone.
        try { const present = await client.read(cleanup, key); present.stream.destroy(); throw Error(`Object changed during cleanup: ${key}`); }
        catch (confirmation) { if ((confirmation as { code?: string }).code !== "NoSuchKey") throw confirmation; }
      }
    }
    await client.delete(cleanup, marker);
    const remaining = await client.list(cleanup, { prefix: base, limit: 128 });
    assert.deepEqual(remaining.keys, [], `Probe cleanup incomplete: ${base}`);
    assert.equal(remaining.token, undefined);
    t.diagnostic(`Owned-prefix cleanup verified: ${base}`);
  });
  const claim = await client.put(context, marker, Readable.from([ownerBytes]), { create: true, contentType: "text/plain", meta: { "probe-owner": owner } });
  markerEtag = claim.etag;
  assert.ok(markerEtag);
  const raw = new TosDataStore("probe-raw", model, config, client);
  const revision = new TosDataStore("probe-revision", model, { ...config, prefix: `${base}revision/`, mode: "revision" }, client);
  const input = (id: string, text: string) => ({ id, model, payload: { contentType: "application/octet-stream", content: bytesContent(Buffer.from(text)) } });
  await raw.create(context, input("图像 one", "original bytes"));
  const rawRecord = await raw.get(context, "图像 one"); assert.ok(rawRecord && !rawRecord.deleted);
  assert.equal(Buffer.from(await readAll(context, rawRecord.data.payload.content)).toString(), "original bytes");
  await assert.rejects(raw.create(context, input("图像 one", "overwrite")), { code: "ALREADY_EXISTS" });
  assert.equal(await raw.delete(context, "图像 one"), true);
  assert.equal(await raw.delete(context, "图像 one"), false);
  await raw.create(context, input("图像 one", ""));
  const emptyRaw = await raw.get(context, "图像 one"); assert.ok(emptyRaw && !emptyRaw.deleted);
  assert.equal((await readAll(context, emptyRaw.data.payload.content)).byteLength, 0);
  await revision.create(context, input("item", ""));
  const first = await revision.get(context, "item"); assert.ok(first && !first.deleted);
  assert.equal(await revision.delete(context, "item", { expectedRevision: first.revision }), true);
  const deleted = await revision.get(context, "item"); assert.ok(deleted?.deleted); assert.notEqual(deleted.revision, first.revision);
  await revision.delete(context, "item", { expectedRevision: deleted.revision });
  const repeated = await revision.get(context, "item"); assert.ok(repeated?.deleted); assert.notEqual(repeated.revision, deleted.revision);
  await revision.update(context, input("item", "back"), { expectedRevision: repeated.revision });
  await assert.rejects(revision.update(context, input("item", "stale"), { expectedRevision: deleted.revision }), { code: "REVISION_CONFLICT" });
  const current = await revision.get(context, "item"); assert.ok(current && !current.deleted);
  const competing = await Promise.allSettled([revision.update(context, input("item", "A"), { expectedRevision: current.revision }), revision.update(context, input("item", "B"), { expectedRevision: current.revision })]);
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((competing.find(result => result.status === "rejected") as PromiseRejectedResult).reason.code, "REVISION_CONFLICT");
  const winner = await revision.get(context, "item"); assert.ok(winner && !winner.deleted);
  const unknownLength = input("item", "");
  unknownLength.payload.content = { stream: () => new ReadableStream<Uint8Array>({ start(output) { output.enqueue(Buffer.from("stream-")); output.enqueue(Buffer.from("EOF")); output.close(); } }) };
  await revision.update(context, unknownLength, { expectedRevision: winner.revision });
  const final = await revision.get(context, "item"); assert.ok(final && !final.deleted);
  assert.equal(Buffer.from(await readAll(context, final.data.payload.content)).toString(), "stream-EOF");
  await revision.create(context, input("second", "pagination"));
  const firstPage = await revision.list(context, { limit: 1 });
  assert.deepEqual(firstPage.items, [{ id: "item" }]); assert.ok(firstPage.nextCursor);
  const secondPage = await revision.list(context, { limit: 1, cursor: firstPage.nextCursor });
  assert.deepEqual(secondPage, { items: [{ id: "second" }] });
  const second = await revision.get(context, "second"); assert.ok(second && !second.deleted);
  await revision.delete(context, "second", { expectedRevision: second.revision });
  assert.deepEqual((await revision.list(context)).items, [{ id: "item" }]);
  assert.deepEqual((await raw.list(context)).items, [{ id: "图像 one" }]);
  t.diagnostic(`Official SDK calibration completed: ${base}`);
});
