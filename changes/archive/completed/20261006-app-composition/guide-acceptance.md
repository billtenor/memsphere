# App 指南端到端验收

2026-10-06，按 `docs/app-guide.md` 和 `examples/apps/expense/README.md` 在全新环境实际执行。本文补充已有 Run 验证产物，不改写已冻结的评审材料。后续 Human 票与技术修正记录见文末。

## 验收环境与执行方式

- Linux、Node.js、Git、Chromium；使用 playwright-cli 操作正式 View Shell。
- 独立目录：`/tmp/memsphere-guide-e2e-fejhnlsr`。`MEMSPHERE_HOME`、npm 全局安装 prefix、App 发行目录、Project 和账本均在其中。
- 顺序执行 `npm test`，构建完成后执行 `npm pack --ignore-scripts`，再将生成的 tarball 用 `npm install --global --prefix <临时目录>/tools --offline` 安装。`--ignore-scripts` 避免对已经验证的产物再次构建；`--offline` 使用已有 npm 缓存。
- 安装包 SHA-256：`9068c03463c9ea1b6b9e4fd4f83afa7cc1cce1080312b2e5fa825b324a9114f1`。
- 后续命令使用安装后的 `memsphere`，在临时目录执行。费用 App 使用构建后复制出的完整 `expense-app` 目录，外部 CLI 按 README 从该目录安装。
- View 完全通过 `memsphere view restart/status/stop` 管理；没有调用内部服务构造函数，也没有以测试 API 代替页面交互。
- 指南中的用户工具目录替换为临时 prefix，账本占位路径替换为临时绝对路径；没有修改用户已有 Project 或服务。

## 按指南执行的结果

| 步骤 | 实际操作与证据 | 结果 |
| --- | --- | --- |
| 创建 Project | `memsphere project create my-project`，自动安装 System Memory | 通过 |
| 创建最小 App | 从指南 JSON/YAML 原文生成 `writing-app` 的两个文件 | 通过 |
| 安装、启用、发现入口 | `app install/enable/show`；安装后的 `enabled` 为 false，启用后读取 `concepts/example-writing-brief` | 通过 |
| 安装独立工具 | `npm install --global --prefix <临时工具目录> ./expense-app/cli`；`expense --version` 返回 `0.1.0` | 通过 |
| 配置并安装费用 App | 保存 `my-expense.json`，执行 `app install --config`、`app check`、`app enable`、`app show` | 通过 |
| Agent 发现业务上下文 | `memory read concepts/expense-app`；`cli show ... --app ... --output json` 返回 `expense`、固定 `--ledger` 参数和工作目录 | 通过 |
| 启动真实服务 | 首次 `view restart` 成功启动服务，`view status` 返回地址；直接打开 show 返回的费用页面路径 | 通过 |
| View 写、CLI 读 | 页面录入 `Guide browser lunch`、金额 `42.5`，点击提交；CLI list 查到相同记录，状态 submitted、revision 2 | 通过 |
| CLI 写、View 读 | CLI create `Guide CLI dinner`、金额 `18`；页面点击刷新后显示 draft；CLI submit 后重新打开页面显示 submitted | 通过 |
| 窄屏与键盘 | 390×844 下检查表单、记录和导航；从说明输入框按 Tab 到金额输入框 | 通过 |
| 停用即时门禁 | `app disable` 后，仍打开的页面点击刷新，显示 `App is disabled: org.memsphere.expense`，请求返回 409 | 通过 |
| 停用保留资产 | 停用后 `memory read` 成功，独立 CLI list 仍返回两笔已提交记录 | 通过 |
| 重启撤销入口 | 停用后 `view restart`，正式 Shell 中无费用导航 | 通过 |
| 再启用恢复 | `app enable`、`view restart` 后恢复费用页，两笔费用均为 submitted | 通过 |
| Project 隔离 | 创建 `other-project`，通过 Shell 选择器切换；无费用导航，CLI `app list` 返回空 apps 和 pending | 通过 |
| 清理 | 关闭浏览器，`view stop` 后 `view status` 确认 stopped | 通过 |

