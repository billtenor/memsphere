import type { ViewUi } from "@memsphere/view-sdk";

/** Schema presentation shared by the prototype and the readonly model browser; not a data-layer API. */
export interface DefinitionRow {
  readonly kind: "root" | "field" | "element" | "dynamic-field" | "branch";
  readonly id: string;
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly booleanSchema?: boolean;
  readonly required?: boolean;
  readonly combination?: Combination;
  readonly references?: readonly string[];
  readonly referenceError?: "missing" | "external" | "invalid" | "cycle" | "scope";
  /** Structural recursion is expanded only by an explicit user action, never by Expand all. */
  readonly expandReference?: () => readonly DefinitionRow[];
  readonly children: readonly DefinitionRow[];
}

type Combination = "anyOf" | "oneOf";

function combinations(schema: Readonly<Record<string, unknown>>): Combination[] {
  return (["anyOf", "oneOf"] as const).filter(keyword => Array.isArray(schema[keyword]));
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Presentation-only resolution within the original document; no network or model loading. */
function localReferences(definition: unknown) {
  const root = object(definition);
  const nestedScopes = new WeakSet<object>();
  function findScopes(value: unknown, scoped = false) {
    if (!isObject(value)) return;
    scoped ||= value !== definition && value.$id !== undefined;
    if (scoped) nestedScopes.add(value);
    for (const key of ["properties", "definitions", "patternProperties"]) {
      Object.values(object(value[key])).forEach(child => findScopes(child, scoped));
    }
    for (const key of ["items", "additionalItems", "additionalProperties", "contains", "not", "if", "then", "else"]) {
      if (Array.isArray(value[key])) (value[key] as unknown[]).forEach(child => findScopes(child, scoped));
      else findScopes(value[key], scoped);
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (Array.isArray(value[key])) (value[key] as unknown[]).forEach(child => findScopes(child, scoped));
    }
    Object.values(object(value.dependencies)).forEach(child => findScopes(child, scoped));
  }
  findScopes(definition);
  function resolve(value: unknown, scoped = false): { value: unknown; references: string[]; error?: DefinitionRow["referenceError"] } {
    const references: string[] = [];
    const seen = new Set<unknown>();
    let current = value;
    while (typeof object(current).$ref === "string") {
      const ref = object(current).$ref as string;
      references.push(ref);
      if (scoped || isObject(current) && nestedScopes.has(current)) return { value, references, error: "scope" };
      if (seen.has(current)) return { value, references, error: "cycle" };
      seen.add(current);
      let fragment = ref;
      if (ref !== "" && !ref.startsWith("#")) {
        try {
          if (typeof root.$id !== "string" || !URL.canParse(root.$id)) return { value, references, error: "external" };
          const base = new URL(root.$id); base.hash = "";
          const target = new URL(ref, base);
          fragment = target.hash;
          target.hash = "";
          if (target.href !== base.href) return { value, references, error: "external" };
        } catch { return { value, references, error: "invalid" }; }
      }
      let pointer: string;
      try { pointer = decodeURIComponent(fragment.startsWith("#") ? fragment.slice(1) : fragment); }
      catch { return { value, references, error: "invalid" }; }
      if (pointer && !pointer.startsWith("/")) return { value, references, error: "invalid" };
      current = definition;
      for (const segment of pointer ? pointer.slice(1).split("/") : []) {
        if (isObject(current) && nestedScopes.has(current)) return { value, references, error: "scope" };
        if (/~(?:[^01]|$)/.test(segment)) return { value, references, error: "invalid" };
        const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
        if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) return { value, references, error: "missing" };
        current = (current as Record<string, unknown>)[key];
      }
      if (!isObject(current) && typeof current !== "boolean") return { value, references, error: "invalid" };
      if (isObject(current) && nestedScopes.has(current)) return { value, references, error: "scope" };
    }
    if (object(current).$ref !== undefined) return { value, references, error: "invalid" };
    return { value: current, references };
  }
  return resolve;
}

