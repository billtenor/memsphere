# App 实现契约

简体中文 | [English](./app-contract.en.md)

本文描述当前本地 App 实现。概念关系见 [App 整体设计](./app-design.md)，从空目录创建与安装见[使用指南](./app-guide.md)，完整业务代码见[费用 App](../examples/apps/expense/README.md)。

## 发行目录

`app.json` 使用严格 JSON，`schemaVersion: 1`；未知字段拒绝。`id` 是稳定机器身份，`name` 是展示名称，`version` 使用 SemVer，`description` 说明用途。路径相对发行根；包内路径相对所属包。禁止路径穿越、symlink 和特殊文件。安装缓存按整个发行目录内容摘要固定，使用者不能直接修改缓存。

| 字段 | 结构与含义 |
| --- | --- |
| `assets.memories` | `{key,path}[]`，自有 Memory YAML。四种 Memory 语法保持不变。 |
| `assets.viewPackages` | `{key,path}[]`，包含 `module.json` 的 View Package 目录。 |
| `assets.modelPackages` | `{key,path}[]`，包含 `model-package.json` 的模型包目录。 |
| `assets.cliDescriptors` | `{key,path}[]`，外部工具描述 JSON。登记不安装可执行程序。 |
| `assets.dataExtensions` | `{id,version,entry}[]`，可信 ESM 的 default export 使用既有 DataExtension 接口。 |
| `dependencies` | `{kind,id,version?}[]`；kind 为 app、viewPackage、modelPackage、dataExtension、cli 或 memory。version 为 SemVer range；Memory 使用规范逻辑引用。缺项由 check/enable 报告，不联网下载。 |
| `entrypoints.agent` | Memory 规范引用数组；Concept/Statement/Schema 用于阅读，Procedure 用于启动 Run。 |
| `entrypoints.view` | `{packageKey,instanceId,path?,config?}[]`；path 是以 `/` 开头的 Module 相对页面路径，用于 show 的使用入口。 |
| `configuration` | 配置的 JSON Schema 文件路径，安装/configure 时校验。 |
| `stores` | `{key,model,kind,factory,config}[]`，kind 为 DataStore 或 ValueStore；复用 DataManager StoreBinding。 |
| `cliBindings` | `{cli,args?,cwd?,env?}[]`，参数或环境值可以用单字段 `{configKey:"ledgerDirectory"}` 引用安装配置。 |
| `backend` | `{entry,operations}`；entry 是可信 ESM，operations 把操作名映射为 read 或 write。 |

模型和元模型 ID 均使用 `.json` 后缀，与 Project 模型规则一致；例如 `example/expense.json` 和 `json-schema/draft-07.json`。App 自有模型不允许通过通用 model update/delete 命令修改或删除。

Model Package 的必填字段为 `schemaVersion:1`、`id`、`name`、`version` 和 `models`；每个模型包含 `modelRef`、`metaModel`、`path`，可带 name、description、tags。可选 dependencies 为模型包 `{id,version?}[]`。定义使用现有 RuntimeFactory 解释，不新增业务模型 SDK。

配置中的单字段 `{configKey:"..."}` 也可用于 Store 和 View 实例配置。Store 的 directory 相对 Project 根解析；CLI 本机绑定中的相对路径相对 binding 文件解析。秘密使用宿主环境变量引用，不放入发行清单或配置示例。

## Project 安装和 Memory

`app install <directory> [--config <file>]` 先校验清单、路径、冲突和完整候选 Memory，再缓存内容并准备安装；成功后默认停用。相同内容及配置重复安装无变化，不同内容不会隐式升级。Memory 本地修改不会被重复安装覆盖。

本机缓存位于 Home 的 `apps/cache/<digest>`；Project 状态位于 `apps/<memory-root-digest>/state.json`。状态包含安装记录、归属、绑定和未完成操作。Embedded 的有效 worktree 是独立安装作用域，不能在另一 worktree 继续同一安装操作；主 worktree 不读取其他 worktree 未合入候选。首版不自动传播 worktree 安装配置。

安装在写入 Memory 前持久保存目标路径。Managed 使用 `app_install` ChangeSet 校验并发布，Embedded 将校验候选应用到当前 worktree，不自动提交 Git。最终一次原子 state 写入提交安装及归属。若发布后安装提交失败，普通 File/Git Provider 在解析 YAML 前过滤保留路径，已有 Memory 仍可读。`app list` 显示 pending；修复原因后以相同发行目录重试，不通过普通文件删除或手改 state 修复。未完成安装期间，其他 Memory checkpoint 校验要求先完成安装，避免把保留资产混入候选。

