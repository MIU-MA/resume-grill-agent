export type CachedResource = { text: string; url: string };

type Entry = {
  value: CachedResource;
  bytes: number;
  expiresAt: number;
};

/**
 * Bounded LRU + TTL cache with in-flight SingleFlight request coalescing.
 * Used exclusively for verified public HTTPS GET responses.
 */
export class ResourceCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<CachedResource>>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries = 64,
    private readonly maxTotalBytes = 16 * 1024 * 1024,
  ) {}

  get(key: string): CachedResource | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    // Refresh LRU order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: CachedResource, ttlMs: number) {
    if (ttlMs <= 0) return;
    const bytes = Buffer.byteLength(value.text, "utf8");
    if (bytes > this.maxTotalBytes) return;
    this.delete(key);
    while (
      this.entries.size >= this.maxEntries ||
      this.totalBytes + bytes > this.maxTotalBytes
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(key, {
      value,
      bytes,
      expiresAt: Date.now() + ttlMs,
    });
    this.totalBytes += bytes;
  }

  async coalesce(
    key: string,
    loader: () => Promise<CachedResource>,
    ttlMs = 0,
  ): Promise<CachedResource> {
    if (ttlMs > 0) {
      const cached = this.get(key);
      if (cached) return cached;
    }
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const task = loader().then((result) => {
      if (ttlMs > 0) this.set(key, result, ttlMs);
      return result;
    });
    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
    }
  }

  clear() {
    this.entries.clear();
    this.totalBytes = 0;
  }

  get size() {
    return this.entries.size;
  }

  private delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
  }
}
