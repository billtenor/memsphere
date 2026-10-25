# 真实View验收

入口：http://127.0.0.1:30000/projects/memsphere/tasks/run-67ed4607-6fc0-4310-ba4b-8a9e0b201de0，使用已重启的当前构建；不是静态原型。

- 初次加载：5份当前主干产物、3份External，历史默认折叠，无需菜单选择最新版。
- 产物宽浮窗桌面及390×844布局正常，键盘Escape关闭；自动化真实Shell测试同时覆盖历史切图及同一浮窗翻页。
- External单栏浮窗无Review／版本控件，完整内容DOM长度90491，不受CLI的200 chars预览限制。
- 悬停真实边：edge=1、端点nodes=2；空白处手抓：从(0,0)滚至(200,70)，dialogs=0；松开后移动不继续平移。自动化另外覆盖释放、取消／历史交互。
- Console：0错误，0警告。

证据位于/tmp/memsphere-experience-tech：real-run-desktop.yaml、artifact-desktop.png、artifact-narrow.png、graph-desktop.png、browser-edge-state.json、browser-pan-confirmed.json、browser-console.log及浏览器操作日志。截图仅作证据，未替代真实操作。首次手抓定位落在历史控件，不发生画布拖动，随后确认空白位置重测；不将该定位误差记为产品故障。

## outputs推导修订复验

本轮Playwright CLI重新访问真实技术Run，确认5份Artifact、3份External、14条边；打开最新实施方案浮窗可见report不更新Run的新规则，Escape关闭，console 0错误0警告。自动化浏览器用例已补齐pointercancel、lostpointercapture与window blur的停止断言。证据为derived-real-view.yaml、derived-real-view-counts.json、derived-real-dialog.json及derived-browser-console.log；主文件原始证据属于前一轮，不混作本轮实测。
