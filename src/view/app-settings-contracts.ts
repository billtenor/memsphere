import type { Disposer, TextRef, SelectOptionDescriptor } from "./view-sdk.js";
export type SettingsPath = readonly string[];
export type SettingsConfig = Record<string, unknown>;
export interface AppSettingsSnapshot {
    readonly schema?: Readonly<Record<string, unknown>>;
    readonly saved: SettingsConfig;
    readonly draft: SettingsConfig;
    readonly revision: string;
    readonly dirty: boolean;
    readonly busy: boolean;
    readonly status: "editing" | "validating" | "saving" | "conflict" | "unconfirmed";
    readonly issues: readonly {
        path: SettingsPath;
        message: string;
    }[];
    readonly textBuffers: readonly {
        path: SettingsPath;
        text: string;
        error?: string;
        modified: boolean;
    }[];
    readonly notice: string;
}
export interface AppSettingsPresentationContext {
    readonly projectId: string;
    readonly app: Readonly<{
        id: string;
        name: string;
    }>;
    readonly canWrite: boolean;
    readonly signal: AbortSignal;
    getState(): Readonly<AppSettingsSnapshot>;
    subscribe(listener: (state: Readonly<AppSettingsSnapshot>) => void): Disposer;
    setValue(path: SettingsPath, value: unknown): void;
    removeValue(path: SettingsPath): void;
    setText(path: SettingsPath, text: string, kind?: "json" | "number" | "integer"): void;
    validate(): Promise<unknown>;
    save(): Promise<unknown>;
    reset(): void;
    getStoreChoices(key: string): Promise<{
        candidates: string[];
        diagnostic?: string;
        storeId?: unknown;
    }>;
}
export type SettingsOptions = readonly (Omit<SelectOptionDescriptor, "value"> & {
    readonly value: unknown;
})[];
export interface SettingsFieldDescriptor {
    readonly kind: "text" | "number" | "integer" | "boolean" | "select" | "json" | "projectStore";
    readonly path?: SettingsPath;
    readonly key?: string;
    readonly label: TextRef;
    readonly description?: TextRef;
    readonly required?: boolean;
    readonly options?: SettingsOptions | ((state: Readonly<AppSettingsSnapshot>, options: {
        signal: AbortSignal;
    }) => SettingsOptions | Promise<SettingsOptions>);
    readonly visible?: (state: Readonly<AppSettingsSnapshot>) => boolean;
    readonly disabled?: (state: Readonly<AppSettingsSnapshot>) => boolean;
}
export interface SettingsFormDescriptor {
    readonly context: AppSettingsPresentationContext;
    readonly sections: readonly {
        readonly id: string;
        readonly title: TextRef;
        readonly description?: TextRef;
        readonly fields: readonly SettingsFieldDescriptor[];
    }[];
}
