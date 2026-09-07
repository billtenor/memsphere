# Portable Slot SDK 单例验证

外部 Bundle 通过 Host import map 把 `@memsphere/view-sdk` 统一解析到 `/assets/view-sdk.js`，因此 `portableSlots` 的 brand、validator 和 Token 对象来自同一个浏览器模块实例，不依赖各 Package 自行复制 SDK。浏览器回归同时加载独立 replacement 与官方 Bundle，并成功用同一 portable Token 完成 page shadow、data renderer 调用和异常 fallback，证明当前部署模型不存在结构伪造或 validator 身份漂移。

当前首版据此不引入额外 runtime fingerprint 握手。若未来允许 Package 打包内嵌 SDK 或跨 realm iframe，必须先新增显式 SDK fingerprint/bridge，不可把当前对象身份假设直接扩展到该部署模型。
