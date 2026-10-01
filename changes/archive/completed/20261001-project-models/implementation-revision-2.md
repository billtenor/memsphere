# 实现评审第 2 轮修订摘要

关联 Review：`review-20261001-071900z-a1fe7c7d`；第 1 轮：`round-20261001-071900z-dd4b22d4`。研发、架构通过；测试要求修改；Runner 已要求修订并重报，未跳过评审。

## 相对 `$id` 意见核对与处理

测试意见 `comment-20261001-072241z-6860af3a` 复现宿主 `Invalid URL`，但“原有 Runtime 已支持相对 `$id`”的前提不成立。Runner 直接调用既有 `JsonSchemaModelRuntimeFactory.createRuntime`，同一定义得到：

```text
Unsupported JSON Schema at #/$id: relative $id values are not supported; provide an absolute URI
```

原编译器在 `src/data/extensions/json-schema/index.ts` 的 constructor 中明确拒绝相对 `$id`。已确认契约仅承诺准备现有支持的业务 Runtime，不扩展反射子集。本轮不自行引入相对 URI 解析/别名规则。

仍修正宿主依赖收集：只有可解析的绝对 `$id` 才作为 base，其他值留给已有 Factory 的明确错误，不再提前产生泛化的 `Invalid URL`。补测试证明相对 `$id` 模型仍能完整浏览，直接 Factory 与 Project 宿主在 Runtime 请求时返回相同边界诊断。没有改变 Runtime 公共 API 或扩大 JSON Schema 支持范围。

Runner 在投要求修改后尝试写第 1 轮意见处置，CLI 正确拒绝已只读轮次；没有绕过只读限制。本摘要与第 2 轮 Submission 正式记录上述证据和处置结论，请测试 Reviewer 再次核对原 Factory 的实际边界。

## 原文 BOM 修正

Runner 复核发现 UTF-8 解码默认剥离 BOM，与完整原文保留要求不符。源码展示使用 `TextDecoder(..., { fatal: true, ignoreBOM: true })` 保留 BOM；原有 Serializer 正常解码同一字节快照用于模型值解析，不改变序列化标准。

新增测试包含 BOM、前导空格、CRLF，断言原文完全一致、模型定义正确以及业务 Runtime 可用。修正只在 `src/project/models.ts` 和 `test/project-models.test.ts`，没有存储格式、配置或产品范围变化。

此外纠正验收材料中不存在的原型 `styles.ts` 文件列举；原型样式实际位于 `adapter/view/index.ts`。

## 验证

受影响元模型/Project 模型测试 13/13，`npm run typecheck`、`git diff --check` 通过。Memory 未修改，最终 ChangeSet 校验再次通过，digest 仍为 `59d901b23ad5a33cb2e5c94652e040716c9fdd07c4d921b1c3b007aebb1a9cb2`；普通 Project validate 通过。

修订后 `npm test`（含 pretest 完整构建）实际通过：824 项、823 通过、0 失败、1 项既有 Windows-only 在 Linux 跳过，退出码 0。Windows/macOS 原生未执行状态不变。没有降低验收或跳过测试。
