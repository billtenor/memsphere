# 开发计划

Run run-20261019-144339z-278320f8；需求第二轮和方案第一轮均已获全部指定 Agent approve，Runner 已通过。

1. 保留已合并 master 的 DisclosureState 与双方测试，核对候选布局修复和章节 + hover 修复。
2. 恢复 active 且非 claimed 的 callback 注入和统一写入 UI 门禁；后端原有状态检查不变。
3. 用 Memory+anchor 定位原行卡片，复用侧栏卡片渲染及动作，正确处理标量 li、Schema grid、章节标题和 flow head；无锚点只在侧栏。删除强制展开逻辑，不增设折叠状态源。
4. 将新增组合测试拆成布局、评论同步、只读状态独立契约；适配 master 展开状态测试的正文/侧栏选择器，增加多条、跨 Memory/缺失锚点、编辑删除同步、折叠保留和视图切换覆盖。
5. 更新 memsphere-view reserved 源和开发副本，更新 Skill 冗余说明。保存受影响测试、Memory 校验和变更级有效 checkpoint。
6. 按后续 Run 步骤进行全量测试、真实 30000 Shell 操作、独立实现验收、交付报告与产品验收；通过后提交 commit/PR、跟踪 CI，不提前合入。

本轮只提交当前修复和记录，不提交 node_modules、运行时 Home 状态、凭据或其他任务内容。
