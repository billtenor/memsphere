# 自由探索 CLI

先在 Home 的 Runner Agent 设置中启用身份。Continue 从当前 Codex/Traex 会话自动定位状态，不接受独立 contextId；无身份时使用原生命令。run enter 或 run step enter 显式切换上下文。

没有预定义 Procedure 时，使用 `memsphere run start --name "任务名称" --output json`，回执返回 Run ID；身份开启时按会话建立 Continue 上下文，flow、ChangeSet 和 ACP 保持原入口。

```bash
memsphere continue --help
memsphere run artifact show --run R --artifact A --out input.md
memsphere continue report --name "方案" --artifact-file plan.md --content-type text/markdown --depends-on artifact:A
memsphere continue external add --source "用户补充" --content "约束说明"
memsphere continue review create --artifact B --reviewer human --comment "修改要求一" --comment "修改要求二"
memsphere continue report --revised-from B --artifact-file revised.md
memsphere run outputs list --run R
memsphere continue outputs update --remove A --add B_NEW
memsphere continue finish --authorization "用户已检查当前成果并明确确认结束"
```

- 完整成果准备好后直接 report，不预建产物或声明开始工作；系统关联 Step。文本、--artifact-file、结构化 --file 互斥。结构化只接收 name、content/contentRef、dependencies、tags、revisedFrom、revisedSummary，系统身份字段拒绝。
- Continue 根据会话定位 Run、已进入的 Schema Step 或当前 Review。产物版本、依赖、标签和交付根由调用者明确选择。终态仍可用原生命令查询。
- 只按真实需要读取材料，不为登记依赖重复读取。Artifact／External 正文超过200 chars时仅预览前200字符加...，并提示完整导出命令；--out完整排他导出原始字节，网页内容不截断。JSON正文及提示在同一合法对象内。
- content由model（definedBy、definition JSON字符串）和payload（contentType、content字符串）构成，或用contentRef（storeId、dataId、sha256）固定引用；已提交内容及依赖不可改，修订创建新ID。revisedFrom不等于依赖，修订省略依赖继承原集合，显式依赖完整替换，结构化[]清空。
- 每份产物自动带default标签，--tag及artifact tag可添加；--depends-on接受artifact:ID、external:ID、tag:名称，标签当次固定为具体ID。external add支持短source/content或结构化file，成功只返回runId、externalId。轻量Review支持重复--comment或--comment-file，不引入正式轮次或门禁。
- outputs从完整submitted产物及实际依赖、修订关系推导；Run.outputOverrides只保存人工添加／移除，report及redo不写Run。outputs update支持重复--add／--remove及幂等操作；人工添加明确保留，人工移除隐藏具体ID，直到反向操作。默认图是成果根的依赖闭包，空集合不回退全图。移出根不删除产物，仍被依赖时仍显示。
- 部分report错误若给出已保存Artifact／Step身份，先执行回执中的run status恢复，不盲目原样重发；新report不承诺请求去重。terminal状态只读，Human决定取消后可abandon。
- 自由探索持久化使用五个项目模型Store；Run的data_id为run_id，其他实体为run_id/实体_id。Home CommandState不依赖Project登记。已知旧模型需显式project models initialize转换，保留历史及已有成果选择，转换为人工增删差值。
- 图属于现有Run模块；External点击显示完整来源和内容，产物浮窗左右展示内容及Review，历史选择只切图、浮窗翻页不关闭。空白或边上可按住鼠标手抓平移，悬停边高亮直接端点。无graph DSL、缩放或图编辑器。


详细字段和错误边界见changes/archive/completed/20261025-exploration-experience中的需求契约与实施方案。

## Schema 草稿

| 操作 | 原生命令 | Continue |
|---|---|---|
| 开始撰写 | `run enter-schema my-schema --run R --name "报告" --content-type text/markdown` | `continue enter-schema my-schema --name "报告" --content-type text/markdown` |
| 恢复草稿 | `run enter-schema --run R --step S` | `continue enter-schema --step S` |
| 修订 Schema 产物 | `run enter-schema --run R --revised-from A` | `continue enter-schema --revised-from A` |
| 查看当前位置 | `run schema show --run R --step S` | `continue schema show` |
| 保存一项 | `run schema report --run R --step S --position P --artifact "正文"` | `continue schema report --position P --artifact "正文"` |
| 跳过可选项 | `run skip --run R --step S --position P` | `continue skip --position P` |
| 设置重复次数 | `run repeat 2 --run R --step S --position P` | `continue repeat 2 --position P` |
| 导出草稿 | `run artifact export --run R --step S --file draft.md` | `continue artifact export --file draft.md` |
| 校验并提交 | `run report --run R --step S --depends-on external:E` | `continue report --depends-on external:E` |

