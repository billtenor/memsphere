import { resolve } from "node:path";
import { Config, DefaultDataManager, DefaultDataExtensionRegistry } from "memsphere/data";
import { filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, jsonSerializerExtension, JSON_SCHEMA_DRAFT_07 } from "memsphere/data/extensions";
import definition from "../models/expense.json" with { type: "json" };
import { expenses } from "../backend/business.mjs";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version")) { console.log("0.1.0"); return; }
  if (args.includes("--help")) { console.log("expense --ledger <absolute-directory> list [--cursor <cursor>]\nexpense --ledger <absolute-directory> create --description <text> --amount <number>\nexpense --ledger <absolute-directory> submit --id <id> --revision <integer>\nResults: JSON stdout. Errors: stderr and nonzero exit. No interactive prompts."); return; }
  const options = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (!["ledger", "cursor", "description", "amount", "id", "revision"].includes(key) || args[i + 1] === undefined || Object.hasOwn(options, key)) throw new Error(`Invalid argument: ${args[i]}`);
      options[key] = args[++i];
    } else positional.push(args[i]);
  }
  if (!options.ledger || positional.length !== 1) throw new Error("Provide --ledger and one operation; see --help");
  const model = { data: { id: "example/expense.json", model: JSON_SCHEMA_DRAFT_07, payload: { contentType: "application/json", content: { stream: () => new ReadableStream({ start(c) { c.enqueue(Buffer.from(JSON.stringify(definition))); c.close(); } }) } } }, definition };
  const manager = new DefaultDataManager({ extensions: new DefaultDataExtensionRegistry([filesystemJsonValueStoreExtension, jsonSchemaExtension, jsonSchemaMetaModelExtension, jsonSerializerExtension]),
    models: [{ model }], stores: [{ id: "ledger", model: "example/expense.json", kind: "ValueStore", factory: "memsphere/filesystem-json", config: new Config({ directory: resolve(options.ledger) }) }] });
  const input = { ...options, ...(options.amount !== undefined ? { amount: Number(options.amount) } : {}), ...(options.revision !== undefined ? { revision: Number(options.revision) } : {}) };
  console.log(JSON.stringify(await expenses(await manager.getStore({}, "ledger"), positional[0], input)));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
