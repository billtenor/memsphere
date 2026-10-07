import { defineViewPlugin, slots } from "@memsphere/view-sdk";

// Business pages consume the public SDK only. Data loading is separate from rendering.
export default defineViewPlugin({
  name: "model-definition-example", apiVersion: 1,
  inject: ["slots", "router", "ui", "presentation"], uiVersion: 1,
  apply(ctx) {
    const route = ctx.router.register({ id: "targets", path: "/targets", query: ["model", "mode", "locale"] });
    const text = (zh, en) => document.documentElement.lang === "en" ? en : zh;
    ctx.slots.register(slots.navigationPrimary, { id: "navigation", value: {
      label: { text: text("爬虫目标示例", "Crawler target example") },
      icon: { kind: "system", name: "stack" }, route: route.to({})
    } });
    ctx.slots.register(slots.mainView, { id: "targets", key: route.key, when: route.activation, value: {
      mount({ element }, context) {
        let active = true;
        element.dataset.modelDefinitionExample = "";
        const style = document.createElement("style");
        style.textContent = `[data-model-definition-example] { min-width:0; padding:var(--mem-view-space-5); }
          [data-model-definition-example] section { min-width:0; margin-bottom:var(--mem-view-space-5); }
          [data-model-definition-example] h2 { font:600 var(--mem-view-font-size-lg)/var(--mem-view-line-heading) var(--mem-view-font-sans); }`;
        const heading = document.createElement("h1");
        heading.textContent = text("爬虫目标示例", "Crawler target example");
        const definitions = document.createElement("div");
        definitions.dataset.exampleDefinitions = "";
        definitions.append(ctx.ui.feedback({ state: "loading", title: { text: text("读取模型", "Loading model") } }));
        const rules = document.createElement("section");
        rules.dataset.crawlRules = "";
        const title = document.createElement("h2");
        title.textContent = text("爬取规则", "Crawling rules");
        const copy = document.createElement("p");
        copy.textContent = text("示例规则：逐页读取目标列表。规则独立维护。", "Example rule: read the target list page by page. Rules are maintained separately.");
        rules.append(title, copy);
        element.append(style, heading, definitions, rules);
        const mode = context.route.query.mode;
        const locale = ["en", "zh-CN"].includes(context.route.query.locale) ? context.route.query.locale : undefined;
        const show = model => {
          if (!active) return;
          definitions.replaceChildren();
          for (const [id, view] of [["first", "structure"], ["second", "structure"], ["source", "source"]]) {
            const section = document.createElement("section");
            section.dataset.exampleInstance = id;
            section.append(ctx.ui.modelDefinition({ model, view, locale }));
            definitions.append(section);
          }
        };
        const fail = error => {
          if (active) definitions.replaceChildren(ctx.ui.feedback({ state: "error",
            title: { text: text("读取模型失败", "Could not read model") },
            description: { text: error instanceof Error ? error.message : String(error) } }));
        };
        if (["static", "raw", "unsupported", "invalid"].includes(mode)) {
          const definition = { type: "object", properties: {
            url: { type: "string", format: "uri", description: "Target URL" },
            options: { type: "object", properties: { limit: { type: "integer", minimum: 1 } }, required: ["limit"] }
          }, required: ["url"] };
          show(Object.freeze({ id: "example/target.json", builtin: false,
            metaModel: mode === "raw" ? "raw.json" : mode === "unsupported" ? "example/custom.json" : "json-schema/draft-07.json",
            definition: mode === "invalid" ? null : definition, source: JSON.stringify(definition, null, 2) }));
        } else {
          ctx.presentation.modelsPage().then(async page => {
            const id = context.route.query.model ?? page.models.find(model => model.status === "available" && !model.builtin)?.id;
            if (!id) throw new Error(text("没有可用模型", "No available model"));
            return page.getDefinition(id);
          }).then(show, fail);
        }
        return () => { active = false; delete element.dataset.modelDefinitionExample; element.replaceChildren(); };
      }
    } });
  }
});