每次保存后使用最新的 `position`。字段正文也可由 `--artifact-file` 读取，`--artifact ""` 交由 Schema 校验。最终可用已保存的完整草稿，也可明确提供检查后的完整正文。提交保留 Artifact ID。修订创建新 Step 和草稿，沿用旧版冻结 Schema。写入中断后按回执用 `enter-schema --step S` 恢复。

## 按 Statement 渐进评审

| 操作 | 原生命令 | Continue |
|---|---|---|
| 查看配置与缺项 | `run step show --run R --step S` | `continue step show --step S` |
| 设置规则和评审人 | `run step configure --run R --step S --asserts statements/required --reviewer runner` | `continue step configure --step S --asserts statements/required --reviewer runner` |
| 发起 | `run review start --run R --artifact A` | `continue review start --artifact A` |
| 恢复指定轮次 | `run enter --run R --review V` | — |
| 查看节点 | `run review show --run R --review V` | `continue review show` |
| 保存节点 | `run review report --run R --review V --artifact '{"applicable":true}'` | `continue review report --artifact '{"applicable":true}'` |
| 提交结论 | `run review submit --run R --review V --artifact '{"vote":"approve"}'` | `continue review submit --artifact '{"vote":"approve"}'` |
| 等待或重试委派 | `run review wait --review V`、`run review retry --review V` | `continue review wait`、`continue review retry` |
| 查看历史 | `run review list --run R --artifact A --progressive` | `continue review list --artifact A --progressive` |

`--asserts` 与 `--suggests` 可重复，各自完整替换该通道。清空用 `--clear-asserts`、`--clear-suggests` 或 `--clear-reviewer`。修订创建的新 Step 会复制当时的配置。`--reviewer project:ID` 绑定 Project 中拥有材料读取和评审权限的 Agent，由系统派发。Runner 可以查看、等待和重试委派。

发起时固定候选版本、其声明依赖及授权上游产物直接关联的 External、规则来源和执行者。只有登记到 Run 的 External 需先通过 `report --depends-on external:E` 关联到产物。同一候选和冻结配置已有未提交轮次时返回原 Review ID。Runner 渐进审查也可用 `review show --node NODE` 或 `--all` 回看，用 `review update` 和 `review comment add/update/delete` 编辑。节点和结论支持与委派相同的 JSON 输入。轻量评论仍从 `review create/list/show` 读取，渐进结果有独立轮次。

Run 页提供流程视角与产物视角。两处均可打开同一 Step 的执行信息、草稿或已提交 Artifact，并从已提交版本查阅评审记录。

## 结束、归档与恢复

Artifact 上报完成后 Run 保持 `running`，用户可继续反馈，Agent 在同一个 Run 中补充探索或提交修订。Agent 应交付当前成果并等待人工确认；结束当前回复不等于结束 Run。

只有用户明确确认当前成果并同意结束后，才执行 `memsphere --project P run finish --run R --authorization "用户确认依据"`。缺少或提供空白依据会返回 `HUMAN_CONFIRMATION_REQUIRED`，Run 与 Continue 保持开放。依据由调用者如实填写，CLI 不验证对话中的真实授权；Agent 不得自行编造。默认采用当前推导成果，也可重复 `--artifact ID` 选择用户确认的交付根；空运行也需要用户确认。确认后修改过的成果需要重新确认。结束后不可继续提交，前文进入已结束状态。

```bash
memsphere --project P archive run R
memsphere --project P archive list runs
memsphere --project P archive restore run R
```

仅 done / abandoned 可归档。归档设置 Run.archived=true，普通列表隐藏该 Run；Run 模块“已归档”入口可找回，原地址仍可只读查看。归档不移动或删除绑定 Store 内的数据及 contentRef。恢复设置 archived=false，保留结束状态和产物关系。

View 顶部：运行中显示“结束运行”“废弃”，终态显示“归档”，归档记录原地址显示“恢复归档”。结束确认显示成果数量与名称，并提交这次确认的具体成果集合；无成果时显示“无交付成果”。依赖图使用本地 ELK 分层布局，测量实际节点尺寸并绕开节点，错开连线端点，悬停高亮仍关联直接端点。
