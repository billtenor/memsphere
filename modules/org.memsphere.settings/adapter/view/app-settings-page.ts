import { appSettingsText } from "../../../../src/view/app-settings-copy.js";
import { portableSlots, type ViewUi, type SlotRegistry, type SettingsFieldDescriptor, type AppSettingsPresentationContext, type AppSettingsStoreChoices } from "@memsphere/view-sdk";
import { AppSettingsController } from "../../../../src/view/app-settings-controller.js";
type RecordValue = Record<string, any>;
export class AppSettingsPage {
    readonly #surface = document.createElement("div");
    #controller?: AppSettingsController;
    #epoch = 0;
    #id: string | undefined;
    #request?: AbortController;
    #disposed = false;
    #mode: "custom" | "generic" | "json" = "custom";
    constructor(readonly projectId: string, readonly ui: ViewUi, readonly slots: SlotRegistry, readonly request: (url: string, init?: RequestInit) => Promise<Response>, readonly navigate: (id?: string) => Promise<void>, readonly locale = "zh-CN") { this.#surface.className = "app-settings-page"; }
    #t(key: Parameters<typeof appSettingsText>[1], params?: Record<string, string>) { return appSettingsText(this.locale, key, params); }
    mount(root: HTMLElement, id: string | undefined) { root.replaceChildren(this.#surface); if (this.#id !== id || !this.#surface.childNodes.length) {
        if(this.#id !== id)this.#mode="custom";
        this.#id = id;
        void this.#load(id);
    } }
    get dirty() { return this.#controller?.getState().dirty ?? false; }
    get busy() { return this.#controller?.getState().busy ?? false; }
    async beforeLeave() { return !this.dirty || await this.ui.confirm({ title: { text: this.#t("unsavedTitle") }, description: { text: this.busy ? this.#t("leaveBusy") : this.#t("leave") }, confirmLabel: { text: this.#t("discard") }, cancelLabel: { text: this.#t("keepEditing") }, tone: "danger" }); }
    dispose() { this.#disposed = true; this.#epoch++; this.#request?.abort(); this.#controller?.dispose(); this.#surface.replaceChildren(); }
    async #json(url: string, init: RequestInit = {}) {
        const response = await this.request(url, init);
        const result = await response.json();
        if (!response.ok)
            throw Object.assign(new Error(result.error ?? `HTTP ${response.status}`), { code: result.code,
                issues:Array.isArray(result.details)?result.details.map((item:RecordValue)=>({
                    path:[...(item.instancePath?String(item.instancePath).slice(1).split("/").map((p:string)=>p.replace(/~1/g,"/").replace(/~0/g,"~")):[]),...(item.params?.missingProperty?[item.params.missingProperty]:[])],
                    message:String(item.message??result.error)
                })):undefined
            });
        return result;
    }
    async #load(id?: string,mode=this.#mode) {
        this.#mode=mode;
        const epoch = ++this.#epoch;
        this.#request?.abort();
        this.#controller?.dispose();
        this.#controller = undefined;
        const abort = this.#request = new AbortController();
        this.#surface.replaceChildren(this.ui.feedback({ state: "loading", title: { text: this.#t("loading") } }));
        try {
            const result = await this.#json(id ? `/api/settings/apps/${encodeURIComponent(id)}` : "/api/settings/apps", { signal: abort.signal });
            if (this.#disposed || epoch !== this.#epoch)
                return;
            if (!id) {
                this.#list(result.apps);
                return;
            }
            const detail = result as RecordValue;
            const controller = this.#controller = new AppSettingsController(this.projectId, { id, name: detail.name }, detail.canWrite, { config: detail.config, revision: detail.revision }, (action, body, signal) => this.#json(`/api/settings/apps/${encodeURIComponent(id)}${action === "validate" ? "/validate" : ""}`, { method: action === "validate" ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }), async (key,signal) => {
                const latest = await this.#json(`/api/settings/apps/${encodeURIComponent(id)}`, { signal: signal??controller.signal }) as { projectStores: AppSettingsStoreChoices[] };
                const requirement = latest.projectStores.find((r) => r.key === key);
                if (!requirement)
                    throw Error("Undeclared Project Store key");
                return requirement;
            }, undefined, detail.schema, this.locale);
            this.#detail(detail, controller);
        }
        catch (e) {
            if (!abort.signal.aborted && epoch === this.#epoch) {
                this.#surface.replaceChildren(this.ui.feedback({ state: "error", title: { text: e instanceof Error ? e.message : String(e) } }), this.ui.button({ label: { text: this.#t("reload") }, run: () => this.#load(id) }));
            }
        }
    }
    #list(apps: RecordValue[]) {
        const heading = document.createElement("h2");
        heading.textContent = this.#t("apps");
        const help = document.createElement("p");
        help.textContent = this.#t("projectHelp", { project: this.projectId });
        this.#surface.replaceChildren(heading, help);
        if (!apps.length) {
            const p = document.createElement("p");
            p.textContent = this.#t("empty");
            this.#surface.append(p);
            return;
        }
        const noMatches = document.createElement("div");
        noMatches.hidden = true;
        noMatches.setAttribute("role", "status");
        const message = document.createElement("p");
        message.textContent = this.#t("noMatches");
        const filter = (value: string) => {
            let visible = 0;
            for (const row of Array.from(this.#surface.querySelectorAll<HTMLElement>("[data-app-id]"))) {
                row.hidden = !row.textContent?.toLowerCase().includes(value.toLowerCase());
                if (!row.hidden) visible++;
            }
            noMatches.hidden = visible > 0;
        };
        const search = this.ui.searchField({ label: { text: this.#t("search") }, value: "", onInput: filter });
        noMatches.append(message, this.ui.button({ label: { text: this.#t("clearSearch") }, run: () => {
            search.control.value = "";
            filter("");
        } }));
        this.#surface.append(search.root);
        for (const app of apps) {
            const row = document.createElement("section");
            row.className = "app-settings-item";
            row.dataset.appId = app.id;
            const name = document.createElement("h3");
            name.textContent = app.name;
            const meta = document.createElement("p");
            meta.textContent = `${app.id} · v${app.version} · ${app.enabled ? this.#t("enabled") : this.#t("disabled")}`;
            const description = document.createElement("p");
            description.textContent = app.description;
            row.append(name, meta, description, this.ui.button({ label: { text: this.#t("configure") }, run: () => this.navigate(app.id) }));
            this.#surface.append(row);
        }
        this.#surface.append(noMatches);
    }
    #detail(detail: RecordValue, controller: AppSettingsController) {
        const header = document.createElement("header");
        const title = document.createElement("h2");
        title.textContent = detail.name;
        const identity = document.createElement("dl");
        identity.className = "app-settings-identity";
        for (const [label, value] of [
            [this.#t("projectLabel"), this.projectId], [this.#t("appIdLabel"), detail.id],
            [this.#t("versionLabel"), detail.version], [this.#t("statusLabel"), detail.enabled ? this.#t("enabled") : this.#t("disabledHelp")]
        ]) {
            const item = document.createElement("div"), term = document.createElement("dt"), description = document.createElement("dd");
            term.textContent = label;
            description.textContent = value;
            item.append(term, description);
            identity.append(item);
        }
        header.append(this.ui.button({ label: { text: this.#t("allApps") }, run: () => this.navigate() }), title, identity);
        const feedback = document.createElement("div"), body = document.createElement("div"), actions = document.createElement("div");
        body.className = "app-settings-body";
        let pendingRestart = detail.runtime?.state === "pending-restart";
        actions.className = "app-settings-actions";
        const save = this.ui.button({ label: { text: this.#t("save") }, run: () => this.#action(async () => {
            const result = await controller.save() as { restartRequired?: boolean };
            if (result.restartRequired) pendingRestart = true;
            update();
        }, feedback) }, { tone: "primary" });
        const validate = this.ui.button({ label: { text: this.#t("validate") }, run: () => this.#action(() => controller.validate(), feedback) });
        const cancel = this.ui.button({ label: { text: this.#t("reset") }, run: () => this.#action(() => controller.reset(), feedback) });
        const reload = this.ui.button({ label: { text: this.#t("reload") }, run: async () => { if (await this.beforeLeave())
                await this.#load(detail.id); } });
        actions.append(reload, cancel, validate, save);
        const state = document.createElement("p");
        state.className = "app-settings-save-state";
        state.setAttribute("role", "status");
        this.#surface.replaceChildren(header, feedback, body, state, actions);
        const switchMode=async (mode: "generic" | "json")=>{
            if(controller.getState().busy)return;
            if(await this.beforeLeave())await this.#load(detail.id,mode);
        };
        const generic = () => {
            body.replaceChildren();
            const fields: SettingsFieldDescriptor[] = [];
            const stores = new Set<string>(detail.projectStores.map((r: RecordValue) => r.configKey));
            const properties = detail.schema?.properties ?? {};
            const names = new Set([...Object.keys(properties), ...Object.keys(detail.config)]);
            for (const name of names) {
                if (stores.has(name))
                    continue;
                const schema = properties[name] ?? {};
                const v = detail.config[name];
                const kind = schema.enum ? "select" : schema.type === "boolean" || typeof v === "boolean" ? "boolean" : schema.type === "integer" ? "integer" : schema.type === "number" || typeof v === "number" ? "number" : schema.type === "object" || schema.type === "array" || v && typeof v === "object" ? "json" : "text";
                fields.push({ kind, path: [name], label: { text: schema.title ?? name }, description: schema.description ? { text: schema.description } : undefined, required: detail.schema?.required?.includes(name), ...(schema.enum ? { options: schema.enum.map((value: unknown) => ({ value, label: { text: String(value) } })) } : {}) });
            }
            for (const r of detail.projectStores)
                fields.push({ kind: "projectStore", key: r.key, label: { text: r.key }, required: true });
            // In a simple closed object, every named property being readOnly
            // leaves no editable configuration. Open/complex schemas keep JSON.
            const closedSchema = detail.schema?.type === "object" && detail.schema.additionalProperties === false
                && !Object.keys(detail.schema.patternProperties ?? {}).length
                && !["$ref", "allOf", "anyOf", "oneOf", "if"].some(key => key in detail.schema);
            const allFieldsReadOnly = closedSchema && [...names].every(name => properties[name]?.readOnly === true)
                && detail.projectStores.every((r: RecordValue) => properties[r.configKey]?.readOnly === true);
            if (detail.schema?.readOnly === true || allFieldsReadOnly || (!fields.length && !Object.keys(detail.config).length && !detail.schema)) {
                const p = document.createElement("p");
                p.textContent = this.#t("noFields");
                body.append(p);
                if (Object.keys(detail.config).length) {
                    const heading = document.createElement("h3");
                    heading.textContent = this.#t("readOnlyValues");
                    const values = document.createElement("pre");
                    values.className = "app-settings-readonly";
                    values.textContent = JSON.stringify(detail.config, null, 2);
                    body.append(heading, values);
                }
                return;
            }
            if(this.#mode==="json")fields.length=0;
            if (!fields.length)
                fields.push({ kind: "json", path: [], label: { text: this.#t("json") } });
            body.append(this.ui.settingsForm({ context: controller, sections: [{ id: "configuration", title: { text: this.#t("configure") }, fields }] }));
            body.append(this.ui.button({label:{text:this.#t(this.#mode==="json"?"formMode":"jsonMode")},run:()=>switchMode(this.#mode==="json"?"generic":"json")}));
        };
        if (detail.customSettings && this.#mode==="custom") {
            try {
                const content = this.slots.render(portableSlots.appSettingsConfiguration, detail.id, controller);
                body.append(content);
            }
            catch (e) {
                feedback.append(this.ui.feedback({ state: "error", title: { text: this.#t("extensionFailed", { error: String(e) }) } }), this.ui.button({ label: { text: this.#t("generic") }, run: ()=>switchMode("generic") }));
            }
        }
        else
            generic();
        const update = () => {
            const s = controller.getState();
            state.textContent = `${s.dirty ? this.#t("dirty") : this.#t("clean")}${s.busy ? ` · ${this.#t("busy")}` : ""}${s.notice ? ` · ${s.notice}` : ""} · ${pendingRestart ? this.#t("pendingRestart") : this.#t("unknown")}`;
            save.disabled = s.busy || !s.dirty || s.textBuffers.some(b => b.error) || !controller.canWrite;
            cancel.disabled = s.busy || !s.dirty;
            validate.disabled = s.busy || s.textBuffers.some(b => b.error) || !controller.canWrite;
            reload.disabled = s.busy;
            const old = feedback.querySelector("[data-request-errors]");
            old?.remove();
            const messages=[...s.issues.map(i=>i.message),...s.textBuffers.filter(b=>b.error).map(b=>`${b.path.join(".")||"$"}: ${b.error}`)];
            if (messages.length) {
                const area = document.createElement("div");
                area.dataset.requestErrors = "true";
                area.append(this.ui.feedback({ state: "error", title: { text: messages.join("；") } }));
                feedback.append(area);
            }
        };
        controller.subscribe(update);
        update();
    }
    async #action(action: () => unknown, feedback: HTMLElement) { try {
        await action();
    }
    catch (e) {
        // Request failures already belong to the controller's current issues.
        // Only synchronous precondition errors need a transient host message.
        if (!feedback.querySelector("[data-request-errors]")) {
            const area = document.createElement("div");
            area.dataset.requestErrors = "true";
            area.append(this.ui.feedback({ state: "error", title: { text: e instanceof Error ? e.message : String(e) } }));
            feedback.append(area);
        }
    } }
}
