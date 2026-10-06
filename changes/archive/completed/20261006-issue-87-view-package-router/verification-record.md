# 验证执行记录

Run：run-20261006-142737z-c8d2dca6。方案第二轮通过后执行本记录中的正式验证。环境：Linux，Node v22.16.0。

## 命令与结果

1. `npm run typecheck`：退出 0，两份 tsconfig 类型检查通过。
2. `npm run build`：退出 0，TypeScript、内置模型检查、View bundle、示例 Package 一致性及 App 构建通过。
3. `node --import tsx --test --test-concurrency=1 test/view-*.test.ts test/builtin-memory-view.test.ts test/builtin-run-view.test.ts test/models-builtin-view-browser.test.ts test/models-view-slots-browser.test.ts test/settings-builtin-view-browser.test.ts test/app-install.test.ts`：退出 0，210 tests、210 passed、0 failed、0 skipped，TAP 耗时 171816.33306 ms。
4. `git diff --check`：退出 0。

开发阶段单独执行新增 Router 浏览器文件，五组通过；正式回归再次覆盖该文件及三种失败边界、路径拒绝矩阵、主题专用能力与 instance_id 校验。

## 证据对应

基线：`544eca6f4b28115a41808af6ef05b4e4e5e03e7c`。

最终代码/测试/双语文档共 11 个候选文件，按相对路径排序与文件 SHA-256 生成候选指纹：`b28037548f871d3184e4d3d38354cffe4c557aa209e8adebe48f218e412dd0a3`。详细文件哈希与日志哈希见同目录 verification-evidence.json。日志保留于 /tmp/issue87-formal-typecheck.log、/tmp/issue87-formal-build.log、/tmp/issue87-formal-regression.log、/tmp/issue87-formal-router.log。

上一轮对话的 208 项回归曾因英文指南未同步而有一项文档失败，并单独修正重跑；本正式流程结果为最终内容重新执行的 210/210，未把之前的混合结果冒充本轮成功。

## 未执行项

未执行全仓库所有测试，本次运行获批的相关 View、builtin、展示扩展、Project 切换与 App 回归。未实跑 Windows/macOS，未复验 Node 20（不受支持），未访问或测试 CRAA 私有业务 Package；当前证据覆盖公开接入契约，不声明私有业务端到端已通过。

本次没有 Memory 差异，不需要空 ChangeSet。未执行 commit、push、创建 PR 或关闭 issue。
