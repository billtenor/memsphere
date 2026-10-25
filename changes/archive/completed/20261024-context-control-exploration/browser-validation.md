# 真实 View 浏览器验收

由 Human 明确授权使用 Playwright CLI。测试对象为独立临时 Project 的真实五模型 Store 数据，URL 为现有 `/projects/test-project/tasks/:runId`，未使用原型固定数组作为数据源。

| 操作 | 实际观察 |
| --- | --- |
| 打开真实 Run | 默认需求/方案/验证三节点，名称和标签来自实际 Artifact；标题只有一份名称和状态 |
| 点击方案节点 | 打开左正文、右评论的浮窗，Markdown 使用现有安全渲染，展示当前Artifact的评论 |
| 上一版 | 同一 dialog 实例保持 open；正文切到中间方案，背后图为需求+方案两节点，无下游不展示 |
| 下一版 | 同一 dialog 实例保持 open；最新正文和评论恢复，背后图回到三节点 |
| 390×844 | 浮窗 x=0,y=0,width=390,height=844；点击评审后评审可见，内容区隐藏 |
| Console | 错误0、警告0 |

另有自动化真实浏览器集成测试覆盖图上历史只切图、点击才开浮窗、同一浮窗内版本切换、窄屏与Escape关闭；由全量测试记录最终结果。

测试 fixture 在 /tmp，真实数据与生产 Run 隔离。浏览器操作日志由 playwright-cli 保存，未把测试数据写入当前生产 Project。
