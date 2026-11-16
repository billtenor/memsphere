import { appSettingsText } from "./app-settings-copy.js";
import type { AppSettingsPresentationContext, AppSettingsSnapshot, SettingsConfig, SettingsPath } from "./app-settings-contracts.js";
const clone = <T>(value: T): T => structuredClone(value);
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical)}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as SettingsConfig)[k])}`).join(",")}}` : JSON.stringify(v);
function assertJson(value: unknown, seen = new Set<object>()): void {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return;
    if (typeof value === "number" && Number.isFinite(value))
        return;
    if (typeof value !== "object" || seen.has(value as object) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
        throw new TypeError("Configuration values must be finite JSON values");
    seen.add(value);
    for (const child of Object.values(value))
        assertJson(child, seen);
    seen.delete(value);
}
const error = (code: string, message: string) => Object.assign(new Error(message), { code });
const key = (path: SettingsPath) => JSON.stringify(path);
const prefix = (a: SettingsPath, b: SettingsPath) => a.length <= b.length && a.every((s, i) => s === b[i]);
export function settingsValue(config: unknown, path: SettingsPath): unknown {
    let value = config;
    for (const part of path) {
        if (!value || typeof value !== "object" || !Object.hasOwn(value, part))
            return undefined;
        value = (value as SettingsConfig)[part];
    }
    return value;
}
export class AppSettingsController implements AppSettingsPresentationContext {
    readonly signal: AbortSignal;
    readonly #abort = new AbortController();
    #saved: SettingsConfig;
    #draft: SettingsConfig;
    #revision: string;
    #status: AppSettingsSnapshot["status"] = "editing";
    #issues: Array<{
        path: SettingsPath;
        message: string;
    }> = [];
    #notice = "";
    #buffers = new Map<string, {
        path: string[];
        text: string;
        original: string;
        error?: string;
    }>();
    #listeners = new Set<(state: Readonly<AppSettingsSnapshot>) => void>();
    #request = 0;
    constructor(readonly projectId: string, readonly app: Readonly<{
        id: string;
        name: string;
    }>, readonly canWrite: boolean, initial: {
        config: SettingsConfig;
        revision: string;
    }, readonly transport: (action: "validate" | "save", body: {
        config: SettingsConfig;
        expectedRevision: string;
    }, signal: AbortSignal) => Promise<any>, readonly choices: (key: string, signal?: AbortSignal) => Promise<{
        candidates: string[];
        diagnostic?: string;
        storeId?: unknown;
    }>, readonly deadlines = { validate: 15000, save: 30000 }, readonly schema?: Readonly<Record<string, unknown>>, readonly locale = "zh-CN") {
        this.#saved = clone(initial.config);
        this.#draft = clone(initial.config);
        this.#revision = initial.revision;
        this.signal = this.#abort.signal;
    }
    #t(key: Parameters<typeof appSettingsText>[1]) { return appSettingsText(this.locale, key); }
    getState(): Readonly<AppSettingsSnapshot> {
        const textBuffers = [...this.#buffers.values()].map(b => ({ path: [...b.path], text: b.text, modified: b.text !== b.original, ...(b.error ? { error: b.error } : {}) }));
        return clone({ schema: this.schema, saved: this.#saved, draft: this.#draft, revision: this.#revision, status: this.#status,
            busy: this.#status === "saving" || this.#status === "validating", dirty: canonical(this.#saved) !== canonical(this.#draft) || textBuffers.some(b => b.modified), issues: this.#issues, textBuffers, notice: this.#notice });
    }
    subscribe(listener: (state: Readonly<AppSettingsSnapshot>) => void) { this.#active(); this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
    #emit() { const state = this.getState(); for (const fn of this.#listeners)
        try {
            fn(clone(state));
        }
        catch { /* One observer cannot corrupt controller state. */ } }
    #active() { if (this.signal.aborted)
        throw error("APP_SETTINGS_CLOSED", "Settings context is no longer active"); }
    #editable() { this.#active(); if (!this.canWrite)
        throw error("APP_READ_ONLY_SOURCE", "Settings are read only"); if (this.getState().busy)
        throw error("APP_SETTINGS_BUSY", this.#t("busyError")); }
    #checkPath(path: SettingsPath) { if (!Array.isArray(path) || path.some(p => typeof p !== "string"))
        throw error("APP_SETTINGS_PATH", "Invalid configuration path"); }
    #conflict(path: SettingsPath, allowSame = false) {
        this.#checkPath(path);
        for (const b of this.#buffers.values())
            if ((prefix(path, b.path) || prefix(b.path, path)) && !(allowSame && key(path) === key(b.path)))
                throw error("APP_SETTINGS_TEXT_CONFLICT", this.#t("textConflict"));
    }
    #write(path: SettingsPath, value: unknown, remove = false) {
        if (!path.length) {
            if (remove || !value || typeof value !== "object" || Array.isArray(value))
                throw error("APP_CONFIG_INVALID", this.#t("rootObject"));
            this.#draft = clone(value as SettingsConfig);
            return;
        }
        const candidate=clone(this.#draft);
        let target:any=candidate;
        const arrayIndex=(container:unknown,part:string)=>{
            if(Array.isArray(container)&&(!/^(0|[1-9]\d*)$/.test(part)||Number(part)>container.length))throw error("APP_SETTINGS_PATH","Invalid array index");
        };
        for(const part of path.slice(0,-1)) {
            arrayIndex(target,part);
            if(!Object.hasOwn(target,part))Object.defineProperty(target,part,{value:{},writable:true,enumerable:true,configurable:true});
            if(!target[part]||typeof target[part]!=="object")throw error("APP_SETTINGS_PATH","Cannot traverse a scalar configuration value");
            target=target[part];
        }
        const last=path.at(-1)!;arrayIndex(target,last);
        if(remove){if(Array.isArray(target))target.splice(Number(last),1);else delete target[last];}
        else Object.defineProperty(target,last,{value:clone(value),writable:true,enumerable:true,configurable:true});
        this.#draft=candidate;
    }

    #changed() { this.#issues = []; this.#notice = ""; this.#status = "editing"; this.#emit(); }
    setValue(path: SettingsPath, value: unknown) { this.#editable(); this.#conflict(path); if (value === undefined)
        throw error("APP_CONFIG_INVALID", "Use removeValue to remove a field"); assertJson(value); this.#write(path, value); this.#changed(); }
    removeValue(path: SettingsPath) {
        this.#editable(); this.#conflict(path);
        const parent = path.slice(0, -1);
        if (Array.isArray(settingsValue(this.#draft, parent))) {
            const index = Number(path.at(-1));
            for (const buffer of this.#buffers.values()) {
                if (prefix(parent, buffer.path) && Number(buffer.path[parent.length]) >= index)
                    throw error("APP_SETTINGS_TEXT_CONFLICT", this.#t("textConflict"));
            }
        }
        this.#write(path, undefined, true); this.#changed();
    }
    setText(path: SettingsPath, text: string, kind: "json" | "number" | "integer" = "json") {
        this.#editable();
        this.#conflict(path, true);
        const existing = this.#buffers.get(key(path));
        const buffer = { path: [...path], text, original: existing?.original ?? JSON.stringify(settingsValue(this.#draft, path), null, 2) ?? "", error: undefined as string | undefined };
        try {
            const parsed = JSON.parse(text);
            assertJson(parsed);
            if(kind !== "json" && (typeof parsed !== "number" || kind === "integer" && !Number.isInteger(parsed))) throw new TypeError("Enter a valid " + kind);
            this.#write(path, parsed);
        }
        catch (e) {
            buffer.error = e instanceof Error ? e.message : String(e);
        }
        this.#buffers.set(key(path), buffer);
        this.#changed();
    }
    reset() { this.#editable(); this.#draft = clone(this.#saved); this.#buffers.clear(); this.#changed(); }
    async getStoreChoices(key: string) {
        this.#active();const request=new AbortController();const abort=()=>request.abort(this.signal.reason);
        this.signal.addEventListener("abort",abort,{once:true});let timer:ReturnType<typeof setTimeout>|undefined;
        try {
            const cancelled=new Promise<never>((_,reject)=>{
                request.signal.addEventListener("abort",()=>reject(request.signal.reason),{once:true});
                timer=setTimeout(()=>request.abort(error("APP_SETTINGS_TIMEOUT",this.#t("validateTimeout"))),this.deadlines.validate);
            });
            return await Promise.race([this.choices(key,request.signal),cancelled]);
        } finally {clearTimeout(timer);this.signal.removeEventListener("abort",abort);}
    }
    dispose() { this.#request++; this.#abort.abort(error("APP_SETTINGS_CLOSED", "Settings closed")); this.#listeners.clear(); }
    validate() { return this.#run("validate"); }
    save() { return this.#run("save"); }
    async #run(action: "validate" | "save") {
        this.#editable();
        if ([...this.#buffers.values()].some(b => b.error))
            throw error("APP_SETTINGS_INVALID_TEXT", this.#t("invalidText"));
        const body = { config: clone(this.#draft), expectedRevision: this.#revision }, id = ++this.#request;
        this.#status = action === "save" ? "saving" : "validating";
        this.#issues = [];
        this.#notice = "";
        this.#emit();
        const controller = new AbortController();
        const abort = () => controller.abort(this.signal.reason);
        this.signal.addEventListener("abort", abort, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const cancelled = new Promise<never>((_, reject) => {
                timer = setTimeout(() => controller.abort(error("APP_SETTINGS_TIMEOUT", action === "save" ? this.#t("saveTimeout") : this.#t("validateTimeout"))), this.deadlines[action]);
                controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
            });
            const result = await Promise.race([this.transport(action, body, controller.signal), cancelled]);
            this.#active();
            if (id !== this.#request)
                throw error("APP_SETTINGS_CLOSED", "Superseded request");
            if (action === "save") {
                this.#saved = clone(result.config);
                this.#draft = clone(result.config);
                this.#revision = result.revision;
                this.#buffers.clear();
                this.#notice = result.restartRequired ? this.#t("savedRestart") : this.#t("saved");
            }
            else
                this.#notice = this.#t("validated");
            this.#status = "editing";
            return result;
        }
        catch (e) {
            if (id === this.#request && !this.signal.aborted) {
                const code = (e as {
                    code?: string;
                }).code;
                this.#status = code === "APP_CONFIG_CONFLICT" ? "conflict" : code === "APP_SETTINGS_TIMEOUT" && action === "save" ? "unconfirmed" : "editing";
                const issues=(e as {issues?:Array<{path:SettingsPath;message:string}>}).issues;
                this.#issues = Array.isArray(issues)&&issues.length ? clone(issues) : [{ path: [], message: e instanceof Error ? e.message : String(e) }];
            }
            throw e;
        }
        finally {
            clearTimeout(timer);
            this.signal.removeEventListener("abort", abort);
            if (id === this.#request && !this.signal.aborted) {
                if (this.getState().busy)
                    this.#status = "editing";
                this.#emit();
            }
        }
    }
}
