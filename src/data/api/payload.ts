/** 内容的序列化表示，与物理存储位置无关。 */
export type Payload = {
  /** 标准 MIME 类型，例如 application/json、image/jpeg。 */
  contentType: string;
  content: PayloadContent;
};

/** 字节内容的统一读取接口，只保证一次消费，可由生产方持续产生内容。 */
export interface PayloadContent {
  /**
   * 取得本次消费使用的流；调用方不得依赖再次调用能重放内容。
   * 流关闭后读到 EOF 表示内容结束；出错或取消不表示正常结束。
   * 需要再次读取存储内容时，应重新调用 Store.get()。
   */
  stream(): ReadableStream<Uint8Array>;
}
