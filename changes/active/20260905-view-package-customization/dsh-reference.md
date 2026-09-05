# DeepSeek Harness 参考记录

## 固定参考

- 本地仓库：用户提供的 `github/deepseekharness` clone。
- 参考 commit：`cd5ef8148158c3a752a658978873241fdf8e2bbc`。
- 参考目的：验证“可组合界面包”如何获得稳定扩展点、确定性覆盖、失败让位、Theme 注册与分享基础。

## 采用

- Package 分层组合：安装与 Project 启用分离，同一包可在不同 Project 使用不同 composition。
- 稳定 cell identity：替换关系绑定公开展示边界，不绑定私有 DOM selector。
- 数值越小优先级越高；官方实现保留为低优先级 fallback。
- 候选运行失败后 abdicate，Runtime 选择下一候选，避免一个定制界面拖垮 Shell。
- Theme 作为结构化 token 注册与覆盖，不把换肤等同于复制整份全局 CSS。
- 包拥有稳定 id/version/source/dependency 元数据，为复制、分享、审查与官方收录保留基础。

## 适配后采用

- DSH 的自由组合进入 Memsphere 现有 ViewHost transaction/lifecycle，而非另建平行 Runtime。
- replacement priority 与现有 list `order` 分开；list 继续表示并列展示次序。
- 外部包首版只替换官方公开 presentation cell，不获得顶层 Route 与 Home entry。
- 全局样式不是无条件注入，必须经 Manifest + Home + Project 三层授权和静态安全检查。
- 跨 bundle Slot 不靠重复构造同名 token；由 owner 声明，dependency 向 Host resolve 真实 token 与 validator。
- 配置保存不热替换运行实例；进程启动快照保证一致性，显式重启后原子生效。

## 不采用

- 不引入 Cordis、React 或 DSH 自身包管理器。
- 不把本地包安装扩展成远程下载、Registry、自动升级或官方认证协议。
- 不把可信本地 JavaScript 描述为安全沙箱；本轮安全边界聚焦能力裁剪、CSS/资产服务和故障隔离。
- 不允许外部 renderer 接管 Memory/Run 业务状态机、Review 投票流程或私有 API/DOM。

## 可分享与官方化演进

本轮 Package 目录已经具备可复制边界：严格 Manifest、预编译 ESM、独立 CSS/资源、Theme source、贡献 identity 与 SemVer。未来可以在不改变 Project composition 基本语义的前提下增加来源签名、发布 Registry、审核报告、官方 badge、迁移说明和受控更新；“官方方案”是经过治理后改变来源与信任级别，不要求作者重写展示实现。
