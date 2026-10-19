# 实现与验证验收材料 · 第二轮

Run：run-20261019-033517z-efbcea22。
本候选自包含最终实现摘要、最终验证报告及实现文件哈希；当前实现与该候选一致。

## 第一轮问题及修订
上一轮 Submission 后，Runner 又修复合法点号 Actor ID 的表单路径解析，并完成新增浏览器测试及全量复验，却未将这些变更和最新计数重新冻结进正式材料。接受三位 Reviewer 的意见，本轮将全部最终成果纳入同一候选：73/73 受影响测试、146 文件全量成功、1224 passed、1 个平台 skip。功能范围不变，无代码/Memory 新变更。

已接纳的 flow[4]/flow[5] 是较早状态的历史 Artifact，不能改写；本候选内下方两份完整修订文档是本轮最终实现和验证的明确更新依据，不能再用历史 72 项/1223 passed 作为当前结论。请将本候选、此前已确认需求/方案、实际 Workspace 完整改动一并审查。

跨平台风险接受为后续 PR CI 硬门禁，不把 Linux 唯一 Windows skip 计为跨平台通过。

# 最终功能实现摘要

Run：run-20261019-033517z-efbcea22。
基准：第二轮已通过的需求契约及已通过的实施方案，功能范围不变。
采用：memsphere-repository-development-rules，以及 requirement/testing/delivery 规范。

## 实现与需求映射
- src/control-plane/schema.ts：Human/Agent 的 name 可省略或空白，保留原有 trim 规则，在 resolveActor(actorId, ...) 统一回退为 ID，下游运行态 name 仍为非空字符串。Human strict schema 禁止 system_prompt，包括显式空字符串和纯空白；Agent 提示词仍可省略、显式空白无效。
- modules/org.memsphere.settings/adapter/view/settings-view.ts：名称选填提示、清空后删除 name、标题即时回退 ID，保留编辑焦点；Human 不渲染提示词输入，Agent 切为 Human 删除 agent/system_prompt，切回不恢复旧提示词。新参与者不预填名称；原始 Provider 引用名称也回退 ID。
- 上轮 Submission 后补充的边界：合法 Actor ID 可以包含点号，原有 path.split('.') 会把 ID 与属性混淆，影响本轮清空名称及类型切换。现按最后一个点号拆分属性，保留完整 ID；实时标题更新同样提取完整 ID。新增 person.dotted 真实浏览器用例，覆盖清名、切换、提示词清理、保存和重载。
- src/commands/view.ts：Provider 引用使用原始配置，另行对空白名称回退 ID，覆盖未经过运行态解析的显示入口。
- src/view/locales/zh-CN.ts、en.ts：选填及 ID 回退双语文案。
- 新 Run 预检、Binding、Snapshot、Review Assignment、Prompt 与 View actorNames 消费解析后的非空名称。产品代码未修改旧快照 schema 或批量迁移历史 Run。

## 验证与说明修改
- test/control-plane.test.ts：缺名/空串/空白回退及 snapshot→Assignment 联动；有效名称 trim；非字符串拒绝；Human prompt 禁止、Agent 原规则、历史 snapshot 只读兼容。
- test/view-settings.test.ts：真实设置 API 保存无名参与者、Provider 引用回退，以及非法 Human prompt 校验/保存拒绝且磁盘不变。
- test/view-settings-browser.test.ts：名称编辑/保存重载、Human 禁填、类型切换清理、窄屏/pageerror，以及新增点号 ID 回归。
- test/run-command.test.ts：已有输出测试的 Human 新配置 fixture 去除被禁止字段，原断言未弱化。
- Actor/Framework System Memory 的 reserved-memory 源与当前 .memsphere/memory 副本同步；src/skills/memsphere/SKILL.md 同步。README 无对应冗余说明，不需修改；未新增/重命名 Memory，manifest 不需修改。

## 最终验证
六个受影响文件共 73/73 通过；最终全量 146 文件成功，1224 passed、0 failed、1 个 Windows 专用测试在 Linux 跳过。typecheck、build、Store validate、ChangeSet validate、diff check 通过。
正式 CLI 创建隔离 Project，以正式 View Shell 完成 playwright-cli 实操；名称回退、类型切换、提示词禁止/清理、保存重载、切回不恢复旧值通过；1440×1000、390×844 截图及 console 0 error/0 warning 见 evidence/。
上述验证包括最后补充的点号 ID 修复；本轮只更新材料，不修改实现代码、测试代码或 Memory。

