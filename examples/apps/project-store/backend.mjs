export default {
  operations: {
    read: {
      kind: "read",
      async execute(ctx, { id }) {
        const binding = await ctx.getProjectStoreBinding("expenses");
        const store = await ctx.getStore("expenses", { expectedBinding: binding.token });
        return { record: await store.get(ctx, id), token: binding.token, storeId: binding.storeId };
      }
    },
    save: {
      kind: "write",
      async execute(ctx, { id, value, token }) {
        const store = await ctx.getStore("expenses", { expectedBinding: token });
        return store.update(ctx, id, value);
      }
    },
    remove: {
      kind: "write",
      async execute(ctx, { id, token }) {
        const store = await ctx.getStore("expenses", { expectedBinding: token });
        return store.delete(ctx, id);
      }
    }
  }
};
