import { defineViewPlugin, portableSlots } from "@memsphere/view-sdk";

const text = (tag, value, className = "") => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
};

const page = (kind, presentation) => ({
  async mount({ element }, context) {
    element.dataset.customShowcase = kind;
    const card = text("section", "", "example-custom-page");
    card.append(text("small", "Community View Package"), text("h2", kind === "memory" ? "My Memory workspace" : "My Run workspace"));
    const status = text("p", "Loading current Project data…");
    card.append(status);
    element.append(card);
    try {
      const payload = kind === "memory"
        ? await presentation.memoryPage()
        : await presentation.runPage({ status: "running" });
      const records = payload.items ?? payload.runs ?? [];
      status.textContent = `${records.length} records · stable route ${context.route.pathname}`;
    } catch (error) {
      status.textContent = `Data remains available through the official API (${String(error)})`;
    }
  }
});

export default defineViewPlugin({
  name: "community-custom-view-showcase",
  apiVersion: 1,
  inject: ["slots", "presentation"],
  apply(context) {
    if (!context.presentation) throw new Error("View Package requires the presentation service");
    context.slots.register(portableSlots.memoryPagePresentation, {
      id: "memory-page", key: "page", priority: 100,
      value: page("memory", context.presentation)
    });
    context.slots.register(portableSlots.memoryDetailRenderer, {
      id: "memory-detail", key: "detail", priority: 100,
      value: { render(input) {
        const value = input;
        const card = text("article", "", "example-custom-renderer");
        card.dataset.customMemoryRenderer = String(value.kind ?? "memory");
        card.append(text("h3", `Custom ${String(value.kind ?? "Memory")} renderer`));
        card.append(text("pre", JSON.stringify({ title: value.title, metadata: value.metadata, sections: value.sections }, null, 2)));
        return card;
      } }
    });
    context.slots.register(portableSlots.runPagePresentation, {
      id: "run-page", key: "page", priority: 100,
      value: page("run", context.presentation)
    });
    context.slots.register(portableSlots.runArtifactRenderer, {
      id: "run-artifact", key: "artifact", priority: 100,
      value: { render(input) {
        const value = input;
        const card = text("div", "", "example-custom-renderer");
        card.dataset.customArtifactRenderer = String(value.type ?? "artifact");
        card.append(text("strong", "Custom Artifact renderer"));
        card.append(text("pre", JSON.stringify({ title: value.title, content: value.content, metadata: value.metadata }, null, 2)));
        return card;
      } }
    });
  }
});
