# 独立模型定义展示示例 / Standalone model definition example

在“设置 → 界面与主题 → 界面扩展包安装”安装本目录，再启用此包。
示例通过公开 `router.register`、`main.view@1:route:targets` 和 `ui.modelDefinition()` 挂载独立页面。无需选择模型 renderer 或复制官方组件 CSS。

启用 instance id `model-definition` 后，打开 `/projects/<project>/modules/model-definition/targets?model=<URL-encoded-model-id>`。
未指定 model 时选择第一个可用业务模型。页面读取当前 Project 模型，展示两份独立结构与原文；爬取规则在另一区域展示。读取失败显示反馈，不构造空模型。组件本身不读取数据或提供写权限。

加 `?mode=static` 演示只使用静态快照且不调用模型读取 API；`mode=raw`、`mode=unsupported` 和 `mode=invalid` 演示结构反馈，原文仍独立显示。`locale=en` 或 `locale=zh-CN` 仅覆盖组件语言；默认跟随 Host。展开状态按实例独立；移除 DOM 后无需组件专属清理，页面清理函数阻止迟到读取结果重新写入。

Install and enable this directory in Settings → UI & Theme → View Package installation. With instance id `model-definition`, open `/projects/<project>/modules/model-definition/targets?model=<URL-encoded-model-id>`.

This package imports only the public SDK. It registers its own route and matching `main.view` contribution, reads the current Project through `presentation.modelsPage().getDefinition()`, and calls `ui.modelDefinition({ model, view })`. Two structure instances and the source view share the official renderer and Host theme; crawling rules remain separate. Read errors are handled by the page. Static mode requires no model requests. Each DOM instance owns its expansion state; the page disposer prevents late reads from remounting content.
