import test, { after } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";

let browser, stubborn;
const server = createServer((_request, response) => response.end("fixture"));
after(async () => {
  if (stubborn) {
    const exited = once(stubborn, "exit");
    stubborn.kill("SIGKILL");
    await exited;
  }
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await fetch(`${process.env.RUNNER_PROBE}/cleanup`, { method: "POST" });
});
test("controlled process tree", async () => {
  const { chromium } = await import(process.env.RUNNER_BROWSER_MODULE);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  browser = await chromium.launchServer({ headless: true });
  if (process.env.RUNNER_STUBBORN === "yes") {
    // A detached descendant that acknowledges readiness and refuses graceful
    // termination exercises the runner's bounded forceful cleanup path.
    stubborn = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});require("node:http").createServer(()=>{}).listen(0,"127.0.0.1",()=>process.send("ready"));'],
      { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore", "ipc"] });
    await once(stubborn, "message");
  }
  const response = await fetch(`${process.env.RUNNER_PROBE}/ready`, { method: "POST", body: JSON.stringify({ worker: process.pid,
    wrapper: process.ppid, browser: browser.process().pid, stubborn: stubborn?.pid, home: process.env.MEMSPHERE_HOME }) });
  if (await response.text() === "hold") await new Promise(() => {});
});
