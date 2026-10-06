import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createViewServer } from "../../src/commands/view.js";
import { installBundledSystemModels } from "../../src/project/system-models.js";
import type { MemsphereConfig } from "../../src/config.js";

/** Runs the actual View server and built-in modules against an isolated on-disk Home. */
export async function startProjectModelView(prepare?: (config: MemsphereConfig) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "memsphere-model-browser-"));
  const root = join(home, "projects", "alpha");
  const store = { type: "managed", branch: "master", published_revision: "abc" };
  const source = `  ${JSON.stringify({ title: "订单 Alpha", type: "object", properties: {
    orderNo: { type: "string", description: "订单编号" },
    items: { type: "array", items: { type: "object", properties: {
      productId: { type: "string" }, quantity: { type: "integer", minimum: 1 }
    }, required: ["quantity"] } }
  }, required: ["orderNo", "items"] })}\n`;
  for (const name of ["alpha", "beta"]) {
    const directory = join(home, "projects", name);
    await mkdir(join(directory, "memory"), { recursive: true });
    await mkdir(join(directory, "models/json-schema/draft-07/sales"), { recursive: true });
    await writeFile(join(directory, "project.json"), JSON.stringify({ format_version: 1, name, created_at: new Date().toISOString() }));
    await writeFile(join(directory, "config.json"), JSON.stringify({ store }));
    await writeFile(join(directory, "models/json-schema/draft-07/sales/order.json"), name === "alpha" ? source : '{"title":"订单 Beta","type":"number"}');
    await installBundledSystemModels({}, { root: directory });
  }
  await writeFile(join(root, "models/json-schema/draft-07/bad.json"), "invalid json");
  await writeFile(join(root, "models/json-schema/draft-07/advanced.json"), '{"title":"组合条件","anyOf":[{"type":"string"},{"type":"number"}]}');
  await mkdir(join(root, "custom"));
  await writeFile(join(root, "custom/new.json"), '{"title":"新目录模型","type":"string"}');
  await writeFile(join(home, "config.json"), '{"language":"zh-CN"}');
  await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1,
    projects: { alpha: { root }, beta: { root: join(home, "projects", "beta") } }, workspaces: {} }));
  const config: MemsphereConfig = { configPath: join(root, "config.json"), scopeRoot: root, homeRoot: home, language: "zh-CN",
    memoryRoot: join(root, "memory"), runsRoot: join(root, "runs"), archiveRoot: join(root, "archives"),
    debug: { agentReview: false, root: join(home, ".runtime") }, view: { host: "127.0.0.1", port: 0 }, project: { name: "alpha", mounted: [] } };
  await prepare?.(config);
  const server = createViewServer(config, { settingsToken: config.view.operatorToken });
  // Closing client sockets does not await async HTTP handlers. Drain those
  // handlers before deleting their Store, including requests aborted by navigation.
  const requests = new Set<Promise<unknown>>();
  const handler = server.listeners("request")[0];
  server.removeListener("request", handler);
  server.on("request", (request, response) => {
    const task = Promise.resolve(handler.call(server, request, response));
    requests.add(task);
    void task.then(() => requests.delete(task), () => requests.delete(task));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { home, root, source, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await Promise.all(requests);
      await rm(home, { recursive: true, force: true, maxRetries: 3 });
    } };
}
