/** JSON 可以表达的值；不包含 undefined、bigint 或函数。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

export type JsonObject = {
  [key: string]: JsonValue;
};

/**
 * 扩展配置的统一封装。
 *
 * 框架负责解析 JSON 并检查顶层为对象；Factory 负责字段校验及默认值。
 * readonly 只限制 json 成员重新赋值，不表示对象内容深度只读。
 */
export class Config {
  constructor(public readonly json: JsonObject) {}
}
