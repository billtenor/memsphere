import { expenses } from "./business.mjs";
export default {
  operations: Object.fromEntries(["list", "create", "submit"].map(name => [name, {
    kind: name === "list" ? "read" : "write",
    async execute(context, input) { return expenses(await context.getStore("ledger"), name, input); }
  }]))
};
