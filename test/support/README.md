# 模块测试支持

生产代码通过参数或构造器接收系统边界。这里的替身按场景创建，不替换全局 Node API。

| 实现 | 用途 |
| --- | --- |
| `MemoryValueStore` | 唯一创建、CAS 更新/删除、递增 revision、快照与分页；可注入真实模型校验和时钟 |
| `MemoryDataStore` | 按实际 Payload 读取字节；重新读取可取得独立流；拒绝模型不匹配 |
| `FakeMemoryProvider` | 提供 Memory 描述与内容并记录读取；Catalog 仍用真实实现 |
| `ManualClock` | 固定当前时间、手动推进等待、取消等待；不修改全局时间 |
| `FakeWorkers` | 控制进程身份/成员观察、记录停止请求；不模拟内核身份安全规则 |
| `MemoryViewState` | View 生命周期状态读写、按 PID 清理；权限和原子发布留给真实适配器 |

`MemoryValueStore.fork()` 共享底层记录和 revision，返回独立句柄；对一个句柄注入故障不会修改另一个句柄的方法。新建 Store 则完全隔离。

使用 `contextModuleFixture()` 可得到 `service`、`stores`、`reopen`、`clock` 和 `workers`。真实业务模块运行在这些边界上。需要外部正文时，传入显式 ContentReader，配合 MemoryDataStore；不访问项目目录寻找数据。

`valueStoreContract()` 同时用于内存和真实文件 Store，检查唯一性、版本竞争、删除重建、快照、分页及取消。它只约束共同的逻辑契约；文件权限、fsync、跨进程竞争、故障恢复和不可信路径仍由集成测试验证。

`FakeWorkers.stop()` 记录场景中的停止完成结果。停止失败、身份复用或仍有后代的场景应明确提供相应观察/失败；不能用默认空记录证明真实 OS 进程已经退出。
