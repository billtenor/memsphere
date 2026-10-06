# bug 初始描述

用户在本对话中提供 GitHub issue https://github.com/billtenor/memsphere/issues/87，并要求处理该问题；随后明确要求按照 bug 修复流程执行。以下内容整理自该 issue，未要求用户重复提供已明确的初始描述。

标题：独立 View Package 无法注入 Router：外部扩展能力与 Module 文档不一致。

正式安装、校验、保存并启用可信本地 Package 后，Plugin 声明 inject: ["slots", "router", "theme", "ui"]，在 apply() 前失败，诊断为 `View Plugin requests service without an effective capability grant: router`。实际业务需要以独立前端 Module 提供种子初始化、爬虫配置、任务与进度，并使用公共 Shell、Slot、Theme 和 UI Primitives。

同环境请求 `/projects/<project>/modules/com.example.crawler/crawler/run` 返回 404。原报告明确：尚未在 Router 注入成功环境中独立确认该 404，服务端页面入口需另行核对。

期望明确正式外部 Package 能力边界。如果支持独立业务 Module，应通过公开契约声明并获得 Router，仅注册自身 Project / Module 实例命名空间内的页面。导航、列表对象选择、关联跳转、直达、刷新与前进/后退应一致。越界和冲突应明确拒绝，未安装、禁用及加载失败实例行为应明确，既有展示替换及 builtin 不应回归。不硬编码具体业务包，不无条件向所有包授权。

最小 Manifest 为 schemaVersion: 1、id: com.example.crawler、version: 0.1.0、view.entry: ./index.js、view.sdk: ^1.0.0。Plugin 注册路由 id: run、path: /crawler/run、query: [source]。最小示例只验证 Router 注入；实际业务另声明导航、Header、列表和正文贡献。

报告环境：Memsphere 0.1.5，源码 a6520b1618351e64bd8875bb6ad65b61a06164ee，Linux，Node 20.19.2，2026-10-06 稳定复现。仓库要求 Node >=22，修复需在受支持 Node 版本验证。

已知证据：src/commands/view.ts 的 externalViewInstances 服务白名单，src/view/view-runtime.ts 的 validateServices，docs/view-plugin-guide.md 的独立 Module 示例，Reference Module，及 isViewPagePath/服务端页面请求分支。
