# 实施与验证方案

## 问题与实际代码

`MemoryApplication.load()` 在加载 ChangeSet 后把 `#memories` 替换为 scope/target 项。`renderOptions()` 又用这个数组判断所有引用存在性，导致未修改的合法命题被误标 missing。

`GET /api/changes/:id` 经 `withMemoryChangeDetailSnapshot()` 构造基线和候选 YAML，却未调用普通详情已有的 `attachEffectiveRuleTrees()`，因此 `renderRuleReference()` 得不到有效投影，不生成展开按钮。原有差异规划器已经忽略 `effectiveRules`。

## 实现路径与影响范围

1. `src/memory/changeset.ts`：仅为 detail snapshot callback 增加 `baseMemoryRoot`，与现有完整候选 `memoryRoot` 同生命周期。目录只供回调内部读取，退出后统一清理，不序列化物理根到 HTTP 响应。
2. `src/commands/view.ts`：在同一次 detail snapshot 内构造完整候选 summary 目录，返回 `referenceMemories`；summary loader 增加明确的不缓存索引选项，本入口不向 ViewMemoryCache 写入一次性临时 root，避免每次刷新残留失效目录索引。候选/基线各共享一个 snapshot-scoped RuleLookup，目录和命题解析 Promise 仅在当前回调内存活，避免按目标重复全量扫描。复用生效规则解析器；invalid candidate 的 RuleResolutionError 隔离到单个引用，在失败字段中预筛选可解析的成员后，重新整体解析成功成员以保持既有去重规则，原始声明保持全部引用。普通 effective API 继续严格报错，其他异常不吞掉。
3. `modules/org.memsphere.memory/adapter/view/index.ts`：引用目录与变更列表分离；普通浏览采用普通目录，ChangeSet 使用返回的候选目录。复用既有规则数量、展开/收起和命题正文 renderer。打开引用保留 change query，并去掉会强制呈现 ChangeSet 工作区的 section=changes。
4. `test/view-responsive.test.ts`：fixture 可选初始化临时 Git Store；增加未修改目标、无效引用、基线/候选版本隔离的真实 HTTP + 浏览器回归。使用 public ChangeSet 操作/helper 准备候选，测试不写真实项目 Memory。

## 已有修复如何纳入

前序会话四文件修复在当前工作区，尚未 commit。本轮先独立确认需求/方案；方案接纳后复核已有 diff、补充版本隔离测试，按本 Run 顺序上报实现和重新验证。前序测试仅作为历史参考，不代替本 Run 首次验证。

## 开发任务

- 核对引用目录来自完整候选快照，避免查询当前主工作树或仅 target 列表。
- 核对 baseMemoryRoot 生命周期、各版本解析来源、保持原始 !ref 与 diff/comment anchor。
- 补充同一 ChangeSet 修改引用方与 Statement、两版本正文和数量不同的独立回归。
- 补充同字段混合合法/缺失引用的 API 和浏览器回归；合法成员仍可展开，无效成员保留原始引用且不可展开。
- 检查一次性 snapshot 不进入长期 ViewMemoryCache 索引；补充明确的缓存生命周期验证，重复 detail 请求均成功且没有新增临时根索引写入。snapshot-scoped lookup 按目标 Promise 去重读取，候选/基线绝不共用 catalog。
- 覆盖普通详情、有效展开/收起/导航、失效引用不阻断阅读、候选差异/评论已有测试。
- 保存可复核实现、测试和浏览器操作证据，提交三角色实现评审；最后切换产品负责人到 Human。

## 验证

先运行 `node --import tsx --test test/view-responsive.test.ts` 与 `test/memory-changeset.test.ts`。版本隔离案例通过 Store API 创建临时 Managed ChangeSet，改变候选命题与 Procedure，checkpoint 校验后检查 detail API 的候选/基线 effectiveRules；在真实 View 中检查候选数量/正文/跳转，不能只检查 JSON 字符串是否含某句。

运行 `npm run typecheck`、`npm run build`、`npm test` 全量回归、`memsphere validate`；使用 playwright-cli 在本轮最终内容的真实 View fixture 中操作展开、收起、跳转。若存在 Memory 交付差异，则另执行变更级 validate 并记录 id/状态/View 入口。

## 兼容性与文档

不增加 YAML syntax 关键字、CLI 或持久化格式。HTTP 仅增加只读投影/目录；语义 diff 排除 effectiveRules，原始声明和评论定位不变。检查 memsphere-memory-access-rules、memsphere-view、memsphere-memory 与 skill 后确认已覆盖“引用处展开规则、保留源入口”和 ChangeSet 候选浏览语义。本轮恢复已有契约，不新增 Memory 能力，因此当前计划无 Memory 修改；如评审发现说明缺口，再按同等方案确认补齐并执行 Memory 门禁。

## 采用的 Statement

memsphere-repository-development-rules（保持边界、检查 System Memory 冗余一致性）、memsphere-repository-testing-rules（行为回归、实际浏览器、全量测试）、memsphere-repository-requirement-rules（兼容性边界）、memsphere-memory-access-rules（保留声明/来源入口）、memsphere-yaml-syntax-rules（canonical target、按 channel/section 投影）、memsphere-repository-delivery-rules（验收后归档）。无待决问题。
