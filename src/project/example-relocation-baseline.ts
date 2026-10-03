import type { ModelRegistration } from "./model-registration-contract.js";

/** Frozen from the approved 20261001 assets and original confirmedSeedDefinitions; never sampled from a live Project. */
export const exampleRelocationBaseline: ReadonlyArray<{ modelRef: string; sourceDigest: string; registration: ModelRegistration }> = [
  {
    "modelRef": "examples/01-basic-types.json",
    "sourceDigest": "82477702aebc2298921d02473b6cdbf2a2902a64a1d35899ecdfcc2e0b5645e3",
    "registration": {
      "modelRef": "examples/01-basic-types.json",
      "name": "用例 01 · 基本类型与枚举",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "覆盖 JSON Schema 的全部基本类型、整数子类型、字符串/数字枚举、必填/可选、空容器。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  {
    "modelRef": "examples/02-nested-order.json",
    "sourceDigest": "6e54e0de21b2e1ec8e2de8cd9e397ecbe7b50d24d371ced11bebc80e856c221a",
    "registration": {
      "modelRef": "examples/02-nested-order.json",
      "name": "用例 02 · 订单与深层嵌套",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "对象套对象、对象套数组、数组套对象；订单、明细、规格、价格与收货信息的多级结构。",
      "package": "memsphere.examples.orders",
      "store_id": "models/json-schema/draft-07",
      "package_name": "订单示例",
      "storage": "store"
    }
  },
  {
    "modelRef": "examples/03-array-root.json",
    "sourceDigest": "cfac6a2d83b3a9fe1e16814845cb2bb423515573e3816d2bd8c779312cc281c0",
    "registration": {
      "modelRef": "examples/03-array-root.json",
      "name": "用例 03 · 根数组与多维数组",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "根值不是对象而是数组；包含数组套数组、数组套对象、嵌套枚举数组。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  {
    "modelRef": "examples/04-dictionaries-and-encodings.json",
    "sourceDigest": "f5a0f1dcdea6e98daabbfd6827a878dc063e203a2461f9cc37ade08b623a139e",
    "registration": {
      "modelRef": "examples/04-dictionaries-and-encodings.json",
      "name": "用例 04 · 字典与特殊类型映射",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "动态键字典以及 bigint/bytes 的 JSON 表示示例；它们不是原生 Map、bigint、Uint8Array 的反射声明。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  {
    "modelRef": "examples/05-unions-and-conditions.json",
    "sourceDigest": "890c5c427b9d08b71743e2fc16596a4b6a9f85e337db49f3759d9718ab4da089",
    "registration": {
      "modelRef": "examples/05-unions-and-conditions.json",
      "name": "用例 05 · 联合与条件展示边界",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "合法 Draft-07 的联合、组合、条件、布尔子模式；用于检查展示边界，不承诺现有业务 Runtime 支持这些特性。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  {
    "modelRef": "examples/06-references-and-recursion.json",
    "sourceDigest": "463ee40780c9726758fdbe90e1f7f0283e0bcfea13342934aaf2614c0a6efa13",
    "registration": {
      "modelRef": "examples/06-references-and-recursion.json",
      "name": "用例 06 · 引用与递归",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "本地 definitions 复用、递归树与精确文件 ModelRef；当前树表显示引用提示，引用目标查看原文，不无限展开。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  {
    "modelRef": "examples/07-scalar-enum-root.json",
    "sourceDigest": "83fbd06b0e907f586e13180dd8780f7c42b5d2ef878c037a351a1d62348a195f",
    "registration": {
      "modelRef": "examples/07-scalar-enum-root.json",
      "name": "用例 07 · 标量枚举根",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "整个模型就是一个字符串枚举，没有对象字段。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  },
  {
    "modelRef": "examples/08-numeric-enum-root.json",
    "sourceDigest": "622d3a326ed1ce273b91227f7483ab496f713f60db84c3d250e2bf833f65ddde",
    "registration": {
      "modelRef": "examples/08-numeric-enum-root.json",
      "name": "用例 08 · 数字枚举根",
      "tags": [
        "example",
        "json-schema"
      ],
      "description": "整数作为根值；数值枚举成员，不把数字转换为字符串。",
      "store_id": "models/json-schema/draft-07",
      "storage": "store"
    }
  }
];

for (const entry of exampleRelocationBaseline) {
  if (entry.registration.tags) Object.freeze(entry.registration.tags);
  Object.freeze(entry.registration);
  Object.freeze(entry);
}
Object.freeze(exampleRelocationBaseline);
