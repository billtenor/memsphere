# Playwright CLI 实操证据

使用正式构建 CLI 在独立 MEMSPHERE_HOME 创建 actor-ux-demo Managed Project，经正式 view start 启动 Shell： http://127.0.0.1:30219/projects/actor-ux-demo/settings/participants 。未修改真实用户项目配置。

playwright-cli 使用本机 Chromium（默认 Chrome 未安装，改为指向已安装 Chromium），实操全部通过：

- 名称清空/纯空白即时回退 person；有效名称显示正常。
- 保存、重载后名称仍为空，标题展示 person。
- Human 无系统提示词输入。
- Agent 填写并保存提示词后切为 Human，保存成功且重新加载仍不显示提示词。
- 再切回 Agent，先前提示词未被恢复。
- 1440×1000 与 390×844 窗口检查通过；窄屏无水平溢出。
- console：0 messages，0 errors，0 warnings。

截图：human-desktop.png、human-mobile.png。

正式 CLI 的 run start 预检也已验证名称回退：actor-ux-demo 中两个无名参与者列为 `{id: "bot", name: "bot"}` 与 `{id: "person", name: "person"}`，未提供 review-config，因此仅执行预检，未启动额外 Run。
实操后已关闭专用浏览器及隔离 View 服务。
