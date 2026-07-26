import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readConfigAt } from "../src/config.js";
import { createViewServer } from "../src/commands/view.js";

async function withSettingsServer(
  host: string,
  fn: (context: { origin: string; configPath: string; token?: string }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memsphere-view-settings-"));
  const configPath = join(dir, "config.json");
  await writeFile(configPath, `${JSON.stringify({
    memoryRoot: "memory",
    view: { host, port: 30002 },
    control_plane: {
      runner: { permissions: ["artifact.read"] },
      actors: {}
    }
  }, null, 2)}\n`);
  const config = await readConfigAt(configPath);
  const token = host === "127.0.0.1" ? undefined : "a".repeat(43);
  const server = createViewServer(config, { settingsToken: token });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await fn({ origin: `http://127.0.0.1:${port}`, configPath, token });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("loopback Settings validates same-origin JSON and rejects cross-origin requests", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin }) => {
    const settings = await fetch(`${origin}/api/settings`);
    assert.equal(settings.status, 200);
    const payload = await settings.json() as {
      diskRevision: string;
      config: {
        control_plane?: {
          runner?: unknown;
          actors?: unknown;
          acp_providers?: Record<string, unknown>;
        };
      };
      permissionCatalog: Array<{ id: string }>;
      acpProviderCatalog: Array<{ type: string; defaultInstance: { command: string } }>;
    };
    assert.deepEqual(payload.permissionCatalog.map((definition) => definition.id), [
      "artifact.read",
      "artifact.write",
      "artifact.submit",
      "decision.assess",
      "decision.decide"
    ]);
    assert.deepEqual(payload.acpProviderCatalog.map((definition) => definition.type), [
      "traex",
      "qwen",
      "kimi",
      "codex"
    ]);

    payload.config.control_plane = {
      ...payload.config.control_plane,
      acp_providers: {
        traex: {}
      }
    };
    const detected = await fetch(`${origin}/api/settings/acp-providers/detect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "sec-fetch-site": "same-origin"
      },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(detected.status, 200);
    const detection = await detected.json() as {
      results: Array<{ id: string; status: string; path?: string; version?: string }>;
    };
    assert.deepEqual(detection.results.map((result) => result.id), [
      "traex",
      "qwen",
      "kimi",
      "codex"
    ]);
    assert(detection.results.every((result) =>
      ["installed", "version_unknown", "missing", "failed"].includes(result.status)
    ));

    const missingOrigin = await fetch(`${origin}/api/settings/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json() as { code: string }).code, "request_origin_rejected");

    const crossOrigin = await fetch(`${origin}/api/settings/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://example.test" },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(crossOrigin.status, 403);

    const valid = await fetch(`${origin}/api/settings/validate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "sec-fetch-site": "same-origin"
      },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json() as { valid: boolean }).valid, true);
  });
});

test("non-loopback Settings requires a token in addition to same-origin requests", async () => {
  await withSettingsServer("0.0.0.0", async ({ origin, token }) => {
    assert.equal((await fetch(`${origin}/api/settings`)).status, 401);

    const authorized = await fetch(`${origin}/api/settings`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(authorized.status, 200);
    const payload = await authorized.json() as {
      diskRevision: string;
      config: { memoryRoot: string };
    };
    payload.config.memoryRoot = "new-memory";

    const saved = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(saved.status, 200);
    assert.match(await readFile((await saved.json() as { configPath: string }).configPath, "utf8"), /new-memory/);
  });
});

test("Settings save rejects stale revisions", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin, configPath }) => {
    const payload = await (await fetch(`${origin}/api/settings`)).json() as {
      diskRevision: string;
      config: { memoryRoot: string };
    };
    payload.config.memoryRoot = "candidate";
    await writeFile(configPath, JSON.stringify({ memoryRoot: "external" }));

    const saved = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(saved.status, 409);
    assert.match(await readFile(configPath, "utf8"), /external/);
  });
});

test("Settings save returns field errors for an invalid draft", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin }) => {
    const payload = await (await fetch(`${origin}/api/settings`)).json() as {
      diskRevision: string;
      config: { memoryRoot: string };
    };
    payload.config.memoryRoot = "";

    const saved = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(saved.status, 422);
    const failure = await saved.json() as { code: string; errors: Array<{ path: string }> };
    assert.equal(failure.code, "config_invalid");
    assert.equal(failure.errors[0]?.path, "memoryRoot");
  });
});

test("Settings validation never exposes hidden debug or internal candidate data", async () => {
  await withSettingsServer("127.0.0.1", async ({ origin, configPath }) => {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    raw.debug = { agent_review: true };
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
    const payload = await (await fetch(`${origin}/api/settings`)).json() as {
      diskRevision: string;
      config: Record<string, unknown>;
    };
    assert.equal(payload.config.debug, undefined);

    const validated = await fetch(`${origin}/api/settings/validate`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ expectedRevision: payload.diskRevision, config: payload.config })
    });
    assert.equal(validated.status, 200);
    const result = await validated.json() as Record<string, unknown>;
    assert.equal(result.candidate, undefined);
    assert.doesNotMatch(String(result.normalizedJson), /"debug"/);
  });
});
