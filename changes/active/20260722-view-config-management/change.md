---
id: 20260722-view-config-management
status: todo
type: feature
created: 2026-07-22
run_id: run-20260722-052625z-0d5f7c40
---

# View 配置管理面板

## 需求

随着存储路径、View 后台服务、调试开关、Identity、Role、Permission 和 Agent 运行参数陆续进入 `.memsphere/config.json`，直接编辑 JSON 已经难以维护，也无法直观 review 配置来源、默认值、字段关系和修改影响。

在 Memsphere View 中提供面向操作者的配置管理面板，让用户能够看清当前 View 实际加载的配置，在结构化表单中维护现有配置，保存前完成校验和差异确认，并清楚知道修改是否已经生效、是否需要重启 View。面板应降低日常配置成本，但不能把高风险配置写入变成匿名远程操作入口。

## 用户场景

- 用户进入配置面板后，能立即确认当前编辑的是项目/worktree 配置还是全局配置，以及对应的 `config.json` 和 scope 路径。
- 用户不需要记忆 JSON 字段名、枚举值和默认值，就能配置存储目录、View、调试、Identity、Role、Permission 和 Agent 运行参数。
- 用户新增或调整 Agent Reviewer 时，能通过表单完成 Identity 与 Role 配置，并在保存前发现非法 ID、缺少 `runner` Role、未知或重复 Permission、冲突超时参数等问题。
- 用户保存前能 review 本次修改；多人或多个进程同时修改配置时，不会静默覆盖较新的文件。
- 用户修改 host、port 或其他启动时配置后，能清楚选择仅保存或保存并重启，并能判断新配置是否真正生效。
- 配置写错或 View 重启失败时，用户能够看到可操作的错误，并恢复到最近一次可工作的配置。

## 范围

### 面板入口与信息架构

- View 提供稳定、易发现的“配置 / Settings”入口，进入独立配置页面或等价的完整工作区，不把复杂表单塞入 Memory、Task 或 Artifact Review 侧栏。
- 面板按“存储”“View 服务”“调试”“身份”“角色与权限”等领域分组；组内使用适合字段语义的输入控件，而不是直接暴露一整块可编辑 JSON。
- 界面文案跟随 View 当前语言；字段 ID、命令、路径和枚举值保留原始字面值，并提供中文/英文说明。
- 提供只读的规范化 JSON 预览，便于复制和人工 review；第一版不把原始 JSON 编辑器作为主要编辑入口。

### 配置来源与值语义

- 显示当前 View 启动时加载的 `configPath`、scope root 和配置 revision；只编辑这份配置，不隐式切换到全局或其他 worktree 配置。
- 区分“文件中显式配置的值”和“系统默认值”，可将可选项恢复为默认状态，不能因为打开并保存面板就把所有默认值无意义地写回文件。
- 路径字段同时显示原始配置值和基于当前 scope 解析后的绝对路径，明确相对路径、`~` 与绝对路径的含义。
- 保存和重新加载后，配置的业务语义必须与 CLI 通过 `readConfigAt` 读取的结果一致。

### 结构化编辑能力

- 支持维护当前 config schema 中的全部用户配置：
  - `memoryRoot`、`reviewsRoot`、`runsRoot`、`archiveRoot`。
  - `view.host`、`view.port`。
  - `debug.agent_review`。
  - `control_plane.identities` 中 Human/Agent Identity 的 ID、名称和对应字段。
  - Agent 的 provider、command、args、cwd、model、prompt version、startup/idle/max runtime 等参数；`max_runtime_ms` 未配置或为 `null` 时明确展示为无限运行。
  - `control_plane.roles` 中 Role ID、名称、permissions、grantable permissions 和可选 system prompt。
- Identity 和非保留 Role 支持新增、编辑、删除；删除或修改 ID 时必须展示影响，并阻止保存明显失效的引用。
- `runner` Role 是系统保留项，允许编辑合法字段但不能删除或改名为其他 ID。
- Permission 只能从系统内置 Catalog 选择，并显示自然语言说明；不能输入或保存未知 Permission，也不能在基础权限和可授予权限中重复配置。
- 动态列表提供稳定的增删、排序和空值处理，键盘操作与窄屏布局可用，不因长路径、命令或 system prompt 造成内容重叠。

### 校验、Review 与保存

- 编辑过程提供就近的字段校验；保存前必须在服务端使用与 CLI 相同的 config schema 做完整校验和跨字段校验，前端校验不能替代服务端校验。
- 错误信息定位到具体配置路径和控件，并保留用户草稿；校验失败时不得改写现有 `config.json`。
- 保存前展示语义化修改摘要和 JSON diff，至少明确新增、删除、修改、恢复默认和需要重启的配置；用户确认后才写入。
- 加载配置时记录 revision。保存时执行乐观并发检查；若磁盘文件已被其他进程修改，阻止覆盖，并提供重新加载及比较入口。
- 写入使用临时文件和原子替换，避免进程中断留下半份 JSON；覆盖前至少保留一个可恢复的上一版本，并在面板中提供明确的恢复动作。
- 配置保存、恢复和重启操作返回明确结果，不把“文件已保存”误报成“运行中服务已应用”。

