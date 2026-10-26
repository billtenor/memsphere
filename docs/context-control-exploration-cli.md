# 自由探索 CLI

没有预定义 Procedure 时，使用 `memsphere run start --name "任务名称" --output json`，回执返回 Run ID 和前文 contextId。前文自动创建，跨 Shell 显式传同一 C；`run status --run R` 找回已有 ID。全局 Continue 本轮仅支持自由探索，旧流程、ChangeSet 和 ACP 保持原入口。

```bash
memsphere continue C --help
memsphere run artifact show --run R --artifact A --out input.md
memsphere continue C report --name "方案" --artifact-file plan.md --content-type text/markdown --depends-on artifact:A
memsphere continue C external add --source "用户补充" --content "约束说明"
memsphere continue C review create --artifact B --reviewer human --comment "修改要求一" --comment "修改要求二"
memsphere continue C report --revised-from B --artifact-file revised.md
memsphere run outputs list --run R
memsphere continue C outputs update --remove A --add B_NEW
memsphere continue C finish
```

- 完整成果准备好后直接 report，不预建产物或声明开始工作；系统关联 Step。文本、--artifact-file、结构化 --file 互斥。结构化只接收 name、content/contentRef、dependencies、tags、revisedFrom、revisedSummary，系统身份字段拒绝。Schema 局部草稿仍走原流程。
- Continue 仅承接公共项目和 Run；产物、评论、依赖、标签和交付根显式填写。查询及读取仍使用完整普通命令，状态结束后不能继续生产。完整原生命令也保留。
- 只按真实需要读取材料，不为登记依赖重复读取。Artifact／External 正文超过200 chars时仅预览前200字符加...，并提示完整导出命令；--out完整排他导出原始字节，网页内容不截断。JSON正文及提示在同一合法对象内。
- content由model（definedBy、definition JSON字符串）和payload（contentType、content字符串）构成，或用contentRef（storeId、dataId、sha256）固定引用；已提交内容及依赖不可改，修订创建新ID。revisedFrom不等于依赖，修订省略依赖继承原集合，显式依赖完整替换，结构化[]清空。
- 每份产物自动带default标签，--tag及artifact tag可添加；--depends-on接受artifact:ID、external:ID、tag:名称，标签当次固定为具体ID。external add支持短source/content或结构化file，成功只返回runId、externalId。轻量Review支持重复--comment或--comment-file，不引入正式轮次或门禁。
- outputs从完整submitted产物及实际依赖、修订关系推导；Run.outputOverrides只保存人工添加／移除，report及redo不写Run。outputs update支持重复--add／--remove及幂等操作；人工添加明确保留，人工移除隐藏具体ID，直到反向操作。默认图是成果根的依赖闭包，空集合不回退全图。移出根不删除产物，仍被依赖时仍显示。
- 部分report错误若给出已保存Artifact／Step身份，先执行回执中的run status恢复，不盲目原样重发；新report不承诺请求去重。terminal状态只读，Human决定取消后可abandon。
- 自由探索持久化使用五个项目模型Store；Run的data_id为run_id，其他实体为run_id/实体_id。Home CommandState不依赖Project登记。已知旧模型需显式project models initialize转换，保留历史及已有成果选择，转换为人工增删差值。
- 图属于现有Run模块；External点击显示完整来源和内容，产物浮窗左右展示内容及Review，历史选择只切图、浮窗翻页不关闭。空白或边上可按住鼠标手抓平移，悬停边高亮直接端点。无graph DSL、缩放或图编辑器。


详细字段和错误边界见changes/archive/completed/20261025-exploration-experience中的需求契约与实施方案。

## 结束、归档与恢复

`memsphere --project P run finish --run R` 默认采用当前推导成果，也可重复 `--artifact ID` 确认交付根；空运行也能结束。结束后不可继续提交，前文进入已结束状态。

```bash
memsphere --project P archive run R
memsphere --project P archive list runs
memsphere --project P archive restore run R
```

仅 done / abandoned 可归档。归档设置 Run.archived=true，普通列表隐藏该 Run；Run 模块“已归档”入口可找回，原地址仍可只读查看。归档不移动或删除绑定 Store 内的数据及 contentRef。恢复设置 archived=false，保留结束状态和产物关系。

View 顶部：运行中显示“结束运行”“废弃”，终态显示“归档”，归档记录原地址显示“恢复归档”。结束确认显示成果数量与名称，并提交这次确认的具体成果集合；无成果时显示“无交付成果”。依赖图使用本地 ELK 分层布局，测量实际节点尺寸并绕开节点，错开连线端点，悬停高亮仍关联直接端点。