export function definitionTree(
  definition: unknown, rootName: string, elementName: string, dynamicFieldName = "[Dynamic field]",
  branchName: (value: unknown, index: number) => string = (_value, index) => `Type ${index + 1}`,
  combinationName: (keyword: Combination) => string = keyword => keyword,
): DefinitionRow {
  const resolve = localReferences(definition);
  function row(value: unknown, name: string, id: string, kind: DefinitionRow["kind"], required?: boolean, combination?: Combination,
    ancestors = new Set<unknown>(), scoped = false): DefinitionRow {
    scoped ||= value !== definition && object(value).$id !== undefined;
    const resolved = resolve(value, scoped);
    const target = object(resolved.value);
    // Retain authored field labels while all structural and validation information comes from the target.
    const annotations = object(value);
    const schema = resolved.references.length && !resolved.error ? { ...target,
      ...(typeof annotations.title === "string" ? { title: annotations.title } : {}),
      ...(typeof annotations.description === "string" ? { description: annotations.description } : {}) } : target;
    const buildChildren = (parents: Set<unknown>) => {
      const next = new Set(parents).add(resolved.value);
      const fields = object(schema.properties);
      const requiredFields = new Set(Array.isArray(schema.required) ? schema.required : []);
      const children = Object.entries(fields).map(([field, child], index) =>
        row(child, field, `${id}-${index}`, "field", requiredFields.has(field), undefined, next, scoped));
      if (schema.type === "array" && schema.items !== undefined && !Array.isArray(schema.items)) {
        children.push(row(schema.items, elementName, `${id}-element`, "element", undefined, undefined, next, scoped));
      }
      // Dynamic fields are peers of named fields; their names are supplied by users, not invented here.
      if (allowsObject(schema) && (schema.additionalProperties === true || isObject(schema.additionalProperties))) {
        children.push(row(schema.additionalProperties, dynamicFieldName, `${id}-dynamic-field`, "dynamic-field", undefined, undefined, next, scoped));
      }
      const groups = combinations(schema);
      for (const keyword of groups) {
        (schema[keyword] as unknown[]).forEach((branch, index) => {
          const label = branchName(branch, index);
          children.push(row(branch, `[${groups.length > 1 ? `${combinationName(keyword)}: ` : ""}${label}]`, `${id}-${keyword}-${index}`, "branch", undefined, keyword, next, scoped));
        });
      }
      return children;
    };
    const recursive = !resolved.error && ancestors.has(resolved.value);
    return { kind, id, name, schema, booleanSchema: typeof resolved.value === "boolean" ? resolved.value : undefined,
      required, combination, references: resolved.references, referenceError: resolved.error,
      ...(recursive ? { expandReference: () => buildChildren(new Set()) } : {}),
      children: resolved.error || recursive ? [] : buildChildren(ancestors) };
  }
  return row(definition, rootName, "root", "root");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function allowsObject(schema: Readonly<Record<string, unknown>>): boolean {
  return schema.type === undefined || schema.type === "object" || Array.isArray(schema.type) && schema.type.includes("object");
}

export function definitionTable(ui: ViewUi, definition: unknown, text: (zh: string, en: string) => string): HTMLElement {
  const resolve = localReferences(definition);
  const names: Record<string, string> = {
    object: text("对象", "Object"), array: text("数组", "Array"), string: text("文本", "String"),
    number: text("数字", "Number"), integer: text("整数", "Integer"), boolean: text("布尔", "Boolean"), null: text("空值", "Null")
  };
  const combinationLabel = (keyword: Combination) => keyword === "anyOf"
    ? text("任一匹配", "Any match") : text("唯一匹配", "Exactly one match");
  function typeName(value: Readonly<Record<string, unknown>>, booleanSchema?: boolean, ancestors = new Set<unknown>()): string {
    if (booleanSchema !== undefined) return "—";
    if (ancestors.has(value)) return text("递归类型", "Recursive type");
    if (typeof value.$ref === "string") {
      const resolved = resolve(value);
      if (resolved.error) return text("引用", "Reference");
      return typeName(object(resolved.value), typeof resolved.value === "boolean" ? resolved.value : undefined, new Set(ancestors).add(value));
    }
    const enumName = (name: string) => Array.isArray(value.enum) ? text(`${name}枚举`, `${name} enum`) : name;
    if (typeof value.type === "string") return enumName(names[value.type] ?? value.type);
    if (Array.isArray(value.type)) return value.type.map(type => typeof type === "string" ? enumName(names[type] ?? type) : "?").join(" | ");
    const groups = combinations(value);
    if (groups.length === 1) return (value[groups[0]] as unknown[]).map((candidate, index) => candidateName(candidate, index, new Set(ancestors).add(value))).join(" | ");
    if (groups.length > 1) return text("组合类型", "Combined type");
    if (Array.isArray(value.enum)) return text("枚举", "Enum");
    return text("未指定", "Unspecified");
  }
  function candidateName(value: unknown, index: number, ancestors = new Set<unknown>()): string {
    const resolved = resolve(value);
    const candidate = object(resolved.value);
    if (candidate.type === "object") return typeof candidate.title === "string" && candidate.title.trim()
      ? candidate.title : text(`类型${index + 1}`, `Type ${index + 1}`);
    const name = resolved.error ? text("引用", "Reference") : typeName(candidate, typeof resolved.value === "boolean" ? resolved.value : undefined, ancestors);
    return name === "—" || name === text("未指定", "Unspecified") ? text(`类型${index + 1}`, `Type ${index + 1}`) : name;
  }
  const tree = definitionTree(definition, text("[根结构]", "[Root structure]"), text("[元素结构]", "[Item structure]"), text("[动态字段]", "[Dynamic field]"),
    (_value, index) => text(`类型${index + 1}`, `Type ${index + 1}`), combinationLabel);
  const schema = tree.schema;
  const hideContainer = schema.type === "object" && !tree.referenceError;
  const expanded = new Set([tree.id]);
  const referenceChildren = new Map<string, readonly DefinitionRow[]>();
  const root = document.createElement("div");
  root.className = "model-definition-structure";
  const actions = document.createElement("div");
  actions.className = "model-definition-actions";
  function textAction(label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-definition-text-action";
    button.textContent = label;
    button.addEventListener("click", run);
    return button;
  }
  actions.append(textAction(text("全部展开", "Expand all"), () => {
    function expand(row: DefinitionRow) {
      // Even previously opened recursive nodes remain boundaries for bulk expansion.
      if (row.expandReference) return;
      if (row.children.length) expanded.add(row.id);
      row.children.forEach(expand);
    }
    expand(tree); renderRows();
  }), textAction(text("全部收起", "Collapse all"), () => { expanded.clear(); renderRows(); }));
  const scroll = document.createElement("div");
  scroll.className = "model-definition-table-scroll";
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", text("模型字段表格，可横向滚动", "Model fields, horizontally scrollable"));
  const table = document.createElement("table");
  table.className = "model-definition-table";
  table.setAttribute("aria-label", text("模型字段", "Model fields"));
  const head = table.createTHead().insertRow();
  for (const title of [text("字段 / 结构", "Field / structure"), text("类型", "Type"), text("格式", "Format"), text("规则", "Rules"), text("说明", "Description")]) {
    const th = document.createElement("th"); th.scope = "col"; th.textContent = title; head.append(th);
  }
  const body = table.createTBody();
  function schemaRules(value: Readonly<Record<string, unknown>>): string[] {
    const parts: string[] = [];
    if (value.const !== undefined) parts.push(`${text("固定值", "Constant")}: ${JSON.stringify(value.const)}`);
    if (value.default !== undefined) parts.push(`${text("默认值", "Default")}: ${JSON.stringify(value.default)}`);
    if (typeof value.minimum === "number") parts.push(`${text("最小值", "Minimum")}: ${value.minimum}`);
    if (typeof value.maximum === "number") parts.push(`${text("最大值", "Maximum")}: ${value.maximum}`);
    if (typeof value.minItems === "number") parts.push(`${text("最少元素", "Minimum items")}: ${value.minItems}`);
    if (typeof value.maxItems === "number") parts.push(`${text("最多元素", "Maximum items")}: ${value.maxItems}`);
    if (typeof value.$ref === "string") parts.push(`${text("引用", "Reference")}: ${value.$ref}`);
    if (allowsObject(value)) {
      if (value.additionalProperties === false) parts.push(Object.keys(object(value.patternProperties)).length
        ? text("不允许未声明且未匹配规则的字段。", "Fields neither declared nor matched by a rule are not allowed.")
        : text("不允许未声明的字段。", "Undeclared fields are not allowed."));
      else if (value.additionalProperties === true || isObject(value.additionalProperties)) {
        const keys = Object.keys(object(value.patternProperties)).length
          ? text("未声明且未匹配规则的键名可自定义", "Keys not declared or matched by a rule can be customized")
          : Object.keys(object(value.properties)).length
            ? text("未声明的键名可自定义", "Undeclared keys can be customized")
            : text("键名可自定义", "Keys can be customized");
        const dynamic = object(value.additionalProperties);
        const values = value.additionalProperties === true
          ? text("值不限类型。", "Values can have any type.")
          : typeof dynamic.type === "string" && names[dynamic.type]
            ? text(`每个值都是${names[dynamic.type]}。`, `Each value has type ${names[dynamic.type]}.`)
            : "";
        parts.push(values ? `${keys}${text("，", ". ")}${values}` : keys);
      }
    }
    if (Array.isArray(value.anyOf)) parts.push(text("至少满足一个分支", "Match at least one branch"));
    if (Array.isArray(value.oneOf)) parts.push(text("恰好满足一个分支", "Match exactly one branch"));
    return parts;
  }
  function rowRules(row: DefinitionRow): string {
    const parts: string[] = [];
    if (row.required) parts.push(text("必填", "Required"));
    if (row.references?.length) parts.push(`${text("引用", "Reference")}: ${row.references.join(" → ")}`);
    if (row.referenceError) {
      const reasons = {
        missing: text("目标不存在", "Target not found"), external: text("跨模型引用尚未支持展示", "Cross-model reference display is not supported yet"),
        invalid: text("引用地址或目标无效", "Invalid reference address or target"), cycle: text("循环引用没有具体结构", "Reference cycle has no concrete structure"),
        scope: text("嵌套 $id 引用作用域尚未支持展示", "Nested $id reference scope display is not supported yet")
      };
      parts.push(`${text("引用无法解析", "Cannot resolve reference")}: ${reasons[row.referenceError]}`);
      return parts.join(" · ");
    }
    if (row.expandReference) parts.push(text("递归引用，可继续展开", "Recursive reference, expand to continue"));
    if (row.booleanSchema === true) parts.push(text("无限制", "Unrestricted"));
    else if (row.booleanSchema === false) parts.push(row.kind === "field" || row.kind === "dynamic-field"
      ? text("不允许存在", "Must not be present") : text("不允许任何值", "Allows no value"));
    else parts.push(...schemaRules(row.schema));
    return parts.join(" · ") || "—";
  }
  function renderRows() {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.definitionNode : undefined;
    body.replaceChildren();
    function render(row: DefinitionRow, level: number) {
      const tr = body.insertRow(); tr.dataset.definitionRow = row.id;
      tr.dataset.definitionKind = row.kind;
      tr.dataset.definitionDepth = String(level);
      if (row.combination) tr.dataset.definitionCombination = row.combination;
      const field = tr.insertCell();
      const content = document.createElement("div"); content.className = "model-definition-field";
      const indent = document.createElement("span"); indent.className = "model-definition-indent";
      indent.setAttribute("aria-hidden", "true");
      for (let i = 0; i < level; i++) {
        const spacer = document.createElement("span"); spacer.className = "model-definition-indent-step";
        indent.append(spacer);
      }
      content.append(indent);
      const arrow = document.createElement("span"); arrow.className = "model-definition-arrow"; arrow.setAttribute("aria-hidden", "true");
      const name = document.createElement("span"); name.className = "model-definition-name"; name.textContent = row.name;
      if (row.children.length || row.expandReference) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "model-definition-toggle";
        button.dataset.definitionNode = row.id;
        const open = expanded.has(row.id);
        button.setAttribute("aria-expanded", String(open));
        button.setAttribute("aria-label", `${open ? text("收起", "Collapse") : text("展开", "Expand")} ${row.name}`);
        arrow.textContent = open ? "−" : "+";
        button.append(arrow, name);
        button.addEventListener("click", () => {
          if (row.expandReference && !referenceChildren.has(row.id)) referenceChildren.set(row.id, row.expandReference());
          if (expanded.has(row.id)) expanded.delete(row.id); else expanded.add(row.id);
          renderRows();
        });
        content.append(button);
      } else {
        const leaf = document.createElement("span"); leaf.className = "model-definition-leaf";
        leaf.append(arrow, name); content.append(leaf);
      }
      if (typeof row.schema.title === "string" && (row.required !== undefined || row.kind === "branch")) {
        const title = document.createElement("span"); title.className = "model-definition-field-title"; title.textContent = row.schema.title; content.append(title);
      }
      field.append(content);
      const type = tr.insertCell();
      const typeLabel = row.referenceError ? text("引用", "Reference") : typeName(row.schema, row.booleanSchema);
      if (typeLabel === "—") type.append(document.createTextNode("—"));
      else type.append(ui.badge({ text: typeLabel }));
      const format = tr.insertCell(); format.className = "model-definition-format";
      const formats: string[] = [];
      if (typeof row.schema.format === "string") formats.push(row.schema.format);
      if (Array.isArray(row.schema.enum)) formats.push(`${text("可选值", "Allowed values")}: ${row.schema.enum.map(item => JSON.stringify(item)).join(", ")}`);
      format.textContent = formats.join("\n") || "—";
      const rules = tr.insertCell(); rules.className = "model-definition-rules"; rules.textContent = rowRules(row);
      tr.insertCell().textContent = typeof row.schema.description === "string" ? row.schema.description : "—";
      if (expanded.has(row.id)) (referenceChildren.get(row.id) ?? row.children).forEach(child => render(child, level + 1));
    }
    if (hideContainer) tree.children.forEach(child => render(child, 0));
    else render(tree, 0);
    if (hideContainer && !tree.children.length) {
      const empty = body.insertRow().insertCell(); empty.colSpan = 5;
      empty.textContent = text("未直接声明字段或元素结构。", "No fields or item structure are directly declared.");
    }
    if (focused) Array.from(body.querySelectorAll<HTMLButtonElement>("button")).find(button => button.dataset.definitionNode === focused)?.focus();
  }
  renderRows();
  scroll.append(table); root.append(actions);
  root.append(scroll);
  return root;
}
