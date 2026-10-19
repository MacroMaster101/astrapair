/**
 * In-memory sliding-window limiter. Per server instance only; good enough for
 * the MVP and replaced by a shared store in Sprint 5.
 */
export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = Number.POSITIVE_INFINITY,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
  /**
   * Most keys held at once, for keys a client can choose. A new key that finds
   * the map full first drops keys with nothing left in the window, then the
   * oldest key. Default: no cap.
   */
  maxKeys?: number;
}) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string): boolean {
      const t = now();
      if (!hits.has(key) && hits.size >= maxKeys) {
        for (const [k, times] of hits) {
          if (times.every((x) => t - x >= windowMs)) hits.delete(k);
        }
        if (hits.size >= maxKeys) {
          const oldest = hits.keys().next().value;
          if (oldest !== undefined) hits.delete(oldest);
        }
      }
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(t);
      if (recent.length > 0) {
        hits.set(key, recent);
      } else {
        hits.delete(key);
      }
      return allowed;
    },
  };
}
