const MAX_TRACKED_BUCKETS = 20_000;

type Bucket = { count: number; expiresAt: number };
export type RateLimitDecision = { allowed: true; retryAfterSeconds: 0 } | { allowed: false; retryAfterSeconds: number };

const buckets = new Map<string, Bucket>();

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitDecision {
  if (!key || !Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new RangeError("Rate-limit key, limit, and window must be valid");
  }

  const current = buckets.get(key);
  if (!current || current.expiresAt <= now) {
    buckets.delete(key);
    buckets.set(key, { count: 1, expiresAt: now + windowMs });
    pruneBuckets(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1_000)),
    };
  }

  current.count += 1;
  buckets.delete(key);
  buckets.set(key, current);
  return { allowed: true, retryAfterSeconds: 0 };
}

function pruneBuckets(now: number): void {
  if (buckets.size <= MAX_TRACKED_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
  while (buckets.size > MAX_TRACKED_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}
