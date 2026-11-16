import { settingsFieldSchema } from "./app-settings-schema.js";
import { appSettingsText } from "./app-settings-copy.js";
import type { ViewUi, TextRef } from "./view-sdk.js";
import type { AppSettingsPresentationContext, AppSettingsSnapshot, SettingsFieldDescriptor, SettingsFormDescriptor, SettingsPath } from "./app-settings-contracts.js";
import { settingsValue } from "./app-settings-controller.js";
const forms = new WeakMap<HTMLElement, AppSettingsPresentationContext>();
export const isSettingsForm = (root: HTMLElement, context: AppSettingsPresentationContext) => forms.get(root) === context;
const text = (value: TextRef | undefined) => !value ? "" : "text" in value ? value.text : value.key;
const allowed = new Set(["kind", "path", "key", "label", "description", "required", "options", "visible", "disabled"]);
export function createSettingsForm(ui: ViewUi, descriptor: SettingsFormDescriptor, locale = "zh-CN"): HTMLElement {
    if (!descriptor || Object.keys(descriptor).some(k => !["context", "sections"].includes(k)) || !Array.isArray(descriptor.sections))
        throw Error("Invalid settings form descriptor");
    const context = descriptor.context;
    const root = document.createElement("div");
    root.className = "mem-view-settings-form";
    forms.set(root, context);
    const style = document.createElement("style");
    style.textContent = settingsFormStyles;
    root.append(style);
    const updates: Array<(s: Readonly<AppSettingsSnapshot>) => void> = [];
    for (const section of descriptor.sections) {
        if (Object.keys(section).some(k => !["id", "title", "description", "fields"].includes(k)))
            throw Error("Unsupported settings section property");
        const panel = document.createElement("section");
        panel.className = "mem-settings-section";
        const title = document.createElement("h3");
        title.textContent = text(section.title);
        const heading = document.createElement("header");
        heading.className = "mem-settings-section-heading";
        heading.append(title);
        panel.append(heading);
        if (section.description) {
            const p = document.createElement("p");
            p.className = "mem-settings-description";
            p.textContent = text(section.description);
            heading.append(p);
        }
        const grid = document.createElement("div");
        grid.className = "mem-settings-fields";
        panel.append(grid);
        root.append(panel);
        for (const field of section.fields) {
            if (Object.keys(field).some(k => !allowed.has(k)) || !["text", "number", "integer", "boolean", "select", "json", "projectStore"].includes(field.kind))
                throw Error("Unsupported settings field descriptor");
            let path: SettingsPath = field.path ?? [];
            if (field.kind !== "projectStore" && !field.path)
                throw Error("Configuration field path is required");
            let choices: Array<{
                value: unknown;
                label: TextRef;
            }> = Array.isArray(field.options) ? [...field.options] : [];
            let optionGeneration = 0, optionRequest: AbortController | undefined, optionDraft = "";
            let choiceReady = field.kind !== "projectStore";
            let localError = "";
            const edit = (action: () => void) => { try {
                action();
                localError = "";
            }
            catch (e) {
                localError = e instanceof Error ? e.message : String(e);
            } update(context.getState()); };
            const change = (value: string | boolean) => edit(() => {
                if (field.kind === "boolean")
                    context.setValue(path, value);
                else if (field.kind === "json" || field.kind === "number" || field.kind === "integer")
                    context.setText(path, String(value), field.kind);
                else if (field.kind === "select" || field.kind === "projectStore") {
                    if(value === "") return;
                    const choice = choices[Number(value)];
                    if (choice)
                        context.setValue(path, choice.value);
                }
                else
                    context.setValue(path, value);
            });
            const schema = context.getState().schema;
            let node: any, required = false, schemaReadOnly = false;
            const resolveConstraints = () => {
                const constraints = settingsFieldSchema(schema, path);
                node = constraints.node;
                schemaReadOnly = constraints.readOnly;
                required = Boolean(field.required || constraints.required);
            };
            resolveConstraints();
            const permitted = (values: typeof choices) => Array.isArray(node?.enum) ? values.filter(c => node.enum.some((v: unknown) => JSON.stringify(v) === JSON.stringify(c.value))) : values;
            choices = permitted(choices);
            const base = { label: field.label, description: field.description, required, disabled: !context.canWrite };
            const control = field.kind === "boolean" ? ui.checkboxField({ ...base, checked: false, onChange: change })
                : field.kind === "select" || field.kind === "projectStore" ? ui.select({ ...base, value: "", options: [], onChange: change })
                    : field.kind === "json" ? ui.textareaField({ ...base, value: "", onInput: change })
                        : ui.textField({ ...base, value: "", onInput: change });
            const row = document.createElement("div");
            row.className = "mem-settings-field";
            const storeMetadata=document.createElement("p");storeMetadata.className="mem-settings-store-meta";storeMetadata.hidden=field.kind!=="projectStore";
            row.append(control.root, storeMetadata);
            grid.append(row);
            const update = (s: Readonly<AppSettingsSnapshot>) => {
                if (context.signal.aborted)
                    return;
                if (typeof field.options === "function" && JSON.stringify(s.draft) !== optionDraft) {
                    optionDraft = JSON.stringify(s.draft);
                    const generation = ++optionGeneration;
                    optionRequest?.abort();
                    const request = optionRequest = new AbortController();
                    choiceReady = false;
                    const abort = () => request.abort();
                    context.signal.addEventListener("abort", abort, { once: true });
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    const cancelled = new Promise<never>((_, reject) => {
                        request.signal.addEventListener("abort", () => reject(new Error("Options request cancelled")), { once: true });
                        timer = setTimeout(() => request.abort(), 15000);
                    });
                    void Promise.race([Promise.resolve().then(() => (field.options as Function)(s, { signal: request.signal })), cancelled]).then(values => {
                        if (context.signal.aborted || request.signal.aborted || generation !== optionGeneration)
                            return;
                        if (!Array.isArray(values))
                            throw Error("Options provider must return an array");
                        choices = permitted(values);
                        choiceReady = true;
                        localError = "";
                        update(context.getState());
                    }).catch(e => { if (!context.signal.aborted && generation === optionGeneration) {
                        localError = String(e);
                        update(context.getState());
                    } })
                        .finally(() => { clearTimeout(timer); context.signal.removeEventListener("abort", abort); });
                }
                row.hidden = field.visible ? !field.visible(s) : false;
                const disabled = !context.canWrite || schemaReadOnly || s.busy || !choiceReady || field.kind==="projectStore"&&choices.length===0 || Boolean(field.disabled?.(s));
                const value = settingsValue(s.draft, path);
                const buffer = s.textBuffers.find(b => JSON.stringify(b.path) === JSON.stringify(path));
                const error = localError || buffer?.error || s.issues.find(i => JSON.stringify(i.path) === JSON.stringify(path))?.message;
                const shared = { ...base, required, disabled, error: error ? { text: error } : undefined };
                if (field.kind === "boolean")
                    (control as ReturnType<ViewUi["checkboxField"]>).update({ ...shared, checked: value === true, onChange: change });
                else if (field.kind === "select" || field.kind === "projectStore") {
                    let index = choices.findIndex(c => JSON.stringify(c.value) === JSON.stringify(value));
                    const opts = choices.map((c, i) => ({ value: String(i), label: c.label }));
                    if (index < 0 && value !== undefined && value !== null) {
                        index = opts.length;
                        opts.push({ value: String(index), label: { text: appSettingsText(locale, "unavailable", { value: String(value) }) } });
                    }
                    (control as ReturnType<ViewUi["select"]>).update({ ...shared, value: index < 0 ? "" : String(index), options: opts, onChange: change, placeholder: { text: appSettingsText(locale, "choose") } });
                }
                else {
                    const v = buffer?.text ?? (field.kind === "json" ? JSON.stringify(value, null, 2) ?? "" : value === undefined ? "" : String(value));
                    (control as ReturnType<ViewUi["textField"]>).update({ ...shared, value: v, onInput: change });
                }
            };
            updates.push(update);
            update(context.getState());
            if (field.kind === "projectStore") {
                void context.getStoreChoices(field.key ?? "").then(result => {
                    if (context.signal.aborted)
                        return;
                    if (!("configKey" in result) || typeof result.configKey !== "string")
                        throw Error("Undeclared Store requirement");
                    path = [result.configKey];
                    resolveConstraints();
                    choices = permitted(result.candidates.map(v => ({ value: v, label: { text: v } })));
                    choiceReady = true;
                    storeMetadata.textContent = appSettingsText(locale, "storeMetadata", { key: result.key, model: result.model, kind: result.kind });
                    localError = [result.diagnostic, result.candidates.length?undefined:appSettingsText(locale,"noStores")].filter(Boolean).join("；");
                    update(context.getState());
                }).catch(e => { if (!context.signal.aborted) {
                    localError = String(e);
                    update(context.getState());
                } });
            }
        }
    }
    const unsubscribe = context.subscribe(s => updates.forEach(update => update(s)));
    context.signal.addEventListener("abort", () => { void unsubscribe(); }, { once: true });
    return root;
}
export const settingsFormStyles = `
.mem-view-settings-form{display:grid;gap:20px;color:var(--mem-view-color-text);font:var(--mem-view-font-size-base,14px)/1.5 var(--mem-view-font-sans,system-ui)}
.mem-view-settings-form *{box-sizing:border-box}
.mem-view-settings-form .mem-settings-section{display:grid;gap:24px;min-width:0;border:1px solid var(--mem-view-color-border);background:var(--mem-view-color-surface);border-radius:var(--mem-view-radius-lg,12px);padding:24px}
.mem-view-settings-form .mem-settings-section-heading{display:grid;gap:6px;min-width:0}
.mem-view-settings-form .mem-settings-section-heading h3{margin:0;font-size:16px;font-weight:600;line-height:1.5}
.mem-view-settings-form .mem-settings-description{margin:0;color:var(--mem-view-color-text-muted);font-size:13px;font-weight:400;line-height:1.6}
.mem-settings-fields{display:grid;gap:20px;min-width:0}
.mem-settings-field{min-width:0}
.mem-settings-field[hidden]{display:none}
.mem-view-settings-form .mem-view-field{gap:8px;min-width:0;font-size:14px;font-weight:600;line-height:1.5}
.mem-view-settings-form .mem-view-field>small{min-height:0;font-size:12px;font-weight:400;line-height:1.5;color:var(--mem-view-color-text-muted);overflow-wrap:anywhere}
.mem-view-settings-form .mem-view-field>small:empty{display:none}
.mem-view-settings-form .mem-view-field[data-invalid="true"]>small{color:var(--mem-view-color-danger)}
.mem-view-settings-form .mem-view-field-checkbox{align-items:start}
.mem-view-settings-form .mem-view-field-checkbox .mem-view-field-control{padding-top:2px}
.mem-view-settings-form .mem-settings-store-meta{margin:8px 0 0;color:var(--mem-view-color-text-muted);font-size:12px;font-weight:400;line-height:1.5;overflow-wrap:anywhere}
.mem-settings-store-meta[hidden]{display:none}
@media(max-width:640px){.mem-view-settings-form .mem-settings-section{padding:16px;gap:20px}}
`;
