# Issue #137：App 配置与开发者设置界面实施方案

本方案把已确认的“设置 → App 配置 → 每App独立页面”接到真实安装配置上，并通过现有View框架的Slot开放配置内容扩展：框架负责设置界面样式、配置状态与保存，App代码提供自己的配置内容与交互。现有共享业务Store实现保留，不重写来源保护或持锁协议。

## 依据与当前阶段

- 已批准需求：`artifact-a3481475-d277-44c6-8496-c22a46e332a6`，需求Step `step-6a225e17-b890-4de8-92b4-94d00ca1d8ee`，round `round-b4b9e41c-8f5b-4fb5-b6e8-a088fd6e871c`。产品Agent、Runner和Human均通过；Human assignment `review-09575983ffee363d8600ffa7b861026b`，actor5，本次授权原文“我投通过，继续技术方案吧。记得确认一下，我是否额外参与了架构师的角色”。这是需求批准，不替代本技术方案批准。
- 原始新增需求及原范围、历史确认分别由需求Artifact已绑定的External固定。Reviewer通过当前Step固定requirements输入及其确认读取，不依赖本文摘要代替批准依据，也不按同Action最新产物选择。
- 当前源码HEAD `d3d993b34b3f18c3b697cb048103bd544621412e`。上轮源码调查fetch时的目标master为`8f7888f5add01d0bdad7147bd39c20ba9328b5e7`，尚未合入当前分支。当时新增主干为#152敏捷流程CI分界及#154产物展开箭头修正；与下面调查的App、View设置模块、Host路由和配置实现文件没有差异。实施先保护当前原型和需求文档，再同步目标分支并检查实际冲突，不能沿用旧技术验收当新GUI验收。
- 工作区已有用户要求的可点击原型：Settings模块App菜单、独立配置页、浏览器本地示例数据及路由query授权。用户已确认原型方向并将名称改为“App 配置”。这些文件尚未提交，作为视觉和动线基础保留，正式产品替换示例数据与localStorage保存，不把原型当真实配置能力。
- 本Step只形成方案。扩展接口以下为待本轮架构评审的明确设计，未声称已实现；不改变已批准需求范围。

## 固定源码原文与独立核验入口

本版直接依赖固定源码External `external-474c7ebb-a96b-4c9e-ada7-962439f32590`，不是仅提供调查结论：内容为JSON源码包，revision=d3d993b34b3f18c3b697cb048103bd544621412e，82个完整原始文件、路径索引及每文件Git blob ID/SHA-256。源码包整体SHA-256为`4d3705c089341545222d29e5c6291631696403c2fa770c2a33b03b7b75a3f05f`。

快照逐文件由`git show <固定revision>:<path>`导出，覆盖src/app全部、src/module全部、src/view全部、commands/view.ts、Project解析/共享锁、原Settings模块和本方案列出的App/Settings/View相关测试/构建入口。**不混入未提交原型或未来代码，不把源码存在当测试已通过。** 文件index与selectionNotes可帮助按检查目标选择读取，不要求Reviewer整包打印；不存在的可选src/view-assets.ts明确记为absent，不是本方案依赖文件。

受限Reviewer先从当前assignment的固定依赖读取该External，通过本Attempt注入的`MEMSPHERE_CLI`原生external show导出到Attempt内新文件，再用本地JSON工具按`files["src/app/install.ts"].content`等路径查阅完整正文及hash。无需访问Runner工作区、访问Git网络或调用会推进Run的status来获取源码。该External只固定当前代码调查基线；未来同步master/实现后的代码需另附实际候选证据。

## 实际代码调查与复用边界

| 现有实现 | 已有能力 | 本次如何接入 |
| --- | --- | --- |
| `src/app/contracts.ts`、`package.ts` | app.json严格校验；配置JSON Schema；packagePath与包digest校验 | 在既有entrypoints下引用设置用途View Package，复用原配置校验与模块资产 |
| `src/app/state.ts` | 每Project/Memory范围state.json，安装配置在installations[id].config，原子写和App锁 | 配置仍只保存这里，增加可选每App配置版本，不建第二配置Store |
| `src/app/install.ts:configureApp` | Project共享锁→App锁，配置Schema和Store校验，更新绑定代次后保存 | 将预览/提交共用的校验提取；增加可选预期版本，View提交强制带版本 |
| `src/app/backend.ts` | 每次operation读取安装状态及ctx.config；共享Store operation在Project锁下执行 | 保存后新调用读取新配置；既有旧token/并发保护不改 |
| `src/app/composition.ts` | 只把enabled App的View Package加入运行组合，配置在组合时解析 | 设置页不依赖App启用；为真正App View启动记录配置指纹，区分保存和运行快照 |
| `modules/org.memsphere.settings/adapter/view/` | 通用设置页面、操作令牌、scope状态、校验确认、路由/Slot | 增加真实App列表/编辑控制器，保留已认可布局；通用与自定义页共用状态 |
| `src/commands/view.ts` | Project scoped API、设置鉴权与Origin检查、静态资产和View组合 | 增加App设置资源路由，不把它误路由到Home或通用Project配置文件 |
| `src/view/package-config.ts`、`src/module/manifest.ts` | 现有View能力、贡献单元、包与SDK范围校验 | 增加App配置便携单元识别及own-App规范化，设置用途只授予本App单元，不开全局外观替换 |
| `src/view/ui-primitives.ts` | 公共表单、容器与反馈控件 | settingsForm复用这些组件并统一样式/响应式/焦点，通用页和App Slot共用；需要时拆分实现文件而不复制样式 |
| `src/view/view-sdk.ts`、`view-runtime.ts`、`host.ts` | 公共主题/UI、模块路由、Host导航和Project切换 | 增加标准配置Slot及公共settingsForm组件，复用Loader/Plugin/注册生命周期；补可注销的未保存导航保护 |

