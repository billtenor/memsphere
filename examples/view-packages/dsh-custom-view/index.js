import { defineViewPlugin, portableSlots } from "@memsphere/view-sdk";

const text = (tag, value, className = "") => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
};

const page = (kind, apiPath) => ({
  async mount({ element }, context) {
    element.dataset.customShowcase = kind;
    const card = text("section", "", "example-custom-page");
    card.append(text("small", "Community View Package"), text("h2", kind === "memory" ? "My Memory workspace" : "My Run workspace"));
    const status = text("p", "Loading current Project data…");
    card.append(status);
    element.append(card);
    try {
      const response = await fetch(apiPath);
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      const records = payload.memories ?? payload.runs ?? [];
      status.textContent = `${records.length} records · stable route ${context.route.pathname}`;
    } catch (error) {
      status.textContent = `Data remains available through the official API (${String(error)})`;
    }
  }
});

export default defineViewPlugin({
  name: "community-custom-view-showcase",
  apiVersion: 1,
  inject: ["slots"],
  apply(context) {
    context.slots.register(portableSlots.memoryPagePresentation, {
      id: "memory-page", key: "page", priority: 100,
      value: page("memory", "/api/memories?representation=summary")
    });
    context.slots.register(portableSlots.memoryDetailRenderer, {
      id: "memory-detail", key: "detail", priority: 100,
      value: { render(input) {
        const value = input;
        const card = text("article", "", "example-custom-renderer");
        card.dataset.customMemoryRenderer = String(value.kind ?? "memory");
        card.append(text("h3", `Custom ${String(value.kind ?? "Memory")} renderer`));
        card.append(text("pre", JSON.stringify(value.entity ?? {}, null, 2)));
        return card;
      } }
    });
    context.slots.register(portableSlots.runPagePresentation, {
      id: "run-page", key: "page", priority: 100,
      value: page("run", "/api/runs?representation=summary&status=running")
    });
    context.slots.register(portableSlots.runArtifactRenderer, {
      id: "run-artifact", key: "artifact", priority: 100,
      value: { render(input) {
        const value = input;
        const card = text("div", "", "example-custom-renderer");
        card.dataset.customArtifactRenderer = String(value.artifact?.type ?? "artifact");
        card.append(text("strong", "Custom Artifact renderer"));
        card.append(text("pre", JSON.stringify(value.artifact ?? {}, null, 2)));
        return card;
      } }
    });
  }
});
