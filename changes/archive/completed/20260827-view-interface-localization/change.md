---
id: 20260827-view-interface-localization
type: feature
created: 2026-08-27
completed_at: 2026-08-28T03:48:38Z
run_id: run-20260827-140127z-439c5941
---

# View 界面文案语言文件与中文化

## 需求

将 Memsphere View 中面向用户的固定界面文案统一收口到 zh-CN/en 语言资源，默认使用中文并跟随 Home `config.json` 的 `language`；同步中文化相关系统记忆及教学流程中面向人的描述。Memory DSL 标签偏好、用户内容、标识符、命令、路径与机器值保持既有语义。

## 验收标准

- Memory、ChangeSet、Run、Settings、Artifact Review 和 ACP 可见说明的固定文案支持 zh-CN/en，默认及非法语言回退 zh-CN。
- 页面设置正确的 `lang`，日期与英文数量按 locale 格式化，资源注入不引入脚本转义风险。
- 成功保存 language 后，同一 View 进程的下一次页面加载使用新语言；保存失败不改变运行态语言，host/port 仍是唯一需要重启的 View 设置。
- 新增固定文案绕过 locale 或 Memory DSL 标签机制时，自动化静态门禁失败；品牌、结构标记和必要技术值使用最小允许清单。
- Reserved/Project System Memory 与 Skill 语义同步，受影响浏览器测试和完整回归通过。
- 第一至第三章教学流程及第三章评审体验流程使用中文用户术语，Artifact 统一展示为“运行产物”；canonical name、YAML 字段、命令和 ID 等机器契约保持不变。

## 实现范围

- 新增独立 zh-CN/en 资源、locale 解析、插值、复数、日期、安全序列化及 ACP 可见说明本地化。
- 迁移内嵌 View 静态模板与动态 DOM 文案，并补齐 Memory DSL 标签映射。
- Settings 保存成功后更新当前 View 运行态 language，重启判定只比较 host/port。
- 新增静态固定文案门禁，覆盖静态 HTML、DOM/ARIA/dialog、Settings helper、单/双/模板字面量与插值模板。
- 增加 locale、Settings、Memory/Schema、ChangeSet、Artifact Review 等真实浏览器和源码防回归测试。
- 同步中文化四份教学流程及其 Reserved System Memory 副本，统一“运行产物”等面向人的流程术语。

## 开发任务

- [x] 建立语言资源与运行时 locale 基础设施。
- [x] 完成 View 固定文案迁移和同进程语言切换。
- [x] 同步 System Memory 与 Skill。
- [x] 中文化第一至第三章教学流程及第三章评审体验流程。
- [x] 建立静态防漏门禁与反例测试。
- [x] 完成真实浏览器、定向测试和完整回归。
- [x] 完成研发、测试、架构多轮验收并处理全部阻断意见。

## 验收结果

- View 固定界面文案已集中到 zh-CN/en 语言资源；Memory DSL 展示偏好与 UI locale 保持独立，用户内容和技术标识保持原样。
- 成功保存 language 后同进程下一次加载立即生效；非法保存不改变运行态，只有 host/port 变化要求重启。
- 静态门禁与反例测试覆盖静态 HTML、动态 DOM、ARIA、dialog、Settings helper、单/双/模板字面量及插值模板；当前源码零违规。
- 真实浏览器验证覆盖中文 Schema 标签、ChangeSet 草稿元信息、Settings“存储”与 Artifact Review Agent retry 状态；手工 Playwright CLI 验证 zh-CN → English 同进程切换且控制台无错误。
- 第一至第三章教学流程与第三章评审体验流程已同步中文化，面向人的 Artifact 统一展示为“运行产物”；项目副本与 Reserved System Memory 副本完全一致，英文流程术语扫描零残留。
- 最终 `npm run test:ci`：490 项，489 通过、0 失败、1 项既有 Windows 平台条件跳过；`npm run typecheck`、`npm run build`、`git diff --check`、`node dist/cli.js validate` 均通过。
- 实现与验证成果在 Artifact Review `review-20260827-153932z-00ba1354` 第 5 轮由研发、测试、架构师全部投票通过，Runner 批准；此前各轮阻断意见均已修正并复验。
- 后续范围不包含新增语言、远端翻译平台、自动翻译或持久化每用户 UI locale；新增渲染入口时须同步扩展静态门禁。