当前无App设置HTTP API、真实App配置页、配置CAS或专属设置Renderer。不能直接把现有Settings全局/Project config保存接口拿来写App安装状态，也不能把现有“仅enabled App参与View组合”的条件套到设置入口上，否则无法配置尚未启用的App。

## 设计一：真实配置服务与并发版本

### 唯一权威数据与兼容性

继续使用`appStatePath(project)`下`installations[appId].config`；不把Home config.json、Project config.json或浏览器缓存当配置权威。保留原有App manifest、App自有Store、CLI install/configure/show/check/enable语义。

`installationSchema`增加可选`configurationRevision`（UUID）。新安装与每次成功的实际配置更新产生新版本；旧安装无此字段时，读取返回由安装operationId、packageDigest和当前配置内容计算的稳定旧版token，首次成功更新才写入UUID，不在读取时迁移或改写磁盘。配置A→B→A仍产生不同版本；其他App保存不导致当前App无意义冲突。App被重新安装或包身份变化也会使版本失效。

`configureApp`保留现有参数位置，增加可选options `{expectedRevision?: string}`，在取得Project共享锁及App锁后重新读取并比较；旧CLI可不传，仍是明确执行完整配置替换，但每次成功变化都会推进版本。View保存必须提供expectedRevision。版本不符返回`APP_CONFIG_CONFLICT`（HTTP409），不写状态，不更新绑定代次，不吞掉页面草稿。

安装启用/卸载/包身份变化需在保存时重新检查，不能只依赖页面打开时的状态。无变化提交返回当前配置和版本，不假装发生新运行变更；变更提交成功才发布新版本。原有projectStoreGenerations继续由配置变化逻辑负责，不能用配置UUID替代Store来源token。

### 同一校验/提交路径

新增`src/app/settings.ts`集中实现设置读取、可用Store候选、配置预览和保存的服务函数。HTTP和configureApp复用：

1. 确认当前Project、Memory范围、目标App真实安装及写权限；Mounted不能因从页面进入就变为可写。
2. 校验安装包身份和声明资源；配置必须是JSON object，使用现有validateAppConfig的JSON Schema校验。
3. 在候选App副本上验证projectStores，不修改实际App状态；Store必须是当前Project已登记且模型/类型匹配的目标，验证不创建备用Store。
4. Preview返回字段问题、规范化候选/差异及重启说明，不写state.json。Save在锁内再次执行版本比较及同一校验，不能依赖旧Preview结果。
5. 版本比较必须先于无变化快捷返回：过期expectedRevision即使提交值等于当前值也返回409。相同配置且版本匹配时只返回当前值/版本，不写state或更新绑定代次；实际变化才原子更新配置、现有绑定代次与configurationRevision。失败保持旧有效配置和业务数据。

候选Store列表复用现有业务登记/模型匹配规则；详情保留当前失效目标及诊断，不默认选中“第一个匹配项”。候选枚举只用于编辑帮助，最终保存重新验证最新登记。业务操作仍靠现有operation锁与expectedBinding保护，不能把“配置Preview通过”当写业务数据的授权。

## 设计二：Project scoped HTTP契约

统一挂在`/api/projects/:project/settings/apps`；在`isProjectResourceApi`映射中明确登记`/api/settings/apps`。Project来自请求URL解析出的实际上下文，不信任请求body中的Project/App路径，也不回退Home当前项目。

| 方法/相对路径 | 输入/输出 | 约束 |
| --- | --- | --- |
| GET `/` | 当前Project已安装App摘要：id/name/version/enabled/可配置性/诊断 | 不夹带全部App配置；不把内部Module或主题列成App |
| GET `/:appId` | app身份、当前config、revision、配置Schema、Store需求/候选/失效诊断、设置用途Module/贡献诊断、canWrite及运行状态 | 不执行App backend来枚举配置；配置读取沿用设置权限 |
| POST `/:appId/validate` | `{config, expectedRevision}`→字段问题、候选差异、restartRequired | 只预览，无持久化副作用；可以明确提示已过期 |
| PUT `/:appId` | `{config, expectedRevision}`→真实保存值/新revision/保存与运行状态 | required版本；服务端在锁内重新校验与比较 |

错误契约：无权401/403、未知/已移除App404、配置版本冲突409、Schema/Store或包问题返回明确code及字段/诊断（400或422），不使用200+含混的失败提示。鉴权**按View配置的监听模式**复用现有authorizeSettingsRequest，不按某次请求是否从localhost发起来猜：

- loopback监听：沿用现有免Bearer token的设置读取；validate/PUT仍要求同源JSON请求，检查Content-Type、Origin/Host、Sec-Fetch-Site及loopback主机条件。无token不是此模式的错误，不把原本本地可用的入口改成强制token。
- 非loopback监听（例如0.0.0.0）：GET/validate/PUT均要求现有settings Bearer token，无token或错误token返回401；validate/PUT额外执行同源JSON检查，即使有正确token也不能绕过Origin/Content-Type。此模式下即使客户端连接127.0.0.1，也不自动免token。
- 两种模式都保留真实Project/App写权限和Mounted只读检查。自定义Slot走相同宿主请求流程，没有特权API。

请求/响应只序列化公开配置和必要元数据，不回传state.json物理路径、包内部文件或operator token。响应禁止缓存配置。HTTP断连取消和错误观测沿用现有View协议，不把新请求重试成重复写入；网络断开后用户可重新读取真实配置确认结果。

## 设计三：复用View Package、Plugin与Slot扩展App配置

### 架构决定与明确移除的协议

根据Human本轮要求，自定义配置使用已有View扩展框架。**不新增顶层settings.entry/settings.sdk，不新增AppSettingsView默认导出协议，不新增独立mount(target, context)、设置页JS加载器或设置专用SDK包。** 旧稿这些设计尚未实现，无需兼容或迁移。

