# 验证摘要

## 结论

Issue #87 的公开独立 View Package 接入缺口已形成候选修复：可信本地 Package 在 Manifest 显式声明 router.register 并启用实例后，可获得受 Project/instance 命名空间限定的 Router；服务端为其路径返回 Shell，支持直达与刷新。导航、Header、标准对象列表、正文、query 选择、关联跳转、back/forward 已经自动化验证。

普通 Package 不获取 App API 或 builtin 路由特权；仅选择主题不启用 Router。未安装、禁用、无能力声明、resolver/启动资源失败没有实例页面入口，返回 404。服务端入口成功但浏览器导入/注册失败或未知 route 时保留 Shell 内错误与诊断，失败事务没有路由残留。点段、编码分隔符、反斜杠、NUL 和非法编码明确拒绝。

## 流程与实现

正式 Run：run-20261006-142737z-c8d2dca6。bug 理解摘要由需求负责人和 Runner 通过；修复方案第一轮发现测试边界缺口，修订后第二轮获研发、测试及 Runner 通过。代码草案早于流程开始，已如实记录，并在审批后核对纳入候选，不伪装先审批后初次实现。

改动涉及 src/commands/view.ts、src/module/package-registry.ts、src/view/package-config.ts、src/view/view-runtime.ts，新增普通 Package 路由能力与入口及边界校验。补充 Router 浏览器测试、主题专用实例 capability 测试和实例 id 点段测试，同步中英文开发指南/API。

## 正式验证

Linux / Node v22.16.0：

- npm run typecheck：通过。
- npm run build：通过。
- 获批的 View、builtin Memory/Run/Models/Settings、展示扩展、Project 切换与 App 相关回归：210 tests，210 passed，0 failed，0 skipped。
- git diff --check：通过。

新增五组浏览器测试覆盖正式设置安装/校验/保存/启用/重启与快照隔离、导航及浏览器历史、缺失 entry、启动资源注册失败、浏览器导入失败和路由冲突/安全路径拒绝。既有展示替换、builtin 及 App 用例通过。

候选代码/测试/双语文档指纹：b28037548f871d3184e4d3d38354cffe4c557aa209e8adebe48f218e412dd0a3。基线、文件与日志 SHA-256 见 verification-evidence.json；正式命令及结果见 verification-record.md。验证后未继续修改这些候选文件。

## 限制与交付状态

未运行全仓库其他模块测试，按通过方案选择相关回归。Windows/macOS 未实跑；Node 20 不受支持，未复验；CRAA 私有业务 Package 未访问或测试，不能从公共契约验证推断私有爬虫业务已经验收。

无 Memory 修改，因此没有创建空 Memory ChangeSet。改动仍在当前工作区，尚未 commit/push、创建 PR 或改变 GitHub issue 状态。当前产物提交最终评审，须收齐研发、测试和需求负责人意见并完成 Runner 决策后，CLI 才能认定 Run 完成。