### 生效与 View 重启

- 面板明确标记当前运行配置 revision、磁盘最新 revision 和是否存在待生效修改。当前 View 进程仍使用启动时配置时，应显示“待重启”。
- 用户可以选择“保存”或“保存并重启 View”。重启期间页面展示连接状态并自动尝试恢复连接。
- host 或 port 改变时，重启前展示新访问地址和影响；重启成功后引导到新地址，不能在旧地址无提示地失联。
- 新配置导致端口占用、进程启动失败或健康检查失败时，不得留下含糊的成功状态；应给出原因，并允许恢复上一配置和原有 View 服务。

### 安全边界

- 配置写接口只能修改当前 View 已加载的精确 `configPath`，不能接受任意文件路径，也不能演变为通用文件读写接口。
- 由于 Agent `command`、`args` 和 `cwd` 会影响本机进程执行，当 View 监听非 loopback 地址时，查看敏感配置、保存、恢复和重启必须经过明确的操作者授权；不得向局域网匿名访客开放写能力。
- 授权机制必须适用于当前局域网访问方式，不能简单依赖请求来源 IP；具体凭据和会话方案在技术设计阶段确定。
- 写请求具备基本的来源校验、请求大小限制和审计信息；错误响应、日志和 diff 不泄露未来可能进入配置的敏感值。

## 不做事项

- 不自动移动或复制 `memoryRoot`、`reviewsRoot`、`runsRoot`、`archiveRoot` 中的现有数据；修改路径只改变配置指向，并在界面提示影响。
- 不在本面板编辑 Memory 中的 `role_bindings`、`permission_grants`、Procedure 或 Artifact Contract。
- 不允许用户自定义系统 Permission Catalog 或 Decision Policy Catalog。
- 不建设通用文件浏览器、任意 JSON 编辑器或多文件配置中心。
- 不负责修复已经导致 View 无法启动的损坏配置；此时仍通过 CLI 或文本编辑恢复。
- 不在第一版引入多级审批、远程配置同步或云端密钥管理。

## 验收标准

- 从项目/worktree 启动 View 后，配置面板准确展示当前 `configPath`、scope、运行中 revision、磁盘 revision、显式值、默认值和路径解析结果；不会误编辑全局配置。
- 面板能够无损读取、编辑并保存当前 schema 的全部配置字段；保存后 `readConfigAt` 的结果与面板确认内容一致，未修改字段和可选字段语义不丢失。
- Human/Agent Identity、Role 和 Permission 的增删改可完成；保留 `runner`、ID 规则、Catalog 选择、重复 Permission、grantable 冲突及 Agent timeout 组合均按现有 schema 正确校验。
- 任一非法字段或联合约束失败时，界面定位错误并保留草稿，磁盘配置字节不被修改。
- 每次保存前都能看到准确的修改摘要与 diff；未确认不会写入。磁盘配置 revision 变化时，旧页面保存被拒绝，不会覆盖外部修改。
- 保存采用原子替换并保留可恢复上一版本；模拟写入中断后，原配置仍可读取，恢复后 CLI 与 View 都能加载恢复版本。
- 保存后界面正确区分“已保存”和“已生效”。需要重启时显示待重启；保存并重启成功后展示新的运行 revision 和地址。
- 模拟端口占用或启动失败时，界面不报告成功，能够展示原因并恢复上一配置及可访问的 View 服务。
- View 监听 `0.0.0.0` 时，未授权请求不能读取受保护配置、保存、恢复或重启；授权操作者可以完成完整流程，且接口不能写入 `configPath` 之外的文件。
- 配置 API、config schema、并发冲突、原子写入/恢复、View 重启失败和权限边界有自动化测试；现有 Memory、Task、Artifact Review、归档与 View 后台服务回归通过。
- 桌面和窄屏下表单、diff、错误提示及重启状态不重叠、不横向溢出，长路径、命令和 system prompt 可完整查看和编辑。

## 关联需求

- 强关联：`20260720-artifact-review-control-plane`，其 Identity、Role、Permission 与 Agent 配置是本面板的主要复杂配置来源。
- 复用现有能力：View 后台服务的 start/stop/restart/status 与 `config.json` 中的 host/port 配置。
- 重复需求：无。

## 技术与测试方案

待开发前补充。

## 开发任务

尚未开始。

## 验收结果

尚未开始。
