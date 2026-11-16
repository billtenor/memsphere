import type { SettingsPath } from "./app-settings-contracts.js";

type Schema = Record<string, unknown>;
const object = (value: unknown): Schema | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Schema : undefined;
function child(schema: Schema | undefined, part: string): Schema | undefined {
    if (!schema) return undefined;
    if (/^(0|[1-9]\d*)$/.test(part) && schema.items !== undefined) {
        return object(Array.isArray(schema.items) ? schema.items[Number(part)] ?? schema.additionalItems : schema.items);
    }
    return object(object(schema.properties)?.[part]);
}
/** Common settings paths: object properties and Draft-07 homogeneous/tuple items. */
export function settingsFieldSchema(schema: Schema | undefined, path: SettingsPath) {
    let node = schema, parent: Schema | undefined;
    let readOnly = node?.readOnly === true;
    for (const part of path) {
        parent = node;
        node = child(node, part);
        readOnly ||= node?.readOnly === true;
    }
    const required = Boolean(parent && object(parent.properties) && Array.isArray(parent.required) && parent.required.includes(path.at(-1)));
    return { node, readOnly, required };
}
function equal(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    const left = Object.keys(a), right = Object.keys(b);
    return left.length === right.length && left.every(key => Object.hasOwn(b, key) && equal((a as Schema)[key], (b as Schema)[key]));
}
/** Check the whole candidate so ancestor replacement cannot bypass descendant annotations. */
export function assertSettingsReadOnly(schema: unknown, previous: unknown, candidate: unknown, message = "Read-only configuration field cannot be changed"): void {
    const visit = (node: Schema | undefined, before: unknown, after: unknown, path: string[]) => {
        if (!node) return;
        if (node.readOnly === true) {
            if (!equal(before, after)) throw Object.assign(new Error(`${message}: ${path.join(".") || "$"}`), { code: "APP_SETTINGS_READ_ONLY" });
            return;
        }
        for (const [key, value] of Object.entries(object(node.properties) ?? {})) {
            visit(object(value), object(before)?.[key], object(after)?.[key], [...path, key]);
        }
        if (Array.isArray(before) || Array.isArray(after)) {
            const length = Math.max(Array.isArray(before) ? before.length : 0, Array.isArray(after) ? after.length : 0);
            for (let index = 0; index < length; index++) visit(child(node, String(index)), Array.isArray(before) ? before[index] : undefined, Array.isArray(after) ? after[index] : undefined, [...path, String(index)]);
        }
    };
    visit(object(schema), previous, candidate, []);
}
