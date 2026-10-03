# 模型登记界面原型

独立静态展示原型，沿用 Memsphere 的模块栏、二级菜单、模型列表和详情布局，不接入管理 ValueStore 或真实市场安装。

## 最新管理模型

定义：`../../examples/models/model-registration.json`。八个字段为 modelRef、name、description、package、package_name、tags、storage、store_id；modelRef 与 storage 必填。名称与说明可回退到定义；package 省略表示未定义包，package_name 省略则直接显示 package。定义读取使用 store_id + modelRef，不再重复保存定义 ID。

不使用 domain、嵌套 definition 或独立包登记模型。同一个包的模型重复保存 package_name，约定名称一致。定义标准从实际模型定义读取，不重复写入登记记录。

## 数据

- `models.json`：当前 Project 的 13 个模型定义快照与新版登记草案。
- `../../examples/models/model-registrations.json`：13 条完整登记草案，均符合最新版 Schema。
- `imported-models-demo.json`：1 条额外市场导入演示，不计入真实模型清单。
- 订单示例归入 memsphere.examples.orders / 订单示例；其他 7 个项目示例未定义包。4 个运行模型与登记模型的草案归入 memsphere.builtin / Memsphere 内置。
- origin 只在原型外层上下文区分 project/system/market，不属于 ModelRegistration，也不作为新增登记字段。正式持久化中来源范围如何组织，由敏捷实施方案确定。
- 已删除 packages.json；菜单分组从模型的 package、package_name 及原型上下文产生。
- 当前 Project 中的登记模型定义已同步最新 Schema；13 条业务登记草案仍未写入真实管理 ValueStore。

## 展示与交互

二级菜单小字“本项目”下列未定义包与项目包；“已导入的包”下列系统内置及市场导入包。模型市场独立入口。三级列表提供搜索和标签筛选，没有全部模型入口。

列表项为名称、模型 ID、说明及 tags；最多两个标签，更多显示 +N，无标签省略第四行。定义标准只在详情展示。

详情顺序为模型信息、模型结构、原始定义，默认模型信息。模型信息用单个表格展示基本字段及存储方式、存储 ID、定义标准，不展示包来源、重复定义 ID、加载方式、定义位置分组、登记 JSON 或下载按钮。

市场中 3 个包明确标记演示，只支持预览与安装反馈，不写入项目。

无需构建依赖，静态预览地址 http://127.0.0.1:18743/ 。

## 验证

13 条真实登记及 3 个示例符合最新 Schema，13 条记录均能由现有 JSON Schema Runtime 反射。浏览器检查新版字段、package_name 菜单及缺失名称回退、包范围切换、无独立包文件请求、390px 窄屏与 pageerror；截图位于 `../../changes/active/20261002-model-registration/assets/prototype-latest-registration.png`。

正式敏捷 Run 仍处于需求契约评审。新版决策须纳入修订契约再评审，本次原型反馈不是正式通过票。

## 存储方式与启动

storage 显式取 builtin / store，界面显示“代码内置” / “持久化存储”。store 必须有 store_id，builtin 不得有 store_id；跨字段条件由管理服务校验，当前 Runtime 支持的 Schema 子集只表达必填、枚举及字段结构。原型的登记模型按拟交付方案显示代码内置，不通过登记记录解析自己的定义。当前真实 Project 中的 .json 定义仍是临时持久化预览；这次仅更新预览 Schema，不删除或迁移该文件。13 条登记草案尚未写入实际登记存储。

本轮补充验证：13 条登记与 3 个示例通过 Schema 校验、13 条登记通过现有 Runtime 反射；缺少 storage 或未知 storage 值被拒绝。浏览器实际检查登记模型的代码内置展示、订单模型的持久化存储和存储 ID、结构 Tab 的 storage 字段。截图：prototype-storage-registration.png、prototype-storage-persisted.png。正式代码内置启动与服务跨字段校验仍待实施，原型不替代交付验收。

模型信息字段最新顺序：名称、说明、所属包、模型 ID、定义标准、标签、存储方式、存储 ID。定义标准紧接模型 ID。

## 登记存储设置（第 5 轮）

左下角设置打开“设置 / 存储”面板，选择登记 ValueStore ID，默认 memsphere/model-registrations；所选 Store 类型 filesystem、项目相对目录 models/registrations、固定代码内置登记模型作为配置摘要展示。保存仅反馈，不改真实配置。正式设置包含有效目标校验、持久化与显式切换迁移，待需求评审后实施。

原型和登记草案使用 canonical memsphere/model-registration，旧 .json URL 自动规范化，仍展示 13 项。实际 Project 临时 .json 预览文件保留；正式迁移提案在契约中明确备份原文到扫描范围之外，退出正常列表，替换为单个内置模型。

## 第 6 轮设置交互

先选择存储 ID，再编辑所选存储目录。新增 project/model-registrations 演示选项以展示切换配置；只支持当前 filesystem 类型，登记模型只读。保存将配置保留在页面内存，关闭/取消丢弃本次草稿，刷新重置，不写真实 Project。正式隔离扫描及目录迁移规则纳入第六轮契约。
