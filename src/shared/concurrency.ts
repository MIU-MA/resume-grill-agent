/**
 * Lightweight bounded concurrency utilities with AbortSignal propagation.
 * Zero external dependencies so core services stay self-contained.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Semaphore limit must be a positive integer.");
    }
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const index = this.waiters.indexOf(grant);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal?.reason ?? new Error("Operation aborted."));
        };
        const grant = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        if (signal) signal.addEventListener("abort", onAbort, { once: true });
        this.waiters.push(grant);
      });
    }
    this.active++;
    try {
      signal?.throwIfAborted();
      return await fn();
    } finally {
      this.active--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (!items.length) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runWorker = async () => {
    while (true) {
      signal?.throwIfAborted();
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}
