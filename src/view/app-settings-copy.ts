const copy = {
    "readOnly": {"zh-CN":"不能修改只读配置字段", "en":"Read-only configuration field cannot be changed"},
    "noStores": {"zh-CN":"没有匹配的业务 Store。请先在当前 Project 登记符合所需模型和类型的 Store，然后重新读取本页。","en":"No matching business Stores. Register a Store with the required model and kind in this Project, then reload this page."},
    "jsonMode":{"zh-CN":"编辑完整 JSON","en":"Edit full JSON"},
    "formMode":{"zh-CN":"返回表单","en":"Return to form"},
    "apps": {
        "zh-CN": "App 配置",
        "en": "App configuration"
    },
    "unsavedTitle": {
        "zh-CN": "还有未保存的配置",
        "en": "Unsaved configuration"
    },
    "leaveBusy": {
        "zh-CN": "请求可能已送出；离开不会撤销已提交的保存。是否放弃本地编辑并离开？",
        "en": "A request may already have been submitted. Leaving does not undo a save. Discard local edits and leave?"
    },
    "leave": {
        "zh-CN": "是否放弃当前修改并离开？",
        "en": "Discard the current changes and leave?"
    },
    "discard": {
        "zh-CN": "放弃并离开",
        "en": "Discard and leave"
    },
    "keepEditing": {
        "zh-CN": "继续编辑",
        "en": "Keep editing"
    },
    "loading": {
        "zh-CN": "正在读取 App 配置…",
        "en": "Loading App configuration…"
    },
    "reload": {
        "zh-CN": "重新读取",
        "en": "Reload"
    },
    "projectHelp": {
        "zh-CN": "当前项目：{project}。每个外部安装的 App 都有独立配置。",
        "en": "Current Project: {project}. Each installed App has its own configuration."
    },
    "empty": {
        "zh-CN": "当前项目尚未安装 App。使用 memsphere app install <App目录> 安装后可在此配置。",
        "en": "No Apps are installed in this Project. Install one with memsphere app install <directory> to configure it here."
    },
    "search": {
        "zh-CN": "搜索 App",
        "en": "Search Apps"
    },
    "noMatches": {
        "zh-CN": "没有匹配的 App。",
        "en": "No matching Apps."
    },
    "clearSearch": {
        "zh-CN": "清空搜索",
        "en": "Clear search"
    },
    "chooseProject": {
        "zh-CN": "App 配置属于 Project。请先通过顶部项目选择器选择 Project，再配置其中已安装的 App。",
        "en": "App configuration belongs to a Project. Select a Project using the top Project selector to configure its installed Apps."
    },
    "enabled": {
        "zh-CN": "已启用",
        "en": "Enabled"
    },
    "disabled": {
        "zh-CN": "未启用",
        "en": "Disabled"
    },
    "disabledHelp": {
        "zh-CN": "未启用（仍可配置）",
        "en": "Disabled (configuration available)"
    },
    "configure": {
        "zh-CN": "配置",
        "en": "Configure"
    },
    "allApps": {
        "zh-CN": "所有 App",
        "en": "All Apps"
    },
    "save": {
        "zh-CN": "保存配置",
        "en": "Save configuration"
    },
    "validate": {
        "zh-CN": "校验",
        "en": "Validate"
    },
    "reset": {
        "zh-CN": "取消修改",
        "en": "Discard changes"
    },
    "model": {
        "zh-CN": "模型：{model}",
        "en": "Model: {model}"
    },
    "noFields": {
        "zh-CN": "这个 App 没有可配置项。",
        "en": "This App has no configurable settings."
    },
    "readOnlyValues": {
        "zh-CN": "已保存配置（只读）",
        "en": "Saved configuration (read-only)"
    },
    "json": {
        "zh-CN": "完整配置（JSON）",
        "en": "Full configuration (JSON)"
    },
    "extensionFailed": {
        "zh-CN": "配置扩展加载失败：{error}",
        "en": "Configuration extension failed: {error}"
    },
    "generic": {
        "zh-CN": "使用通用配置",
        "en": "Use generic configuration"
    },
    "dirty": {
        "zh-CN": "有未保存的修改",
        "en": "Unsaved changes"
    },
    "clean": {
        "zh-CN": "配置未修改",
        "en": "No changes"
    },
    "busy": {
        "zh-CN": "正在处理",
        "en": "Processing"
    },
    "unknown": {
        "zh-CN": "运行状态未确认",
        "en": "Runtime status unconfirmed"
    },
    "pendingRestart": {
        "zh-CN": "配置已保存；当前 View 仍使用启动快照，请重启 View。",
        "en": "Configuration saved. The current View still uses its boot snapshot; restart View to apply it."
    },
    "snapshotMatches": {
        "zh-CN": "配置与 View 启动快照一致；实际扩展运行状态尚未确认。",
        "en": "Configuration matches the View boot snapshot; extension runtime status is unconfirmed."
    },
    "choose": {
        "zh-CN": "请选择",
        "en": "Select an option"
    },
    "unavailable": {
        "zh-CN": "{value}（当前值不可选）",
        "en": "{value} (current value unavailable)"
    },
    "busyError": {
        "zh-CN": "正在校验或保存，请稍后再编辑",
        "en": "Validation or saving is in progress. Wait before editing."
    },
    "textConflict": {
        "zh-CN": "请先保存或明确放弃相交的 JSON 编辑",
        "en": "Save or explicitly discard overlapping JSON edits first."
    },
    "rootObject": {
        "zh-CN": "完整配置必须是 JSON 对象",
        "en": "The full configuration must be a JSON object."
    },
    "invalidText": {
        "zh-CN": "请先修正 JSON 输入，配置尚未保存",
        "en": "Correct the JSON input first. Configuration has not been saved."
    },
    "saveTimeout": {
        "zh-CN": "保存结果未确认，请重新读取后核实",
        "en": "Save result is unconfirmed. Reload to check the persisted configuration."
    },
    "validateTimeout": {
        "zh-CN": "校验超时",
        "en": "Validation timed out."
    },
    "savedRestart": {
        "zh-CN": "配置已保存；View 可能需要重启，运行状态尚未确认。",
        "en": "Configuration saved. View may require a restart; runtime status is unconfirmed."
    },
    "saved": {
        "zh-CN": "配置已保存。",
        "en": "Configuration saved."
    },
    "validated": {
        "zh-CN": "校验通过，尚未保存。",
        "en": "Validation passed. Changes have not been saved."
    }
} as const;
export function appSettingsText(locale: string, key: keyof typeof copy, params: Record<string, string> = {}): string {
    return copy[key][locale === "en" ? "en" : "zh-CN"].replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
}
