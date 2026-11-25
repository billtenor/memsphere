/** Await each write before requesting another chunk from a streaming encoder. */
export function writeCliChunk(chunk: string | Uint8Array): Promise<void> {
  const stdout = process.stdout;
  return new Promise((resolve, reject) => {
    // Node calls the write callback and emits the stream failure. Account for
    // both notifications while this write owns the output.
    const onError = (error: Error) => reject(error);
    stdout.once("error", onError);
    stdout.write(chunk, error => {
      if (error) {
        setImmediate(() => {
          stdout.off("error", onError);
          reject(error);
        });
      } else {
        stdout.off("error", onError);
        resolve();
      }
    });
  });
}