业务仍以JS/TS编写扩展，但导出已有`defineViewPlugin`，通过已有`ctx.slots.register`贡献App配置内容；View Package的module.json、Loader、服务注入、SlotRegistry和lifecycle负责加载、注册与清理。Settings模块拥有页面路由及配置控制器。一个Slot内容扩展不是新的全局设置页或另一套运行时。

### 声明：复用App已有View Package资产与entrypoints分组

在App既有`assets.viewPackages`中登记设置View Package，在既有`entrypoints`下增加可选`settings`用途引用：

```json
{
  "assets": {
    "viewPackages": [
      { "key": "settings", "path": "view/settings" }
    ]
  },
  "entrypoints": {
    "settings": { "packageKey": "settings" }
  }
}
```

这是App JSON清单的增量用途声明，**不是另一个JS入口格式**。入口、SDK范围和贡献声明仍由该目录已有module.json表达：

```json
{
  "schemaVersion": 1,
  "id": "org.example.expenses.settings",
  "version": "1.0.0",
  "view": {
    "entry": "./index.js",
    "sdk": "^1.1.0",
    "contributions": [
      {
        "id": "expense-settings",
        "cell": "org.memsphere.settings.app.configuration@1:app",
        "priority": 100
      }
    ]
  }
}
```

`app`是便携的本App单元标识，宿主像现有main.view的route声明映射一样，在安装上下文内规范化到当前App ID；不是可由业务填写的任意目标。App作者不登记宿主物理路径、主导航、主题或Home配置。本轮一个App只允许一个settings用途包及一个该Slot贡献，未知packageKey、缺失入口、重复声明明确失败；无settings引用仍用通用配置。

包校验、缓存digest、相对资产路径与SDK兼容检查复用现有readAppPackage/module manifest/资产注册器，不另建`/assets/app-settings`目录协议。宿主View SDK从1.0.0做向后兼容的minor增量至1.1.0，并把commands/view与App check中现有硬编码版本收敛到同一个实际版本常量；Plugin apiVersion:1和UI version:1不另起版本协议。新设置包声明^1.1.0以保证所需Slot和公共表单能力存在，旧^1.0.0包仍兼容。import/apply前使用现有isViewSdkCompatible比较实际版本；合法但不兼容也必须显示本App诊断，不靠类型编译或apiVersion主版本放行。

### Slot契约与注册归属

在现有`portableSlots`增加：

- 导出名：`portableSlots.appSettingsConfiguration`。
- identity：`org.memsphere.settings.app.configuration@1`。
- kind：keyed；key：当前App ID；scope：page；render：descriptor。
- value：已有`ViewDataRenderer<AppSettingsPresentationContext>`，沿用同步`render(input): HTMLElement`契约，不再引入新的mount回调。

现有ModuleInstanceContext增加可选只读`appId`，由宿主根据App安装及该settings实例绑定，非App模块保持undefined；不从业务config或请求body获取它。Host创建的注册policy把manifest中的`:app`便携单元映射到`:实际AppId`，并检查key与实际owner一致。非App实例、普通模块或其他App不能注册此App的配置单元。输入上下文也只在同App单元选中时传入，不把其他App配置作为全局Module启动参数。

这个App归属单元不是“界面与主题”中可让任意全局Package替换的通用偏好。复用已有SlotRegistry声明/事务/优先级校验，但在动态单元识别、manifest规范化及注册policy中增加App ownership约束；不靠运行时只检查JS传来的key。当前App只解析自己的贡献，不因其他包相同priority而接收其他App的设置页。

### 框架维护样式，业务代码维护配置内容

App不能借此替换设置页面壳或交付一套独立样式。Settings与公共View UI分别负责：

| 框架维护 | App代码提供 |
| --- | --- |
| App列表、页面标题、Project/App身份、返回入口、内容宽度、边距与响应式布局 | 设置分组、顺序、标题、说明和字段路径 |
| 统一标签、输入框、选择器、JSON编辑器、Store控件、错误/帮助文字及焦点样式 | 字段类型与业务选项、依赖配置的可见性/禁用条件、即时业务提示 |
| 主题、字体、颜色、间距、圆角、字段密度、空态和加载状态 | 业务选项计算和交互回调，使用受支持上下文修改当前App草稿 |
| 校验/保存/取消动作区、busy/dirty/冲突、已保存/待重启状态及离开保护 | 提供配置的业务含义，不私建第二套保存状态 |

在现有`ctx.ui`中补充公共`settingsForm(descriptor): HTMLElement`组件，内部复用当前textField/select/checkboxField/textareaField/section/feedback等组件。正式Settings通用页与App Slot都使用同一组件和样式源，不在App示例里复制CSS。

descriptor包含宿主提供的presentation context、若干section及field。field使用受限的类型化描述（text/number/integer/boolean/select/json/projectStore）、path、TextRef标签/说明、选项及可选业务条件；不接受任意HTML、CSS、className、style、renderField或业务DOM节点。分组布局由公共组件决定；业务可调整语义组织，不自行定义控件或设置页外观。以后需要新的配置控件时，扩展公共View UI组件后再通过descriptor引用，不让每个App自带私有控件绕开一致性。

Store字段用App已声明用途key；框架解析对应configKey与候选，不允许控件借别人的key扩展访问。Schema、canWrite和busy造成的required/disabled/readOnly不能被业务descriptor放宽。隐藏字段不删除值或原始文本缓冲，服务端问题始终在宿主错误区可见。公共组件负责订阅控制器、更新控件和保持光标/焦点，不因任意输入整页卸载重绘。

例子仅展示待实现协议的使用方式：

