import { parseArgs } from "node:util";
import spawn from "cross-spawn";
import { z } from "zod";
import { resolveProjectContext } from "../../../../src/project/resolver.js";
import { showCli } from "../../../../src/tools/registry.js";

const usage = "expense-project list [--cursor CURSOR]\nexpense-project create --description TEXT --amount NUMBER\nexpense-project submit --id ID --revision REVISION";
const operations = { list: ["cursor"], create: ["description", "amount"], submit: ["id", "revision"] };
const record = z.object({
  id: z.string(), revision: z.string(), value: z.object({
    amount: z.number(), description: z.string(), status: z.enum(["draft", "submitted"])
  })
});
const page = z.object({ records: z.array(record), nextCursor: z.string().optional() });

async function main([operation, ...args]) {
  if (operation === "--help" && !args.length) return console.log(usage);
  if (!Object.hasOwn(operations, operation)) throw new Error();
  const keys = operations[operation];
  const { values, tokens } = parseArgs({ args, options: Object.fromEntries(keys.map(key => [key, { type: "string" }])), tokens: true });
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option" || seen.has(token.name) || !values[token.name] || values[token.name].startsWith("--")) throw new Error();
    seen.add(token.name);
  }
  if (operation !== "list" && seen.size !== keys.length) throw new Error();
  if (process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID) throw new Error();
  const { primary } = await resolveProjectContext({ cwd: process.cwd() });
  if (process.env.MEMSPHERE_PROJECT && process.env.MEMSPHERE_PROJECT !== primary.name) throw new Error();
  const { invocation } = await showCli(primary, "org.memsphere.expense-cli", "org.memsphere.expense");
  if (!invocation) throw new Error();

  const env = { ...process.env, ...invocation.env };
  for (const [name, source] of Object.entries(invocation.envFrom ?? {})) {
    if (process.env[source] === undefined) throw new Error();
    env[name] = process.env[source];
  }
  const publicArgs = keys.flatMap(key => seen.has(key) ? ["--" + key, values[key]] : []);
  const result = spawn.sync(invocation.executable, [...invocation.args, operation, ...publicArgs], {
    cwd: invocation.cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error();
  const receipt = (operation === "list" ? page : record).parse(JSON.parse(result.stdout));
  console.log(JSON.stringify(receipt));
}

main(process.argv.slice(2)).catch(() => {
  console.error("Expense request failed. Check the workspace binding, public arguments and current record revision.");
  process.exitCode = 1;
});
