import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureClaudeInbox, sendClaudeNotification } from "../../../src/runner/claude-notifications.js";

test("Claude notifications use the recorded same-user socket and send one newline-delimited message", {
  skip: process.platform !== "linux", timeout: 15000
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), "claude-inbox-"));
  const path = join(directory, `${process.pid}.sock`);
  const command = join(directory, "claude");
  const roster = join(directory, "roster.json");
  const sessionId = "4296f490-4c8f-4406-b859-cc9207e645ac";
  const session = { sessionId, pid: process.pid, startedAt: 1795350000000, kind: "interactive", status: "idle", cwd: directory };
  await writeFile(command, `#!${process.execPath}
if (process.argv[2] === "--version") console.log("2.1.330 (Claude Code)");
else {
  const content = require("node:fs").readFileSync(${JSON.stringify(roster)}, "utf8");
  if (content === "hang") setInterval(() => {}, 1000);
  else process.stdout.write(content);
}
`, { mode: 0o700 });
  await writeFile(roster, JSON.stringify([session]));

  let received = "";
  const server = createServer(socket => socket.on("data", chunk => { received += chunk.toString(); }));
  t.after(async () => {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  server.listen(path);
  await once(server, "listening", { signal: t.signal });
  const endpoint = { command, version: "2.1.330 (Claude Code)", cwd: directory, sessionId };
  const inbox = await captureClaudeInbox(endpoint, { CLAUDE_CODE_MESSAGING_SOCKET: path });
  const addressed = once(server, "connection", { signal: t.signal });
  const message = "[Memsphere 自动消息]\n请执行命令以继续：\nmemsphere run review wait";
  await sendClaudeNotification({ ...endpoint, inbox, message, signal: t.signal });
  const [socket] = await addressed;
  if (!socket.readableEnded) await once(socket, "end", { signal: t.signal });
  assert.deepEqual(JSON.parse(received), { type: "user", message: { role: "user", content: message } });
  assert.ok(received.endsWith("\n"));
  assert.equal(received.trimEnd().split("\n").length, 1);

  await writeFile(roster, "hang");
  await assert.rejects(sendClaudeNotification({ ...endpoint, inbox, message, signal: t.signal }), { code: "claude_send_not_written" });
  assert.equal(received.trimEnd().split("\n").length, 1);

  await writeFile(roster, JSON.stringify([{ ...session, sessionId: "different-session" }]));
  await assert.rejects(sendClaudeNotification({ ...endpoint, inbox, message, signal: t.signal }), { code: "claude_send_not_written" });

  await writeFile(roster, JSON.stringify([session, session]));
  await assert.rejects(captureClaudeInbox(endpoint, { CLAUDE_CODE_MESSAGING_SOCKET: path }), /Could not verify/);

  await new Promise<void>(resolve => server.close(() => resolve()));
  await symlink(roster, path);
  await writeFile(roster, JSON.stringify([session]));
  await assert.rejects(sendClaudeNotification({ ...endpoint, inbox, message, signal: t.signal }), { code: "claude_send_not_written" });
});
