# 实现验收第二轮修订摘要

接纳第一轮测试 Agent 的 blocking：结构章节锚点的评论原本使用 header.after 插入，位于 body 外，收起章节后仍可见。现改为 section-body.prepend，保存评论与编辑器均处于目标章节的既有折叠控制之下；不增加第二套状态管理，不渲染时强制展开。

为保持在已收起章节上点击 + 仍能使用，只有用户主动打开该章节评论编辑器的事件显式展开目标章节；这是一次明确的编辑器打开动作，之后保存在 master DisclosureState。保存、编辑、删除、侧栏重渲染和已有评论挂载不会自动展开。此行为与契约“保存/编辑/删除不重置阅读结构”一致，不降低折叠验收标准。

新增浏览器回归 Saved section comments follow the section disclosure without hiding the sidebar record：先收起章节后点击 +，编辑器可见；保存后主动收起，原行卡隐藏且侧栏可读；重渲染仍收起；重新展开立即显示。受影响 35/35 通过，reserved/style/locale 27/27、typecheck 通过。全量最终重跑结果在最终验收材料和 test-summary.json 中更新，不复用第一轮 1246 passed 作为第二轮结论。

真实最终 30000 Shell 对第二个隔离 ChangeSet 重新执行完整评论流程和该结构折叠反例，全部通过，截图已替换为最终版本；再次 publish 后 completed 的 + 和修改入口均为 0，已有章节评论可读。

System Memory 源/副本与 Skill 同步，原 ChangeSet ID 不变：change-20261019-145538606z-5db05ae5，最终 digest 更新为 ae7a2cf040b086915be9710853771f0082f5bd9cb8624b5e5de258209a8af348；校验 passed。最终材料重新附源 SHA，明确第一轮结果与修订结果的区别。