```ts
import { defineViewPlugin, portableSlots } from "@memsphere/view-sdk";

export default defineViewPlugin({
  apiVersion: 1,
  inject: ["slots", "ui"],
  uiVersion: 1,
  apply(ctx) {
    const ui = ctx.ui;
    if (!ctx.module.appId || !ui) throw new Error("App settings context required");
    ctx.slots.register(portableSlots.appSettingsConfiguration, {
      id: "expense-settings",
      key: ctx.module.appId,
      value: {
        render(input) {
          return ui.settingsForm({
            context: input,
            sections: [{
              id: "defaults",
              title: { text: "费用偏好" },
              fields: [{
                kind: "select",
                path: ["currency"],
                label: { text: "默认币种" },
                options: [
                  { value: "CNY", label: { text: "人民币" } },
                  { value: "USD", label: { text: "美元" } }
                ]
              }, {
                kind: "projectStore",
                key: "expenses",
                label: { text: "费用数据来源" }
              }]
            }]
          });
        }
      }
    });
  }
});
```

以上render返回的是公共组件产生的元素，不是App自建DOM。公共组件实例由Host内部登记；Slot消费处检查本次返回值确属当前presentation context创建的公共配置组件根，不接受普通HTMLElement、来自旧App的组件根或任意data属性伪造来源。这个检查维护受支持的协议与样式一致性，不是恶意同源JS沙箱。App修改框架根节点、注入CSS/操作Settings私有DOM不属于此Slot支持的用法。

### 公共展示上下文与配置控制器

类型与Slot从已有`@memsphere/view-sdk`导出，不新增`@memsphere/app/settings`运行包。`AppSettingsPresentationContext`是设置领域的受控数据/动作输入，和现有Memory/Model presentation context同类，不是第二套加载/挂载协议：

| 能力 | 作用与边界 |
| --- | --- |
| `projectId`、只读`app`、`canWrite`、`signal` | 当前身份、只读边界与本次展示取消；不给operator token、物理文件路径或其他App配置 |
| `getState()`、`subscribe(listener)` | 当前已保存值、JSON草稿、文本缓冲/解析问题、revision、busy/dirty/冲突与运行状态；快照只读，订阅可清理 |
| `setValue(path, value)`、`removeValue(path)`、`setText(path, text)` | 修改宿主候选；公共控件自动调用，业务回调也只能按相同busy/路径冲突规则调用，不另建DOM或私有权威状态 |
| `validate()`、`save()`、`reset()` | 宿主统一校验、提交和恢复基线；主动作由框架提供，业务不能替换服务端校验或伪造保存状态 |
| `getStoreChoices(key)` | 本App声明用途的当前Project候选与诊断，不选择/枚举其他Project |

下面设计四中已确定的busy锁定、requestId、JSON文本缓冲/父子路径冲突及CAS不变。App代码计算选项或修改配置也经过同一控制器；公共控件不允许出现“通用页disabled，但扩展仍能绕过写draft”的分叉。所有输入，包括无法解析的JSON文本，都留在宿主缓冲并参与离开保护。

业务即时提示不能替代服务端JSON Schema和Store约束；本轮不新增任意服务端validator执行钩子。即使App隐藏部分字段，完整配置和未编辑值仍保留。

### 现有Loader、能力限制与生命周期

`entrypoints.settings`作为现有appViewComposition的一种用途，独立于enabled业务View组合：已安装但disabled的App也有设置贡献。宿主按Project/Memory范围、App安装身份和packageKey生成设置用途Module实例；已有Loader/资产注册器读取其module.json并执行已有Plugin.apply/注册事务。初始化只取得身份与服务能力，不注入真实配置；真实上下文只在当前App配置Slot渲染时提供。

设置用途实例使用现有effective capability机制限制为公共UI和本App配置Slot，不授予router.register、theme.register/override、styles.scoped/global、主导航/其他Slot或App业务API能力。设置包若声明这些额外用途则给出包诊断，作者应提供专用View Package；它仍是标准View Package，不是新设置协议。普通enabled App的原有View Package能力和样式不因本变更被全局收紧。

模块的view.styles/view.themes及业务CSS不在设置用途实例中加载；框架Settings样式与Host实际选定主题是唯一视觉来源。复用公共组件并不授权设置Package注入Theme或全局CSS。可信同源代码依然不是安全沙箱，不能声称防止故意操作document；受支持API与真实服务端权限仍按既有可信App边界执行。

App包digest、module版本、资源路径包含性、SDK范围和贡献声明使用既有校验路径。只登记该设置用途包的浏览器资产，不暴露App的backend/config文件或整个App包。若现有资产注册器在该绑定场景缺少包完整性/路径检查，就补在共用注册路径，不新建专属资源服务器或在URL中携带token。

注册、订阅和组件清理复用现有lifecycle/disposer，贡献仅在事务成功后生效。给现有Loader的模块初始化补足可取消、有期限的失败处理（若实际路径未覆盖），避免异步apply无限等待阻塞Host；不是新增设置专用import/mount状态机。初始化失败、SDK不兼容或声明贡献缺失时，Settings页保留身份/返回/诊断及明确的通用配置恢复入口，不写配置，不显示保存成功。

每次Slot展示仍有独立子容器和有效上下文代次：展示失效即移除旧组件根，中止请求并清理订阅；新展示使用新容器。公共配置组件持有的异步选项/业务请求晚返回时，仅能更新已失效的旧组件，不接入新App页面；旧上下文save在发请求前拒绝。只接纳当前App、当前展示代次和请求ID的结果。

Slot使用既有同步ViewDataRenderer.render；业务在render中不返回Promise，也不获取独立mount target。需要异步选项时使用公共配置组件支持的带取消/状态的选项提供能力，结果由组件按展示代次接纳，而非让App异步拼DOM。失败或返回非公共组件时显示贡献诊断，可显式进入通用配置；不把失败当成“未提供自定义页”。不为多候选建立第二优先级系统，本轮每App仅一个设置贡献。

## 设计四：正式设置页面与草稿

