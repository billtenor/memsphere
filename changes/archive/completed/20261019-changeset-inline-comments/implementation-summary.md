# 功能实现摘要

## 最终行为与需求映射

- 差异行内 CSS 限定于 span.memory-commentable，新增 Schema/Statement 的 section 保持块级，Added hover 不改变文档几何布局。
- 章节 + 自 hover 保持显示，指针从标题到按钮后可实际点击。评论 callback 仅在 active 且非 claimed 时注入；completed/abandoned 和 claimed 隐藏新增、编辑、删除入口，后端状态门禁未修改。
- 从原侧栏渲染提取单条卡片，按当前 Memory reference/path 和 location.anchor（兼容 target）挂载原行副本；无锚点或其他 Memory 不错误挂载，侧栏保留完整记录。标量行、Schema 字段行、章节、flow head 使用语义位置，Composer 不再被整份新增文档吸到末尾。
- 原行和侧栏复用编辑/删除逻辑；同位置多条顺序保留。Schema grid 下评论和编辑器跨满列。
- 移除评论渲染中设置 details.open/section.open 的逻辑；单一采用 master DisclosureState。原行卡片随正文收起，不强制展开，切换侧栏和提交/编辑/删除均保持阅读选择。
- 对应 System Memory 源与当前 Project 副本同步，并更新 Skill 描述，明确双处展示、折叠优先级、无锚点退化及只读边界。

## 修改文件和关键代码路径

- modules/org.memsphere.memory/adapter/view/index.ts：评论 CSS、renderChangeDetail callback、renderComment、mountInlineComments、inlineCommentHost/insertInlineComment、mountInlineCommentComposer、canComment；保持 master DisclosureState 逻辑。
- test/builtin-memory-view.test.ts：保留 master 新测试；将 mixed disclosure 评论测试明确为侧栏/原行作用域并断言两处编辑删除同步和主动收起保持；新增布局/+、原行 Memory 隔离/多条/失配/视图切换、终态与 claimed 只读三个独立浏览器集成契约，复用最短 schema fixture。
- test/memory-changeset-collaboration.test.ts：completed comment 新增/编辑/删除继续被后端拒绝。
- reserved-memory/system-memory/concepts/memsphere-view.yaml、.memsphere/memory/concepts/memsphere-view.yaml：同内容新增评论展示约定；manifest 身份清单不变。
- src/skills/memsphere/SKILL.md：同步简要使用说明。
- changes/archive/completed/20261019-changeset-inline-comments/*：本轮契约、方案、任务和审计记录。

## 已执行验证

- npm run typecheck：通过。
- node --import tsx --test test/builtin-memory-view.test.ts test/memory-changeset-collaboration.test.ts test/memory-diff.test.ts test/disclosure-state.test.ts：35/35 通过。
- node --import tsx --test test/reserved-store.test.ts test/view-style-contract.test.ts test/view-global-style-contract.test.ts test/view-locales.test.ts：27/27 通过。
- node dist/cli.js validate：通过，scope=current Project Store。
- git diff --check：通过。

初次合并后调查测试 25/26，仅 mixed disclosure 测试因评论在两处出现导致无作用域选择器 strict violation；本轮已明确作用域并新增原行断言，不删除或弱化原先阅读状态断言，重新运行 35/35 通过。此为已修复的本轮适配，非环境阻塞。

## Memory 变更级证据

ChangeSet: change-20261019-145538606z-5db05ae5；校验 passed；Base=b8fa54c912afbc49bdd01e7bd33b5d935e46ca1c；Digest=ae7a2cf040b086915be9710853771f0082f5bd9cb8624b5e5de258209a8af348。
View: http://localhost:30000/projects/memsphere/changes/change-20261019-145538606z-5db05ae5
已同步的 reserved 源与开发副本内容一致。后续 Memory 修改会重新 validate，最终交付不复用过期证据。

## 行为与兼容性影响

新增正文评论显示和布局修复；不增加存储字段、语法、公共 Slot、权限或后端写入能力。保留已认领状态的既有前端评论门禁，避免夹带此前临时允许 completed/claimed 写入的试验。无 stable Tag 兼容迁移需求。

## 尚未执行项

最终 build、全量 npm test 和真实 30000 Shell 的 playwright-cli 操作已经完成。第二轮独立实现验收 Agent 评审、产品交付评审、commit、PR、CI 仍待推进，不声称已经完整交付。

## 实现验收第一轮修订

接纳测试 Agent 的结构章节折叠 blocking：insertInlineComment 的章节分支从 header.after 改为 section-body.prepend；章节 + 的显式点击展开目标以显示编辑器，已保存评论渲染不展开。新增 Saved section comments follow the section disclosure without hiding the sidebar record 回归。修订后受影响 35/35、全量 149 文件 1247 passed / 0 failed / 2 Windows-only skips、最终 build 和真实 Shell 复验均通过。第一轮冻结产物中的未执行项属于当时状态，最新验收以本地最终摘要、verification-report、implementation-review-revision 与 evidence/test-summary 为准。
