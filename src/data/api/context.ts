/** 一次操作共享的上下文；接收它的函数统一将其放在第一个参数。 */
export interface Context {
  /** 上游取消当前操作时发出的停止通知。 */
  readonly signal?: AbortSignal;
}