## 兼容性与剩余事项
无适用 stable Tag，不承担旧 Human system_prompt 原始配置兼容；新配置明确拒绝，不静默迁移磁盘；历史快照只读兼容仍受测试保护。
Windows/macOS 实机验证尚未完成，后续必须通过适用 PR CI。产品最终验收、归档、commit、PR、CI 尚待流程后续步骤，不宣称已交付。
当前 Run 四位 Agent 的 5 分钟空闲超时为用户明确授权的本次运行操作，单独有备份/校验/审计记录，不是产品代码的历史快照迁移功能。

## Memory 最终凭据
ChangeSet：change-20261019-060004472z-18cf913a；passed。
Digest：6c81209fe21a50b2562ccbc7e23462b08ba59310ca1a0650db9cd24f180fbee7。
View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261019-060004472z-18cf913a。

---

# 最终验证报告（供实现验收第二轮使用）

Run：run-20261019-033517z-efbcea22。
采用：memsphere-repository-testing-rules 和已确认实施方案。
本报告明确包含上一轮 Submission 之后完成的点号 Actor ID 修复与复验，替代旧计数作为当前实现验收依据；旧 flow[4]/flow[5] Artifact 保留为历史状态，不改写。

## 最终实际验证
| 检查 | 结果与证据 |
| --- | --- |
| npm run typecheck | 通过；/tmp/actor-ux-typecheck.log |
| npm run build | 通过；最终 npm test 的 pretest 也再次构建/typecheck 成功 |
| control-plane、view-settings、view-settings-browser、run-command、reserved-store、artifact-review 六文件 | 73/73 通过、0 失败、0 跳过；/tmp/actor-ux-focused-final.log |
| npm test -- --test-concurrency=4 | 146/146 文件成功，1224 passed、0 failed、1 skipped，186.36s；/tmp/actor-ux-full-test-final.log |
| 正式 Shell playwright-cli | 通过；evidence/playwright.md、human-desktop.png、human-mobile.png；console 0 error/0 warning |
| memsphere validate | passed；当前 Project Store 健康 |
| memsphere memory change validate change-20261019-060004472z-18cf913a | passed；重新提交前再次确认最终内容一致 |
| git diff --check | 通过 |

全量唯一 skip 是既有“Windows PowerShell, CMD, and Git Bash execute Agent Review read, comment, and vote commands”，不适用于当前 Linux，未修改其 skip 条件。Windows/macOS 验证留待后续远端适用 CI，不能表述为已经完成。

## 验收标准映射
1. 名称缺失、空字符串、纯空白均可解析，设置保存/重载有效；配置→快照→Assignment 使用 ID；有效名称继续原有 trim；非字符串拒绝。
2. 设置标题即时回退 ID，Provider 原始配置引用回退 ID；正式 CLI 的 Run 预检也展示无名 bot/person 的 ID。
3. Human 省略 prompt 时成功，显式 prompt 有值、空串、空白均在 validate/save 拒绝，磁盘原文保持不变；Agent 的可选性及空白校验保持原规则。
4. Agent 写入并保存 prompt 后切为 Human：输入项移除且磁盘字段删除；重载合法，切回 Agent 不恢复旧值。名称和类型编辑支持完整的合法点号 ID。
5. 点号 ID 修复后的新增浏览器用例“Settings edits an unnamed Actor with a dotted ID without losing its draft”实际通过，包含清名、类型切换、提示词清理、保存重载。
6. 真实浏览器窄屏无水平溢出，桌面布局正常，pageerror/console 无错误；旧历史 snapshot 只读兼容受测试保护。
7. System Memory 源与当前副本一致，Skill 同步；Reserved Store 测试及最终 Memory 校验通过。

