/** Compose cancellation sources with explicit listener/timer disposal. */
export function createExecutionSignal(signals: Array<AbortSignal | null | undefined>): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const removers: Array<() => void> = [];
  for (const signal of new Set(signals.filter((s): s is AbortSignal => !!s))) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    removers.push(() => signal.removeEventListener('abort', onAbort));
  }
  return { controller, dispose: () => removers.splice(0).forEach((remove) => remove()) };
}

/** Wait without leaking a listener, even when the underlying operation ignores abort. */
export async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  // Observe an already-started promise even if the signal was aborted beforehand.
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw signal.reason;
  }
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await withAbort(new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }), signal);
  } finally {
    clearTimeout(timer);
  }
}
