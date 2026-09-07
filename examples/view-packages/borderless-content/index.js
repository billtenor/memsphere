import { componentSlots, defineViewPlugin } from "@memsphere/view-sdk";

export default defineViewPlugin({
  name: "borderless-content",
  apiVersion: 1,
  inject: ["slots"],
  apply(ctx) {
    for (const kind of ["document", "flow", "disclosure"]) {
      ctx.slots.register(componentSlots[kind], {
        id: kind, key: "default", priority: 100,
        value: { render(input) {
          const root = input.defaultRender();
          root.dataset.borderlessComponent = kind;
          if (kind === "document") {
            root.style.border = "0";
            root.style.boxShadow = "none";
          } else if (kind === "flow") {
            root.style.gap = "6px";
          } else {
            root.style.border = "0";
            root.style.background = "transparent";
            root.style.boxShadow = "none";
          }
          return root;
        } }
      });
    }
  }
});