浏览器创建的记录 ID：`992ce264-11fb-48f1-bd1f-fccb670905ad`；CLI 创建的记录 ID：`a989ebf6-86f5-4ce0-ab9a-ec828cf20a3c`。两笔最终均为 revision 2、submitted，停用和重启没有改变记录。

正常操作未发现浏览器异常；停用负向验证产生一条预期的 HTTP 409 控制台错误。恢复后与 Project 切换页面控制台为 0 errors、0 warnings。验收脚本第一次调用 playwright-cli 的 run-code 时误用了参数形状，改为该工具要求的 `async (page)` 后重跑；该次错误发生在页面操作之前。

## 指南修正

本次补齐中英文指南和费用示例 README 的两个前置步骤：没有 Project 时执行 `memsphere project create my-project`；使用 `view status` 获取服务地址，再选择 Project 和费用导航，或拼接 `app show` 返回的页面路径。两步均已实际执行。

## 回归、证据与边界

- 本次完整回归：948 项，947 通过、0 失败、1 项 Windows 专用测试在 Linux 跳过。日志：`/tmp/app-guide-e2e-regression.log`。
- 安装阶段可复查脚本：`/tmp/app-guide-e2e.py`；命令和输出：验收目录中的 `commands.log`。
- CLI 证据：同目录下 `writing-installed.json`、`expense-shown.json`、`cli-shown.json`、`browser-written-records.json`、`cli-created-record.json`、`cli-submitted-record.json`、`disabled-records.json`、`other-apps.json`。
- 截图：同目录下 `desktop.png`、`mobile.png`、`disabled.png`、`restored.png`、`other-project.png`。本机临时证据未作为产品资产提交。
- 当前实现评审曾发现其他并行构建删除工作区 `dist` 导致测试子进程失败。本次先顺序完成全量测试，再安装固定 tarball 进行验收，结果不依赖之后的工作区构建。此结果证明该固定发行产物的流程通过，不证明仓库并行构建竞态已经修复；该意见仍须在技术评审中处置。
- 此次指南验收覆盖全新 Managed Project 的完整使用路径；Embedded 恢复、Mounted 只读和其他边界由专项及全量测试覆盖，不冒充此次手工指南路径。未执行 Windows 原生端到端验收。
- 本次仅修正文档，没有新增 Memory 修改。既有 Memory 校验记录：`change-20261005-031024825z-a1b5f8c3`，状态 valid，digest `e0bc7bb988a7ad5ae9626900a0919f5376b092355a46497c8c543bd6c53f73f5`，View 入口 `/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3`。

## Human 通过与评审问题修正

用户随后明确表示“好，我投验收通过”。已代提交至当前实现与验证 Review `review-20261006-101328z-113e901e`，Human approve，0 条附加 Comment；不自动将此票复制给后续交付评审。

新增 App 集成测试的 CLI 子进程已改为通过绝对 tsx loader 启动源码入口，不再读取可能被其他构建删除的 `dist/cli.js`。仍保留独立进程、Managed/Embedded 故障恢复和所有原有断言，发行包交付验证由上文打包安装后的真实端到端覆盖。

修正后再次全量回归：948 项，947 通过、0 失败、1 跳过（`/tmp/app-acceptance-final-tests.log`）。另将 `dist/cli.js` 临时移走，最小 App CLI 安装和两项中断恢复测试均通过，随后恢复入口（`/tmp/app-acceptance-no-dist-cli.log`）。typecheck、完整 build、Project validate、最终 ChangeSet validate 和 diff check 均通过，Memory digest 保持不变。

该修正解除本轮新增 App 测试的竞态，不代表仓库其他测试已支持任意并行重建；通用构建隔离仍可作为后续工程改进。