正式路由沿用原型`/projects/:project/settings/apps?app=:appId`，Settings Module及builtin catalog的query许可一致。入口文字统一“App 配置”；每App链接可直接打开/刷新。扩展通过本App配置Slot进入正文，宿主保留标题、身份、返回、错误区、保存状态和全部样式，业务不能替换设置壳。

App列表来自真实API，显示名称、ID、版本及启用状态。无App、无Project、无配置项、未知App、包损坏均有准确页面。不在生产路由混入费用/任务示例或读取原型localStorage；原型从正式路由移除，示例成为真实测试/开发App，演示配置写真实隔离Project。

通用页和Slot都由公共settingsForm渲染；通用页从Schema生成相同的分组/字段descriptor。它直接支持Schema中的常用object属性、string/number/integer/boolean/enum及说明/必填信息；projectStores的configKey使用模型/类型过滤的Store控件。复杂object/array或未覆盖Schema结构提供明确标注的JSON字段/完整配置编辑入口，并始终保留完整基线及未编辑字段。未知字段不得因为表单没有渲染而丢失。无Schema时可编辑JSON object；空配置且无声明/扩展时展示无可配置项，保持原App兼容。

单个App编辑控制器持有`baseline + draft + textBuffers + revision + issues + status`；另有一个递增请求ID标识当前校验/保存操作。明确dirty/editing/validating/saving/conflict状态即可，不建立持久草稿数据库。失败保留draft和所有原始文本缓冲，供恢复/复制；重新加载或切换编辑模式先说明放弃/保留；409不自动merge或重试覆盖。与CLI同时修改时，旧页即使Preview成功也会在保存CAS中拒绝。只有本代次、本请求的成功保存响应才用真实保存配置重建基线，不能笼统地把任意晚响应接到当前草稿。

### 同一页面的校验/保存并发：选择busy期间统一锁定

采用最小策略：**校验或保存期间，不接纳新的配置编辑、reset、重新加载或重复validate/save**。不做提交期间继续编辑的D1/D2自动合并。

- validate/save同步检查当前上下文仍有效、无活动请求且无解析错误后，先捕获不可变的`candidate + expectedRevision + requestId + presentationId`，同步进入validating/saving并通知订阅，再发HTTP。save直接走服务端最终校验/提交，不递归调用会重新抢占busy的公开validate。
- busy时，通用页禁用所有配置输入（含JSON文本）、取消/重置/重新加载与提交按钮；公共settingsForm通过getState/subscribe获得busy，框架统一更新通用页和Slot页控件。控制器层的同步setValue/removeValue/setText/reset抛出明确的`APP_SETTINGS_BUSY`错误，异步validate/save以同code拒绝Promise，不改变draft、文本、基线或issues，也不排队/悄悄忽略。即使业务回调尝试在busy时修改，控制器也不接纳C成为当前草稿，并可显示“正在校验/保存，请完成后再编辑”；组件应以宿主快照恢复未经接纳的控件值。
- 发出B请求后不能形成被控制器接纳的C；B成功时磁盘、baseline与draft均为服务器确认的B、dirty为false，恢复编辑后用户可再改成C，此时dirty为true。B失败则baseline仍为A，draft仍为B，dirty和离开保护保留；失败不能清空原输入或伪装已保存。
- validate结果仅归属其冻结候选B及requestId；处理中同样锁定修改。请求结束恢复editing；之后编辑立即清理/标为过期的该次服务端issues/验证通过结果，不把B的通过或错误附到后来C。解析错误仍由当前文本缓冲负责。过期、取消、超时或失效展示代次的响应不更新当前状态。
- 只有与当前activeRequest匹配的finally才能释放busy；较早请求的迟到finally不能解除较新请求的锁。校验15秒、保存30秒独立客户端期限与展示生命周期取消组合，退出清理定时器；超时保留草稿并恢复可操作状态。保存超时仅说明结果未确认，不能承诺服务端未写入，提示先重新读取真实配置再决定后续动作，不自动重试PUT。重新读取须明确选择是否放弃本地编辑。
- 页面离开仍按下面的dirty保护；用户明确离开正在保存的页面时提示请求可能已送出。旧请求始终绑定旧App/revision，取消不承诺回滚；晚响应只会被丢弃，不影响新页面。只读getState/订阅可以继续，Store候选刷新不得修改配置或让页面自动换目标。

### 复杂JSON的原始文本、解析错误与dirty

JSON值draft不能代表所有输入。宿主为每个文本编辑路径保留`text、baselineText、modified、parseError`缓冲；复杂字段和完整配置编辑均使用它，完整配置根必须是JSON object。原始文本一旦变化就进入缓冲，即使是暂时无效JSON；无效时保留最后有效JSON值仅作内部基线/其他字段用途，不能将其显示为当前编辑已通过或拿它代替当前文本提交。

