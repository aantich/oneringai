/** Start bounded observation immediately, before a driver fetches its canonical saved state. */
export function bufferManagedEvents<T>(stream: AsyncIterable<T> & { controller: AbortController }, maxBytes = 1024 * 1024): AsyncIterable<T> {
  const queue: T[] = []; let done = false; let error: unknown; let bytes = 0; let wake: (() => void) | undefined;
  const pump = (async () => {
    try { for await (const event of stream) { bytes += Buffer.byteLength(JSON.stringify(event)); if (bytes > maxBytes) throw new Error('Managed recovery event buffer exceeded'); queue.push(event); wake?.(); } }
    catch (failure) { error = failure; stream.controller.abort(); } finally { done = true; wake?.(); }
  })();
  return { async *[Symbol.asyncIterator]() {
    try { while (!done || queue.length) { const event = queue.shift(); if (event !== undefined) { bytes -= Buffer.byteLength(JSON.stringify(event)); yield event; } else await new Promise<void>(resolve => { wake = resolve; if (done || queue.length) resolve(); }); } if (error) throw error; }
    finally { stream.controller.abort(); void pump.catch(() => undefined); }
  } };
}