## 修正、未执行项与独立复核
- 曾出现的 locale 插入位置、测试前置权限及写入 URL 作用域错误均已修正；最终构建和以上测试通过，无未修复的本轮测试失败。
- 最后一次实现变更是点号 ID 路径修复，此后已运行上述 73 项和完整 146 文件全量；当前第二轮仅修订文档和冻结证据，不修改代码/Memory。
- 第一轮三位 Reviewer 亲自检查最新代码并独立复跑测试：研发、架构各复跑六文件 73 项；测试复跑设置浏览器、配置测试及 typecheck/diff check，后续也确认六文件 73 项通过。它们要求修改的是正式候选冻结证据落后，未报告当前代码测试失败；这不替代本轮继续独立复核。
- Provider 先前无输出导致的超时已有审计；最新 Attempt 4 已恢复活动并提交正式意见，环境阻塞解除。当前等待修订材料的实现验收，不再要求 Human 处理 Provider。
- 产品最终验收、需求归档、commit/PR、远端 CI 尚未进行；当前不宣称完整交付。

## 最终 Memory 凭据
ChangeSet：change-20261019-060004472z-18cf913a；passed。
Digest：6c81209fe21a50b2562ccbc7e23462b08ba59310ca1a0650db9cd24f180fbee7。
View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261019-060004472z-18cf913a。
Base Revision：fb5f64d2aded3d3d912d6612df8e903fe575e56b。

---

# 最终实现文件快照

以下为新一轮提交前的实际实现（代码、测试、Memory、Skill）字节哈希，不包含会继续记录流程进度的 changes 文档。提交后不再改动这些实现文件；若发现新问题必须修订、重验并再报。

| 文件 | SHA-256 |
| --- | --- |
| .memsphere/memory/concepts/memsphere-actor.yaml | c2124c008400c20bb61d86c90075a560ee56a52c6cf3601e1ee09cddc28fdea2 |
| .memsphere/memory/concepts/memsphere-framework.yaml | ba6a0e14d39743c3fcbb2127815ad64a846efd56f8e778b89002f4f94c2d6b70 |
| modules/org.memsphere.settings/adapter/view/settings-view.ts | bb6c41fd2a9c8aca340e919cdff56f49b6e5931c286ca09253999b89efef0493 |
| reserved-memory/system-memory/concepts/memsphere-actor.yaml | c2124c008400c20bb61d86c90075a560ee56a52c6cf3601e1ee09cddc28fdea2 |
| reserved-memory/system-memory/concepts/memsphere-framework.yaml | ba6a0e14d39743c3fcbb2127815ad64a846efd56f8e778b89002f4f94c2d6b70 |
| src/commands/view.ts | 531c8b8201f8b87e9ec9602f9b48a32d684f81f37674b16de2948d09c172f70c |
| src/control-plane/schema.ts | 49dbd87af579724425fbc3a0c4bb9d60f640c5968a6f6b47a25ddd35f81b637f |
| src/skills/memsphere/SKILL.md | 7ac1cb4a1fa30f06119c9070c8853fd8605710c19594002e1cdb7c724c2541de |
| src/view/locales/en.ts | dd81e7d4d06d588d18757adf740108c463e934d7e576811617b916df6cae9e7d |
| src/view/locales/zh-CN.ts | c212fdc77492c2bddbe662624bd27a4ff59af56815c9dfede3863f0c5818b344 |
| test/control-plane.test.ts | fd489503123a803e02fd9d2ff8fa247b37500e06204a00efb84c106296772100 |
| test/run-command.test.ts | 9a3f99e86d0c425e104faea315bc9593a3bd509fdca59b51ad330b274436985f |
| test/view-settings-browser.test.ts | 4d0d77501a1ec295d1bed2eecf6773a2cd3058062b8ef4e600b8b01a41bcf5e4 |
| test/view-settings.test.ts | 8e72fc1b34c71a689011e3fc1eaa8c18c901bb6be02a860241739a8d9247a648 |

Git base：fb5f64d2aded3d3d912d6612df8e903fe575e56b。
实现 diff SHA-256：a772fd30e900acf3873eb1f5b83f96551ed820041f4c6817237fce96e3a99ad3。

验收通过后，下一步为产品负责人（Human + 产品 Agent）评审交付报告；通过后才按流程归档、提交 commit/PR 并跟进全部适用 CI。
