# Graph 记忆与运行交互原型

独立 View Module，通过正式 Memsphere Shell、Router、Slot、Theme 和公共 UI 加载。固定示例数据用于需求讨论，不读取或推进真实 Run，不提交真实评审。

在「设置 → 界面与主题」安装本目录的绝对路径，并启用以下 Package 实例：

```json
{
  "id": "org.memsphere.procedure-graph.prototype",
  "version": "0.1.0",
  "enabled": true,
  "instance_id": "procedure-graph-prototype"
}
```

执行 `memsphere view restart` 后，侧栏「Graph 原型」进入本页。默认服务地址下的 memsphere Project 入口为：

http://localhost:30000/projects/memsphere/modules/procedure-graph-prototype

支持：定义/运行视角切换、节点详情、刚启动/待评审/已完成三种示例状态、循环两次执行、同一执行的 v1/v2 修订、只读评审展示、collect 成员、缩放与适配、窄屏布局及键盘操作。

原型在真实 Shell 中呈现，不重复模拟 Shell 的导航和顶栏。画布占满 Module 内容宽度，不保留右侧常驻详情栏；节点和边的详情按需显示为浮窗。样式只作用于 Module 内部，消费公开 Theme Token；无外部脚本和 Conversation Runtime 依赖。卸载该页面时移除本次 Mount 的 DOM 和局部交互。

本目录用于本轮原型评审，不代表正式 Memory 或 Run 模块已经完成可视化改造。

## 展示内容与模型字段

`fixtures.json` 只组织已有 Procedure、Run、Step、Artifact、Review 的样例记录，不增加业务字段。`src/index.js` 从这些记录渲染；`index.js` 是单文件 ESM bundle，SDK 保持 external。

| 展示内容 | 数据来源或确定规则 |
| --- | --- |
| 流程名称、说明 | `Procedure.names`、`Procedure.defines` |
| 节点标题、标识 | `Action.description`、`Action.id`；没有独立的节点 name |
| 普通依赖线 | `Action.dependencies[].from` |
| 条件入口及详情 | 存在 `Action.dependencies[].when` 时显示“条件”，详情逐字显示表达式；不翻译成“有剩余”等业务解释 |
| 收集关系虚线 | `Action.collect` |
| 执行者、产物要求、评审槽位 | `Action.actor`、`Action.artifact`、`Action.artifact.review` |
| 运行名称、运行状态 | `Run.name`、`Run.status`；初始运行仍是 running |
| Action 的执行次数、状态数量 | 按 `Step.source.actionId` 筛选 Step，再计数并按 `Step.status` 分组；不推测 Action 级等待原因 |
| 未有执行实例 | 上述 Step 数量为零，仅显示“0 次执行” |
| 输入、已采用产物、collect 成员 | `Step.inputs`、`Step.artifact.id`、`Step.artifact.items` |
| 产物名称、正文、修订说明 | `Artifact.name`、`Artifact.content.payload.content`、`Artifact.revisedSummary` |
| 版本序号 v1/v2 | 同一 Step 的 Artifact 按 `revisedFrom` 关系排序；“已采用”仅来自该 Step 的 `artifact.id` |
| 评审状态、投票、意见 | 按 `Review.artifactId` 精确关联后，显示 `Review.status`、`Review.vote.value`、`Review.comments[].body` |
| 运行定义快照 | 各样例的 `Run.memorySnapshot` 保存同一 Procedure 的有效 YAML；校验与展示所用定义一致 |

状态中文是已有枚举的固定翻译；“记忆定义”“运行实例”“查看”“关闭”“字段来源”等是界面文案，不是业务数据。坐标、缩放、选择、展开与样例切换属于展示状态。没有保存或求值条件命中历史，不为依赖边染色暗示实际走过哪条路径。

`START` 的展示翻译为“开始”，使用圆形节点；`from` 的界面标签为“来自”。定义值和字段来源仍保留原始标识。

## 边与条件的交互

连线及其“条件”标签共享同一边标识。悬停或键盘聚焦任一处，同时高亮连线、条件和两端节点；浮层展示端点及已有条件原文。点击任一处打开同一份边详情浮窗，包含来自、指向、条件；不保留点击选中高亮。节点悬停时高亮自身，移开即取消；边悬停高亮连线、条件与端点，移开也取消。关闭浮窗清除提示与高亮，焦点返回不会重新触发悬停提示。收集关系也可直接点击查看来源。

## 运行浮窗时机

| 操作 | 展示方式 |
| --- | --- |
| 点击 Action | 定义视角打开紧凑节点浮窗；运行视角直接打开统一内容/评审浮窗，顶部选择同一 Action 的执行实例 |
| 点击某次 Step | 打开统一运行浮窗，直接显示已采用产物或最新候选及其评审；执行时间和固定输入收在默认折叠的“执行信息”中 |
| 点击产物版本、查看产物按钮 | 打开产物浮窗，左侧正文与版本翻阅，右侧精确对应该 Artifact 的评审 |
| 点击执行输入、依赖产物或 collect 成员 | 在同一浮窗查看对应具体 Artifact，随内容显示其所属 Step 的执行信息，不设置独立执行详情页 |
| 上一版、下一版、版本选择 | 保持浮窗，正文与 Review 按同一 Artifact ID 同步切换 |
| 关闭或 Escape | 返回原节点，保持图的阅读位置，清除选择高亮 |

运行浮窗使用原生 dialog，视觉和布局参考现有自由探索的 `createContextGraph().open()`：桌面约占视口 90%，左右独立滚动；760px 及以下铺满，以内容/评审页签切换。原型阶段不修改正式自由探索组件；施工时可提取/复用其容器、版本栏和内容评审展示。

当前原型已通过真实 View 浏览器检查：条件与连线双向高亮、直接点线、边详情、执行浮窗、产物翻版与评审同步、collect 成员、窄屏页签、Escape 和关闭焦点恢复。

勾选“字段来源”后，详情浮窗会显示对应字段路径；业务值的悬停提示也提供来源。此功能用于原型审阅，不改变业务模型。

修改源码或 fixture 后执行：

```bash
node examples/view-packages/procedure-graph-prototype/build.mjs
memsphere view restart
```

构建脚本优先使用仓库依赖；当前 worktree 没有依赖时使用 PATH 中 Memsphere 安装位置的 esbuild。`--check` 可检查 bundle 与源码一致。

没有产物时，同一浮窗显示零产物空态和折叠执行信息；collect 在内容区显示固定成员引用，不创建虚构产物。执行与产物不再拆成两个页面，也没有“返回执行详情”入口。

浮窗布局：定义和边使用最长 700px 的紧凑居中窗口，正文独立滚动；运行内容使用自由探索风格的宽浮窗，顶部切换 Step，正文与评审双栏。窄屏中运行浮窗铺满并切换页签，紧凑浮窗保留小边距。所有跳转复用同一个原生 dialog，不叠加窗口。
