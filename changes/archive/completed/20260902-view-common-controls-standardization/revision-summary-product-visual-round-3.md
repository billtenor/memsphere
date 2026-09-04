# 产品复验追加修订摘要

## 修改原因

Human 产品负责人在第二轮复验中继续发现公共参考页存在列表状态演示、Disclosure 状态辨识、Content List 行排版和 Combobox 控件辨识四组视觉问题。

## 本轮逐条修改

1. 将“内容列表状态”改名为“列表栏状态”，使用紧凑 Segmented 直接切换左侧真实 Shell Content List 的正常、加载和失败状态，删除正文中被 Grid 拉长的嵌套伪列表。
2. 将 Reference 公共组件改为交互、状态、结构三列自然高度布局，消除同行卡片互相拉伸产生的大块空白。
3. 为公共 Disclosure 增加标准系统箭头；展开态为强调底色加向下箭头，收起态为向右箭头，补充展开/收起自动化。
4. 重排公共 Content List 行：标题与单 Badge 同层，状态和动作仅在当前复杂示例项展示；非当前项恢复清晰的主副标题结构。
5. 为公共 Combobox 增加下拉箭头、展开翻转与“选择或搜索”提示，使可筛选下拉与普通输入框在收起时即可区分。
6. 修正 Disclosure 文案与箭头同时被分配弹性空间的问题，将箭头固定在标题栏最右侧。
7. 分离 Combobox 已选展示值和临时筛选词；选择后再次展开恢复全部候选项，输入后才过滤。
8. 为 Content List 失败反馈增加列表内边距，避免错误卡贴满列表栏边界。

## 验证

- `npm test`：531 项，530 通过，0 失败，1 项 Windows 专属测试按 Linux 条件跳过；pretest build 通过。
- 直接影响测试：45/45 通过，覆盖 Reference 组合、公共样式边界和响应式布局。
- `git diff --check`：通过。
- 真实 Firefox 复验新增 10 个状态证据：选中/普通列表行、紧凑三列、Disclosure 展开/收起及右侧对齐、Combobox 展开与重开全部选项、真实列表栏加载和失败态。

## 复验入口

- Reference Module：`http://127.0.0.1:30000/reference`
- 新增视觉证据：`evidence/product-visual-audit-round-2/10-list-selected.png` 至 `19-combobox-reopen-all.png`