- `dirty = JSON草稿与baseline有语义差异，或任一textBuffer.modified`。格式变化或无效文本也纳入未保存状态和Host离开保护。页面重渲染直接从缓冲还原原文与解析错误，不能以最后有效JSON序列化覆盖正在输入的文本。
- 任一缓冲解析错误时，validate/save在控制器入口返回`APP_SETTINGS_INVALID_TEXT`及路径/解析错误，**不发任何校验或保存HTTP请求**；宿主显示修正提示，不能提交旧draft后误报成功。其他有效字段和原始文本仍保留。
- 文本修正为合法JSON后更新该路径对应的值draft，保留其他未编辑字段，解析错误消除；仍dirty，直到成功保存或明确取消。根JSON编辑替换完整对象是用户明确编辑行为，保存前展示差异；切换到根编辑时基于包含全部现有字段的完整草稿初始化，不从可见字段重建对象。
- 活动文本缓冲采用**路径不相交**规则，包含合法和无效文本，不以modified或解析成功作为放松条件。路径按完整属性段数组比较：相同数组是同一路径，严格前缀是祖先/后代，空数组是根；不能用字符串前缀把prefs与preferences误判成相交。
- `setText(p, text)`可继续编辑已经存在的**同一路径**缓冲。若另一个活动缓冲q与p具有严格祖先/后代关系，则在创建新缓冲、解析文本或改draft前同步抛出`APP_SETTINGS_TEXT_CONFLICT`。`setValue/removeValue`与任一活动缓冲路径相同或祖先/后代相交时也拒绝。两种拒绝均不改draft、任一原文、modified、parseError、baseline、revision或issues；错误只通过操作结果/异常给调用者，不能把它附成另一个字段的解析错误。不同兄弟路径可独立编辑并保留。
- 例如根缓冲`[]`存在时，不能再setText(["prefs"],...)；先编辑["prefs"]后再编辑根同样拒绝，即使两份文本都合法也不例外。相同路径继续输入仍可修正无效文本。不能保存显示旧根文本、实际却采用后来子字段的候选。
- 需要改变编辑路径或通用/专属模式时，先完成并成功保存当前编辑，或由用户明确reset/取消修改或确认放弃离开；保存/重置清理原缓冲后才创建新编辑器。取消离开则保留原路径、原文与错误，不自动丢弃或合并。无相交字段的编辑照常保留；所有显示文本与最终提交草稿保持同一来源。
- reset/取消修改是显式放弃动作，非busy时恢复baseline并清理缓冲；离开取消保留原始文本、解析错误、dirty和当前页面，离开确认才卸载并丢弃缓冲。保存成功后用真实返回值重建基线和干净的编辑表示；无效文本永远不可能走到此分支。
- Slot里的JSON字段由公共编辑器使用同一setText能力，不提供业务私有textarea来另存无效文本。这是局部编辑缓冲，不持久化到磁盘、Home或全局业务状态。

### 未保存保护

同一设置页切换App或通用/专属模式时先检查控制器dirty；继续编辑不卸载原页，放弃才销毁草稿。自定义页配置修改必须经过控制器，所以同样受保护。

现有ViewRouter导航会直接写history，Host顶部入口也有直接history/popstate；只保护页面内返回按钮不足。为ViewHost增加一个可注销的“未保存修改”登记能力，由活动设置控制器登记dirty及确认回调；SDK导航、Host首页/设置入口、Project切换和浏览器back/forward统一查询，在实际丢弃草稿前确认。取消时保留当前route与mount；popstate已改变URL时恢复已接受的history位置，防止恢复事件递归。刷新/关闭使用仅dirty时注册的原生beforeunload。无dirty的其他模块保持原行为，所有登记在卸载时移除。

具体公开类型放在ViewRouter的可选`beforeLeave(handler): Disposer`中，旧Package无调用完全兼容；Host自身导航也进入同一门禁，不能仅在Settings中patch私有history方法。这里不新增独立导航服务或全局业务草稿系统。需要覆盖route切换、Project切换、back、reload、取消后路由/草稿不变以及清理后不残留提示。

## 设计五：已保存与运行应用状态

配置服务返回磁盘已保存值/版本；backend每次operation按现有实现读取当前安装配置，因此有效改绑A→B后新的共享Store调用用B，旧A token提交被拒绝，开始于改绑前的独立操作仍可在A完成。

App View配置在`appViewComposition`及Host boot时形成快照。记录实际已创建的App View组合对应的App ID、配置指纹与本次服务instance；详情接口比较它与当前保存指纹，仅当有可靠运行快照时给出匹配/待重启。不启动App View仅为探测状态，也不把设置用途Module/Slot的加载当作App业务View本身已运行。未加载、未启用或无法确认时明确为未运行/未确认，不显示“已应用”。

保存响应沿用现有restartRequired提示，界面展示“已保存：B”与“待重启”并列；磁盘读取或刷新不能自行清除待重启。重启后由新的实际boot记录重新确认，始终允许“运行状态未确认”而非假成功。这里只跟踪Host可证明的View配置快照，不承诺探测第三方App任意内部缓存和副作用。

## 影响范围、开发顺序与交付

1. **整理原型并同步master。** 保留需求/原型工作区改动，审阅当前staged/unstaged后按任务保存；合入最新master，处理实际冲突，记录最终基线。原型不是正式数据适配层，施工将其替换。旧已有共享Store实现不重写。
2. **配置服务与版本。** 修改`contracts.ts/state.ts/install.ts/package.ts`，新增settings服务/公共类型；先完成配置版本、只读预览、锁内CAS、兼容旧CLI、失败无副作用及Store候选。
3. **HTTP与运行状态。** 在View中薄路由调用服务；Project scoped映射、鉴权/Origin、错误码、资产路径与包digest、真实boot配置指纹同步完成。
4. **宿主通用页。** Settings模块接真实列表和详情、独立草稿、通用字段/复杂JSON、Store选择、保存与冲突。更新英文/中文文案，去掉生产路径示例和localStorage权威配置。
5. **开发者Slot与统一样式。** 增加entrypoints.settings引用、标准App配置Slot、便携贡献单元归属校验和公共settingsForm组件；接现有Loader/Plugin/资产与lifecycle，统一SDK实际版本与能力限制，不实现独立settings.entry/mount协议。通用/业务页共享组件、样式和控制器；验证disabled App可配置。
6. **离开保护与完整动线。** 增加狭窄可注销的Host beforeLeave机制，并覆盖内部导航、Project切换、浏览器回退及刷新。以真实示例App验证普通设置、Store改绑、CLI互通和自定义页。
7. **文档/Memory/Skill与验收。** 更新公开App契约中英文、开发者设置扩展示例、配置/权限/冲突/重启说明，完成受影响验证、当前候选default CI，再技术与产品正式评审。继续PR #141，不把原型认可或需求通过当作技术/交付票，不自动合并。