写入使用 Project App 锁；读路径不创建锁文件，而是在物化前后重读 state generation 和正式 Store revision，发生变化则重试，从而保持 Mounted 只读。状态损坏明确失败，不把未知归属降级成待组织 Memory。Mounted 写目标在缓存、锁和候选创建前拒绝。

归属按 App ID、assetKey 和登记路径关联；原始摘要与规范引用保留为安装依据，当前引用从 Memory 内容解析。内容编辑和规范名称变更保留归属；`app show` 返回当前引用。必需资产删除或跨路径移动拒绝。ChangeSet 的可选 `app_ownership` 附件参与 checkpoint 摘要，候选 Run 把 Memory 与归属一并冻结；Run 状态与已有内容清单随归档恢复，不按当前安装状态重建历史来源。

## CLI 描述和绑定

| 命令 | 行为 |
| --- | --- |
| `memsphere cli register <descriptor-file>` | 校验并登记；同一内容幂等，身份冲突拒绝。 |
| `memsphere cli bind <id> --binding <binding-file> [--app <id>]` | 保存当前 Project 独立绑定或指定 App 的局部覆盖。 |
| `memsphere cli list [--app <id>]` | 发现工具、来源及状态，不执行程序。 |
| `memsphere cli show <id> [--app <id>]` | 返回描述及 executable、args、cwd、env、envFrom；不执行帮助或业务命令。 |
| `memsphere cli check <id> [--app <id>]` | 显式检查程序、目录、声明环境/文件与版本；仅执行声明的版本探测。 |

这些命令及 App 命令均支持全局 `--project <name>` 和命令级 `--output text|json`。JSON 错误包含 code/message/details。检查不通过或无法确认返回非零状态，参数/描述格式错误返回 2。

描述必填 `schemaVersion:1`、id、name、description、command。command 是非空 argv 数组，如 `["expense"]` 或 `["node","tool.mjs"]`；help 是帮助参数数组，documentation 是说明地址或文本。requirements 可包含 env 数组、cwd boolean、files 数组及 version range。versionProbe 是 `{args:["--version"],format:"semver"}`，stdout 必须是单个 SemVer；无声明时不猜测版本协议。探测不拼 shell，超时 5 秒、总输出上限 64 KiB。

绑定使用 `schemaVersion:1`，可包含 executable、args、cwd、env、envFrom、files。args 加在 descriptor.command 后；App 清单已解析的固定参数由局部绑定保留，只有显式提供同字段才覆盖。configure 重新解析清单连接并保留本机显式覆盖。env 用于非敏感固定值，envFrom 把子进程变量名映射为宿主变量名，发现不展开凭据内容。

没有 `--app` 时优先使用显式独立 Project 绑定；存在 App 上下文而没有独立绑定时提示选择。App 绑定不会借用其他 App 或独立绑定。check 只保证已声明且实际检查的条件，不证明业务认证或网络权限。Agent 取得调用信息后直接执行外部程序。

## View 和后端

启用的 App 把 View 实例添加到对应 Project 的启动组合，保留 Home 主题与明确 Slot 选择。同一 View/Model Package 身份与内容可以共享，不同内容冲突。`main.view@1:route:<route-id>` 是包中声明自身页面的可移植 cell，由 Runtime 匹配该实例的实际 Route key；其他实例不能借此注册它的路由。

View Plugin 注入 `api` 后使用 `ctx.api.invoke(operation,input)`；只有 App 绑定的实例能取得该服务。请求固定发往 `/api/projects/<project>/apps/<app>/operations/<operation>`，宿主按 Project 解析安装和 Store，不接受调用者覆盖 App/Project 上下文。入口复用 View 的 same-origin JSON 和远程 operator token 检查，只接受 Manifest 声明的操作。可信代码不是安全沙箱。

backend default export 的 operations 各项为 `{kind,execute(ctx,input)}`，必须与 Manifest 完全匹配。ctx 提供 project、app、只读 config、signal 和 `getStore(key)`；只可通过该方法取得本 App 声明的 Store。类型由公开 `memsphere/app` 导出。独立 CLI 可直接使用公开 `memsphere/data` 与 `memsphere/data/extensions`，无需调用宿主 HTTP。

enable/configure/disable 改变持久配置；View 使用固定启动组合，需要重启应用界面变更。后端请求读取当前安装配置，停用立即拒绝新请求及新的 Procedure Run，已开始的业务调用不承诺自动回滚。Memory 仍可读，既有 Run 保留冻结内容，外部程序不受宿主启停控制。

首版仅支持可信本地发行，不提供远端下载、升级、卸载、已有 Memory 认领、通用执行网关或热替换。
