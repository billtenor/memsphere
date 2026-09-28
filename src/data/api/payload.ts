/** 内容的序列化表示，与物理存储位置无关。 */
export type Payload = {
  /** 标准 MIME 类型，例如 application/json、image/jpeg。 */
  contentType: string;
  content: PayloadContent;
};

/** 字节内容的统一读取接口。 */
export interface PayloadContent {
  /** 每次调用都返回一条从起点读取同一内容的新流。 */
  stream(): ReadableStream<Uint8Array>;
}