示例至少两个：费用App以标准View Package/Plugin贡献App配置Slot，通过公共组件组织币种/展示偏好/Store绑定；另一个只声明配置Schema，由宿主通用表单管理。无设置项与加载失败用受控测试fixture，不在真实Project偷偷安装演示App。

## 验证计划与执行边界

当前仅调查和方案编写，没有实现新配置服务、Slot/公共组件增量或声称下面测试已经通过。原型曾通过12项实际浏览器检查及构建，仅证明示例界面方向，不证明本方案的真实持久化或权限边界。

| 风险/边界 | 验证与层级 |
| --- | --- |
| 可选用途声明与既有SDK/包兼容 | App/module manifest与Slot配置测试验证entrypoints.settings、已声明packageKey、便携cell映射、真实View SDK 1.1范围与旧^1.0包兼容；无独立settings.entry/sdk字段或AppSettingsView协议；纯值测试不建HTTP |
| 每App revision、A→B→A、其他App不误冲突、原子失败 | 新settings模块测试用内存IO端口；文件原子持久化和真实锁另用平台集成/系统用例，不能fake冒充磁盘 |
| 旧安装与无变化提交 | 用缺configurationRevision的真实旧state fixture：连续GET/validate不迁移state；匹配当前revision的相同配置PUT不写state、不改配置版本/绑定代次；首次实际变化持久化新UUID并拒绝旧token。过期revision即使候选等于当前值也409且零副作用，证明CAS先于无变化返回 |
| Schema/Store校验与Preview无写入 | 无效候选、目标删除/不兼容、Preview后CLI更改、锁内CAS；断言配置/代次/A/B数据不变，既有shared Store系统回归继续保护 |
| HTTP读写与Project/权限 | 真实HTTP与CLI覆盖未安装/未启用、两个App/Project、Mounted、409/400及落盘互通；分别测loopback无token读取可用、变更必须同源JSON，非loopback无/错token拒绝、正确token可用但错误Origin/Content-Type仍拒绝。取消与fixture清理有独立期限 |
| 模块资产与能力 | 使用现有Module资产路径的真实HTTP测试digest变更、路径穿越/编码/符号链接、未知App、跨包目录、服务端文件不可读及MIME；设置用途模块不能注册别的App单元/其他Slot/路由或加载自定义style/theme，普通业务View兼容 |
| 通用页与App Slot | 真实View HTTP、两App发行包和同一公共settingsForm：费用App经真实Loader按inject:[slots,ui]取得服务并完成Slot注册，另一个走Schema通用页；持久化/刷新/CLI互通、未编辑字段、Store与disabled配置。验证伪造App key、非公共组件根、非法descriptor及SDK不兼容有清楚诊断 |
| 样式一致性 | 真实浏览器对照通用页/Slot页同类型控件的字体、颜色、间距、label/help/error、焦点与busy；同一亮/暗主题、桌面/窄屏和键盘检查。业务条件只改字段内容/可见性，不带HTML/CSS/style/className/renderField；拒绝样式注入声明并确认其他设置页不受影响 |
| 框架与组件生命周期 | 受控Promise阻塞已有Plugin.apply/异步选项后切App或初始化到期，释放旧结果；旧注册事务/上下文失效，旧公共组件根已脱离页面，晚结果/清理不能破坏新App和恢复入口。Slot render为既有同步接口，不能返回Promise或私有mount对象；订阅/disposer只清理所属代次，失败有界，不靠sleep |
| 同页保存/校验并发 | 真实HTTP握手阻塞B请求，断言通用输入禁用、自定义SDK setValue/removeValue/setText/reset/重复提交得到BUSY且草稿未变；释放成功后磁盘/草稿/基线均B且clean，之后C为dirty；失败则磁盘A/草稿B且dirty。validate期间同样锁定，释放后改C不保留B的验证通过或issues；旧响应/finally不接纳到新请求 |
| 无效JSON输入 | 真实浏览器从clean基线制造无效JSON：原文、解析错误和dirty存在且重渲染保持；保存/校验无HTTP请求，不使用旧值；切App/Project或离开取消保留原文与错误，确认放弃才丢弃。修正后保存成功，未编辑字段保留；通用及专属setText使用同控制器 |
| JSON缓冲父子路径 | 控制器及真实自定义页验证根→子、子→根、非根父→子/子→父，分别覆盖合法和无效的现存文本；新setText抛TEXT_CONFLICT后原文/草稿/issues/dirty均未变化且无HTTP。相同路径继续输入可修正、不同兄弟路径可编辑；明确reset/放弃后可切换，最终保存值与当前展示一致且保留未编辑字段 |
| 已保存但结果未确认 | 真实HTTP握手先确认B已原子写入且revision推进，再阻塞/丢弃响应直到客户端期限；断言提示结果未确认、保留可恢复B草稿、不自动重试PUT、到期恢复操作，迟到响应不改新请求。显式重新读取看到B及新revision；旧revision重提409，不再次改变配置或绑定代次；不以固定sleep判断落盘或成功 |
| 导航/重渲染 | 更新`test/settings-builtin-module.integration.test.ts`的route query预期；Settings/Router浏览器系统验证dirty切App/Project/菜单/back/reload取消与确认，跨重渲染字段/焦点/草稿保持 |
| 保存和应用 | A→B保存显示已保存B及需要时待重启，重启前新backend用B/旧token拒绝，View快照未知不假成功；重启后实际调用及界面匹配B |
| 真实产品检查 | 按冻结规则用playwright-cli实际操作桌面/窄屏、键盘、加载/错误/空态、取消保存及自定义页失败，检查console与卸载；保存截图/动线证据 |

