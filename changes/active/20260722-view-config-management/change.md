---
id: 20260722-view-config-management
status: doing
type: feature
created: 2026-07-22
run_id: run-20260723-124143z-c1583a7f
---

# View 配置管理中心

## 需求

`.memsphere/config.json` 已包含存储目录、View 服务和 Review 参与者等配置，直接维护 JSON 的成本和误操作风险持续上升。View 需要提供一个稳定、完整的配置工作区，让操作者看清当前实际加载的配置，在结构化表单中完成修改，并在写入前检查校验结果和语义差异。

配置中心只维护当前 View 启动时加载的精确 `configPath`，继续使用单一 `config.json`，不拆分配置文件，也不建设 Secret、备份恢复或远程服务控制系统。

## 用户场景

- 操作者从 View 的稳定“设置”入口进入配置中心，立即看见当前配置文件、scope、磁盘 revision、运行 revision 和待重启状态。
- 操作者无需记忆 JSON 字段名，即可维护存储目录、View host/port、Runner 和 Human/Agent Actor。
- 操作者可以从系统 Permission Catalog 选择权限、理解权限含义，并在保存前发现未知或重复权限。
- 操作者配置 Agent 时只维护 Provider 与 Model；命令、参数、工作目录和超时由 Provider 管理，Prompt version 属于系统内部协议，不向配置中心暴露。
- 操作者点击“保存”后查看语义差异；磁盘文件已被其他进程修改时，页面不会覆盖较新版本。
- View 监听局域网地址时，匿名访问者不能读取或修改配置；持有本进程操作令牌的用户可以完成配置操作。

## 范围

### 信息架构

配置中心与 Memory、Task 同级，包含且只包含四个模块：

1. **概览**：只读展示配置文件、配置作用域、磁盘/运行 revision，以及已生效或待重启状态；不重复展示存储路径或完整配置，不提供重新读取和保存操作。
2. **存储**：`memoryRoot`、`reviewsRoot`、`runsRoot`、`archiveRoot`；同时展示原始值和解析后的绝对路径，可选目录可恢复系统默认。
3. **View 服务**：`view.host` 与 `view.port`；保存后仅提示手动执行 `memsphere view restart`，网页不提供 start/stop/restart 操作。
4. **参与者配置**：Runner 与 `control_plane.actors` 使用同一列表和权限编辑方式。Runner 不能删除；Human/Agent Actor 可新增、编辑和删除。

`debug` 不在界面展示或编辑，但保存其他配置时必须原样保留。

### 参与者配置

- Runner 使用单一 `permissions` 列表。
- Actor 支持 ID、`kind`、`name`、权限和可选 `system_prompt`。
- Agent Actor 在配置中心只额外展示 Provider 与 Model。
- `command`、`args`、`cwd`、`prompt_version` 和各类 timeout 属于 Provider 或 Memsphere 内部运行配置，不在参与者配置中展示，也不写入新的 Actor 配置。旧配置中的这些 Provider 运行字段可以读取，用户保存后规范化为 `provider + model`。
- Permission 只能从系统内置 Catalog 选择，并展示自然语言说明。
- 不区分直接权限与可授予权限，也不通过 Run Review 配置追加临时权限。`grantable_permissions` 已从当前配置语法移除，不提供兼容读取。
- `decision.challenge` 与 `decision.override` 暂不在配置中心展示；底层兼容能力不在本需求中删除。
- 不增加 Runner 的隐式权限，不在 UI 中引入 Identity、Role 或 Secret 模型。

### 校验与保存

- GET 返回当前配置的显式值、默认值、解析路径和 revision；不把默认值无意义地写回文件。
- 保存前调用服务端校验，使用与 CLI 相同的 config schema 和跨字段规则。
- 错误定位到配置路径，界面保留草稿；校验失败不得写文件。
- 点击“保存”后展示语义变更列表和 JSON diff，用户二次确认后才写入。
- 保存使用 revision 乐观锁。磁盘 revision 改变时返回冲突并要求重新读取。
- 写入采用同目录临时文件、fsync 和原子 rename；写入前后均检查 revision。
- 不提供备份、回滚或配置文件拆分。

### 生效语义

- View 进程保存启动时的 running revision，配置文件读取结果为 disk revision。
- 两者不一致时展示“待重启生效”；页面不宣称磁盘保存已经应用到运行进程。
- host/port 或其他配置保存后，由操作者手动执行 `memsphere view restart`。

### 安全边界

- 配置 API 固定操作当前 View 的 `configPath`，不接受任意路径。
- loopback View 可直接使用配置中心；非 loopback View 需要进程启动时生成的高熵操作令牌。
- 令牌只保存在 mode `0600` 的 View state 文件和浏览器 `sessionStorage`，不进入 `config.json`。
- 非 loopback GET 需要 Bearer token；POST/PUT 还必须使用 `application/json`，Origin 与 Host 完全匹配，且拒绝 cross-site 请求。
- 请求体设大小上限；响应不暴露未纳入配置中心的 debug 内容。

## 不做事项

- 不拆分 `config.json`。
- 不建设 Secret、凭据或环境变量管理。
- 不展示或编辑 `debug`。
- 不提供配置备份、回滚、远程同步或审计中心。
- 不在网页中启动、停止或重启 View。
- 不移动现有 Memory、Review、Run 或 Archive 数据。
- 不修改 Memory YAML syntax。

## 验收标准

- 设置入口稳定可见，四个模块在桌面和窄屏均无横向溢出或控件重叠。
- 页面准确展示当前 `configPath`、scope、运行/磁盘 revision、待重启状态、显式/默认语义和解析路径。
- 存储、View、Runner、Human/Agent Actor 可无损读取、编辑和保存；Agent 只编辑 Provider 与 Model，旧 Provider 运行字段在保存时收敛为 Provider 内置配置。
- Runner 与 Actor 使用一致的参与者和权限表达；Runner 删除键不可用。
- `debug` 不在页面/API 可编辑配置中出现，保存后磁盘原值保持不变。
- 非法字段和跨字段冲突返回具体路径，保留草稿，原配置字节不被修改。
- 每次写入前展示准确差异；未确认不写入；过期 revision 保存返回 409 且不覆盖外部修改。
- 写入采用原子替换；保存后正确区分“已保存”和“已生效”，需要时提示 `memsphere view restart`。
- 非 loopback 未授权读取/写入被拒绝；合法令牌和同源请求可以完成操作。
- 配置服务、权限校验、并发冲突、原子写入、View state 权限、浏览器脚本和响应式布局有自动化或浏览器验证。

## 技术与测试方案

- 新增独立 config-management service，负责精确来源、可编辑投影、默认语义、校验、diff、revision 和原子写入。
- View 暴露 `meta/get/validate/put` 四个 Settings API；写接口统一执行 JSON、Origin、Host、Fetch Site 和 body size 检查。
- 后台 View 对非 loopback 生成进程级 token，并通过私有 state 文件交给操作者。
- 浏览器使用四模块结构化表单、字段错误、确认页和 session token，不直接编辑原始 JSON。
- 使用 Node test 覆盖配置服务与 API，并用 Playwright 检查桌面/移动布局和核心交互。

## 开发任务

- [x] 配置服务、默认语义、跨字段校验、乐观锁与原子写入。
- [x] Settings API、非 loopback token 与同源写保护。
- [x] 四模块 Settings 工作区、参与者编辑、差异确认和生效提示。
- [x] 更新公开文档、System Memory 与 Skill。
- [x] 执行完整测试、Validate 和浏览器验收。

## 验收结果

进行中。
