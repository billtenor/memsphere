#!/usr/bin/env node
import { createConnection } from "node:net";

if (process.argv.includes("--version")) {
  console.log("0.0.0-test");
  process.exit(0);
}

const args = process.argv.slice(2);
const operation = bridgeOperation(args);
const assignmentId = option("--assignment");
const request = {
  protocolVersion: 1,
  capability: requiredEnv("MEMSPHERE_REVIEW_CAPABILITY"),
  assignmentId,
  operation,
  handshake: {
    configPath: requiredEnv("MEMSPHERE_CONFIG_PATH"),
    workspaceRoot: requiredEnv("MEMSPHERE_WORKSPACE_ROOT")
  },
  body: option("--body", false),
  vote: option("--vote", false),
  summary: option("--summary", false)
};

const response = await send(requiredEnv("MEMSPHERE_REVIEW_ENDPOINT"), request);
if (!response.ok) {
  console.error(response.error);
  process.exit(1);
}
console.log(JSON.stringify(response.value));

function bridgeOperation(values) {
  if (values[0] === "run" && values[1] === "artifact" && values[2] === "show") return "artifact_show";
  if (values[0] === "run" && values[1] === "artifact" && values[2] === "contract" && values[3] === "show") {
    return "artifact_contract_show";
  }
  if (values[0] === "run" && values[1] === "review" && values[2] === "assignment" && values[3] === "show") {
    return "assignment_show";
  }
  if (values[0] === "run" && values[1] === "review" && ["comment", "submit"].includes(values[2])) {
    return values[2];
  }
  throw new Error("unsupported fake Review CLI command");
}

function option(name, required = true) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function send(endpoint, value) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let raw = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(value)}\n`));
    socket.on("data", chunk => { raw += chunk; });
    socket.once("end", () => resolve(JSON.parse(raw.trim())));
    socket.once("error", reject);
  });
}
