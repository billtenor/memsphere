# 初始验证报告

依据本 Run 冻结的测试、开发、需求和交付 Statement，实际执行了当前最终候选的验证。详细命令、日志路径、SHA256 和关键源文件 SHA256 在 `verification-evidence.json`。

## 当前结果

- 受影响浏览器与 System Memory：`node --import tsx --test test/builtin-memory-view.test.ts test/reserved-store.test.ts`，16/16 通过。
- 类型检查：`npm run typecheck`，通过。
- 全量：`npm test`，141 个文件全部通过，1168 项通过、1 项跳过、0 失败，294.75s。
- `npm run build`：本轮 npm test 的 pretest 已对最终代码与 Memory 实际构建，通过。
- `memsphere validate`：通过；两份 memsphere-view System Memory 文件完全一致。
- `git diff --check`：通过。
- 真实 View 服务的 playwright-cli：30000 端口真实 Shell，Human 标记、展开/收起、390px 窄屏无溢出，通过；临时 ChangeSet 中 Full/Diff 切换与执行者评论入口打开/填入/取消，通过；console errors=0。
- 临时验收 ChangeSet `change-20261011-113701828z-5e5f5ab7` 已确认为 abandoned，Comment 数 0，不是本次交付 ChangeSet。

## 失败与环境区分

上一轮沙箱内 Chromium 不能启动；经自动审批允许在沙箱外执行后通过，不作为产品失败。

本轮新增中文测试首次用错误的按钮名“提交评论”，实际为“提交意见”，导致定位超时；修正测试定位后 16/16 通过。未改产品文案或删减断言。

真实 UI 清理时，按“readonly 后 plus DOM 消失”等待曾超时；既有只读内容会保留 plus DOM，业务状态判断应以 API 为准。亲自读取 API 确认临时记录 abandoned、0 Comment；不扩大本轮为既有只读 UI 行为调整。

## Memory 变更校验

最终内容执行 `memsphere memory change validate change-20261011-070405378z-c1dc8736` 通过。

- ID：`change-20261011-070405378z-c1dc8736`
- 状态：passed
- digest：`f9eec90090f2ec26735eac736d8f7b1a9f2b50ec01765b34428a1cf9141b8f00`
- View：`http://0.0.0.0:30000/projects/memsphere/changes/change-20261011-070405378z-c1dc8736`

## 未验证项

无本轮阻塞验证缺口。macOS/Windows 未做真人实机验收；无新增平台分支，已有当前 Linux 全量测试为实际证据。具名执行者、Run/CLI 变更、权限与持久化迁移不在本轮范围。