先运行实际改动的App/module manifest、View SDK/Slot policy/公共UI单元与模块测试及App设置HTTP/浏览器文件，再运行受影响已有`app-project-store.module/system`、`platform/filesystem/app-install`、`view-settings`、`settings-builtin-view-browser`和View SDK/router/host相邻测试。这些文件多属于现行system层，即使default CI不包含，也要本地明确执行覆盖真实变更；按现行分层命名，不把真实HTTP/CLI/浏览器改名为module。构建与测试顺序执行，不同时清空dist。

新行为与失败边界覆盖通过后，只有新增改动、失败或未覆盖风险才追加回归；不泛跑整个仓库system套件。default CI照常，记录准确HEAD、目标SHA、带基线/HEAD的完整diff检查与每次CI结果。Human“full 检查不用管，你继续流程”继续有效：不运行或等待full，不声称full通过；不豁免上述受影响系统/浏览器测试、default或Human门禁。

## 规范、Memory与复杂度边界

采用本Run冻结的`statements/memsphere-repository-development-rules`、`statements/memsphere-repository-testing-rules`和`procedures/memsphere-agile-requirement-development`；当前App/View Concept、SDK与既有代码用于理解扩展边界，不替代冻结规则。代码/协议变化需在同一需求更新：

- `reserved-memory/system-memory/concepts/memsphere-app.yaml`、`statements/memsphere-app-usage-rules.yaml`：App配置入口、设置用途View Package与Slot/公共组件、配置版本、CLI互通、可信代码与失败边界。
- `concepts/memsphere-view.yaml`及相应开发者文档：App配置Slot、公共settingsForm组件及Host导航保护的公开使用说明，优先复用现有主题/UI/Route机制。
- 当前开发Project `.memsphere/memory`同步发行源；`src/skills/memsphere/SKILL.md`更新App设置及View重启说明，避免仍声称只能CLI配置。
- 执行Store validate与最终ChangeSet validate，记录ChangeSet ID/digest/View入口及源/副本匹配结果。已有ChangeSet证据仅匹配旧版App规则，不能拿来覆盖本轮新增Memory差异。若增加新Memory引用才更新manifest；不为无改动建空ChangeSet。

本方案不改Memory AST/YAML解析、Artifact/Schema Runtime或Run/Review执行语义，不触发这些范围专用测试/Memory更新；改View设置和导航，不等于改Artifact Review模型或意见定位。不新增Memory syntax关键字；新增App JSON manifest字段与TS公开接口不是Memory syntax关键字，施工发现需要修改Memory语义必须先修订方案并取得Human确认。

为避免过度设计，不做通用配置平台、任意远程扩展注册、全App生命周期改造、配置迁移编排、不可信代码沙箱、跨Project写入、分布式锁或自动冲突合并。失败优先保住已保存配置、来源和权限；允许诊断后重新加载/重试或重启，不用复杂自动恢复掩盖失败。

## 技术评审修订记录（旧稿方案为历史，不继续授权其协议）

首轮round-0302135d-3969-4b3f-ac4f-81dc8dbb8f7e的研发、架构和测试Agent指出5条风险，归为3个缺口：同页请求与草稿归属、异步mount持有target的隔离、无效JSON文本的dirty保护。本版选择busy期间统一锁定的最小策略，补不可变请求快照与结果归属；每mount独立子容器并在失效时移除；宿主拥有文本缓冲及解析错误，并在无效时阻止请求。验证矩阵补对应受控HTTP/Promise及真实浏览器场景。未增加自动合并、持久草稿库或不可信代码沙箱，产品范围和Human参与方式不变。

第二轮round-bd2e1f81-e969-43b0-a1f6-50f2f22dcc99中架构/测试Agent通过，研发提出1条风险：setText之间的父子路径缓冲还可能不一致。本版明确同路径继续编辑可用，新的严格祖先/后代路径setText也必须在解析/改状态之前拒绝；规则覆盖根路径和合法/无效文本，并补对应控制器及自定义页验证。另采纳测试建议，单列“已落盘但结果未确认”的真实HTTP验证。无新增产品范围、自动合并或持久草稿系统，Human与架构师Agent仍共同参与本轮。

2026-11-15 Human架构师明确要求复用既有View框架，在App配置页开放Slot，并由框架维护样式，业务以代码扩展配置。本版据此替换整个设计三，移除顶层settings.entry/settings.sdk、独立AppSettingsView/mount、设置专属SDK和资产加载协议。改用现有View Package/Plugin/SlotRegistry、entrypoints.settings用途引用和公共settingsForm。前轮确定的草稿、JSON文本、CAS、busy和晚结果隔离仍成立，但通过现有Module/公共组件生命周期执行，不保留旧独立mount协议。新增Slot归属、能力/样式限制、公共组件一致性及兼容验证。Human原修改指令作为固定External补充依赖，本版仍需独立复审，不沿用旧通过票。

第四轮round-5245e6cc-fd4d-4447-87d8-f174f253a8eb中研发/架构Agent通过，测试因受限Attempt没有可读固定源码而弃权。此版补完整固定源码External，Reviewer可从合法依赖独立读取代码；不以历史通过或调查摘要替代。同步采纳3项建议：Plugin示例显式inject:[slots,ui]；鉴权按loopback与非loopback分别描述/测试；旧安装无字段与无变化提交单列真实fixture验证，并明确CAS先于无变化返回。仍然只是方案修订，未声称实现或新测试已通过。

## 方案准出与尚未完成的工作

产品范围已有本轮需求批准，无待选产品方向。技术选择以本稿为明确候选，接受研发、测试、架构Agent及Human正式架构评审后施工；意见导致接口或范围变化时在同一方案Step修订。

Human已明确选择“加入我，保留 Agent”。本轮提交前已用原生run binding update将架构师Slot设置为traex4（架构师Agent）与actor5（billtenor）共同参与，并重新读取实际绑定确认；研发traex2、测试traex3和产品负责人原绑定保持。该更新仅作用于未来评审，不改历史轮次；加入角色不是本方案通过票，Human将在本轮独立提交架构决策。
