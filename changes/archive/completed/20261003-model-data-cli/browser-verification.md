# 模型 View 与模型侧定向验证记录

日期：2026-10-05。这是已执行工具记录的整理，不是正式 Review，也没有为整理材料重新启动浏览器。最终全量数量另见 `initial-validation-report.md`。

## 实际 playwright-cli 操作

按已读取的 `playwright-cli` Skill 执行，使用真实 View、临时磁盘 Project 和 Chromium，没有 mock。临时服务器由以下实际命令启动：

```sh
node --import tsx --input-type=module -e 'const {startProjectModelView}=await import("./test/fixtures/project-model-view.ts"); const view=await startProjectModelView(); console.log(JSON.stringify({origin:view.origin,root:view.root})); process.on("SIGTERM",async()=>{await view.close();process.exit(0)}); process.on("SIGINT",async()=>{await view.close();process.exit(0)});'
```

当次返回的 origin 为 `http://127.0.0.1:20591`，Project 根为 `/tmp/memsphere-model-browser-PRCB1F/projects/alpha`。这些是已关闭的临时地址，不是可持续访问的服务。

首次默认启动因 `/opt/google/chrome/chrome` 不存在而失败，不计为通过。随后使用已安装的 Chromium，临时配置内容为：

```json
{"browser":{"browserName":"chromium","launchOptions":{"executablePath":"/home/liuyanjun.lyj/.cache/ms-playwright/chromium-1193/chrome-linux/chrome","headless":true}}}
```

实际成功启动命令：

```sh
playwright-cli -s=model-d1 open --config=/tmp/memsphere-model-playwright-config.json http://127.0.0.1:20591/projects/alpha/models?model=memsphere%2Fmodel-registration.json
```

之后三次实际执行 `playwright-cli -s=model-d1 run-code '<async page => ...>'`，断言与返回值如下。URL 均相对于上述 origin。

| 检查 | 实际操作与结果 |
| --- | --- |
| 系统登记身份 | 等待“模型登记”标题，读取 `.model-information-table`，断言同时包含 `memsphere/model-registration.json` 与 `json-schema/draft-07.json`。返回表格还显示“持久化存储”和 `models/system/json-schema/draft-07`。 |
| raw 模型 | 打开 `/projects/alpha/models?model=memsphere%2Frun%2Fartifact.json`，等待“运行产物”标题，点击“模型结构”，等待“原始内容模型”。 |
| 不支持的定义 | 打开 `/projects/alpha/models?model=advanced.json`，等待“读取模型失败”，断言 `.model-definition-table` 数量为 0；实际正文含 `Unsupported JSON Schema at #/anyOf`，没有显示正常定义表。此步骤没有单独断言 HTTP 状态码。 |
| 默认市场整包 | 打开 `/projects/alpha/models/market`，点击真实“导入”按钮，等待 `/models/market/import` 响应；断言状态 422、错误码 `MODEL_RUNTIME_UNSUPPORTED`，并等待界面错误提示。比较导入前后 `/api/projects/alpha/models` 返回的 `models`，完全相等。 |
| 旧 ID 不作为别名 | 请求 `/api/projects/alpha/models/definition?model=memsphere%2Fmodel-registration`，断言状态 422。 |

市场与旧 ID 那次 `run-code` 的真实返回值：

```json
{"status":422,"code":"MODEL_RUNTIME_UNSUPPORTED","modelsUnchanged":true,"oldIdStatus":422}
```

这里的浏览器零发布证据是模型列表未变化；文件成员、字节和 mtime 未变化由下述 `view-settings` 测试独立断言。没有把浏览器列表比较称为磁盘快照。已找回的实际命令/返回值没有独立的 404 断言，不将 404 写成通过项；旧 ID 的实测结果是 422。

操作结束实际执行 `playwright-cli -s=model-d1 close`，再向当次临时服务器进程 2841652 发送 SIGTERM，由关闭回调移除临时 Project。生成的 `.playwright-cli/page-2026-10-05T03-03-07-810Z.yml` 和 `console-2026-10-05T03-03-07-693Z.log` 已清理，没有保留截图，不把这些路径作为可下载附件。本文命令和返回值从本会话原始工具调用/返回记录核对后整理。

## 实际模型侧 Node 定向组合

以下均使用真实沙盒外 Node 子进程，检查用例级 TAP 与退出码；全部列出的最终定向执行退出 0、失败 0。局部组合有重叠，不相加为全量数量。

| 命令（均从仓库根执行） | 结果 |
| --- | --- |
| `node --import tsx --test test/model-schema-references.test.ts test/data-json-schema.test.ts test/data-json-schema-metamodel.test.ts test/data-raw.test.ts test/model-validation.test.ts test/reserved-models.test.ts test/run-model-storage.test.ts test/system-models.test.ts test/model-registration.test.ts` | 68/68 |
| `node --import tsx --test test/data-manager.test.ts test/project-models.test.ts test/model-market.test.ts test/example-relocation.test.ts` | 44/44 |
| `node --import tsx --test test/model-registration-browser.test.ts test/models-view-slots-browser.test.ts test/model-browser-state.test.ts` | 15/15 |
| `node --import tsx --test test/model-market-package.test.ts` | 1/1 |
| `node --import tsx --test test/view-models.test.ts` | 1/1 |
| `node --import tsx --test test/model-service.test.ts test/model-command.test.ts test/config-management.test.ts` | 30/30 |
| `node --import tsx --test test/archive-run-data.test.ts test/run-data-access.test.ts` | 39/39 |
| `node --import tsx --test test/view-settings.test.ts` | 11/11 |

`view-settings` 的市场覆盖区分两条路径：默认八例包走真实 HTTP，验证权限 401、旧 revision 409、Runtime 422 及模型目录快照不变；成功导入使用临时资源副本，仅选取六个现有受支持示例，经真实 `importModelMarketPackage(..., { sourceRoot })` 导入，再通过 View HTTP 读取。未改写 04/05 约束，没有声称默认八例包通过 HTTP 导入成功。历史未完成导入另构造明确候选记录与 receipt，验证真实 HTTP cleanup 和权限/版本保护。

其余组合覆盖本地引用、元模型/raw 分工、系统只读、原始字节、直接 Store 保护、坏定义修复、CLI 输入/输出、历史恢复拒绝、Run 模型 ID 与稳定 Store ID 分离。`example-relocation` 验证的是违规历史资产拒绝及字节保护，不是合规历史包成功恢复。进程 SIGKILL 的共同模型服务专项由主 Agent 的 `model-operation.test.ts` 记录，未包含在上述浏览器操作中。
