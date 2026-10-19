# PR CI 跟进

PR：https://github.com/billtenor/memsphere/pull/109。
产品最终验收与三方实现评审已通过，产品功能范围没有改变。

初次 head 339c29752f2604b34d3b525347a077ca8907a42e 的 Windows Models & Settings UI 中，名称清空测试的功能断言通过，临时目录删除遇到 ENOTEMPTY，导致测试及汇总门禁失败。其余 18 项检查通过；汇总门禁实际耗时 236.8 秒，失败来自 TEST_RESULT=failure，而非超过 300 秒。
失败日志：https://github.com/billtenor/memsphere/actions/runs/39257857900/job/118077574618。

修复仅调整新增浏览器 fixture 的收尾：关闭浏览器 context 和 HTTP server 后，fs.rm 对暂时性的文件系统删除错误最多重试 5 次，递增等待 100 ms，总等待上限 1.5 秒。Windows 可能短暂保留目录项，有限重试避免该清理时序破坏功能测试；不重试测试主体、不改变断言、不忽略持续失败。

原 evidence/final-implementation-files.json 是产品验收时的冻结版本；本次 CI 补丁单独以 Git follow-up commit 记录，不覆盖历史证据。

Memory 没有新增修改，原 ChangeSet change-20261019-060004472z-18cf913a 已校验 passed，digest 6c81209fe21a50b2562ccbc7e23462b08ba59310ca1a0650db9cd24f180fbee7。
View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261019-060004472z-18cf913a。
提交后的再次 validate 提示相对当前 HEAD 无 Embedded Memory 差异，不作为新的成功校验凭据。

最终本地验证及远端最新 head 的全部检查结果由 Run 的 CI 跟进与最终交付 Artifact 记录。

本次补丁本地验证：浏览器受影响文件 7/7 通过；npm test -- --test-concurrency=4 全量 146 文件成功，1224 passed、0 failed、1 个 Windows 专属测试在 Linux 跳过（182.59 秒）；npm run typecheck、随 npm test 执行的 build、memsphere validate 及 git diff --check 通过。最初沙箱测试未产生有效结果，已在支持本地服务和 Chromium 的环境完整重跑，以成功重跑为凭据。
