// Upstash-backed cache for cross-instance aggregate queries.
//
// Why Upstash and not unstable_cache: Next's per-instance in-memory cache
// resets on cold start and isn't shared across the serverless fan-out.
// For aggregate queries that run on every render (facets, counts,
// metrics summary), an external KV is the only thing that turns
// N_instances × N_requests into ~1 hit per TTL.
//
// Reads gracefully degrade to a direct DB call when Redis isn't
// configured (local dev, missing env). Writes are best-effort.

import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

type CacheOptions = {
  key: string;
  ttlSeconds: number;
};

export async function cachedAggregate<T>(
  options: CacheOptions,
  compute: () => Promise<T>,
): Promise<T> {
  if (!redis) return compute();

  try {
    const cached = await redis.get<T>(options.key);
    if (cached !== null && cached !== undefined) return cached;
  } catch {
    /* fall through to DB */
  }

  const fresh = await compute();
  if (fresh !== null && fresh !== undefined) {
    redis.set(options.key, fresh, { ex: options.ttlSeconds }).catch(() => {
      /* best-effort */
    });
  }
  return fresh;
}

// Invalidate keys after writes that change the aggregate (approve,
// reject, install bump). Safe no-op when Redis isn't configured.
export async function invalidateAggregates(...keys: string[]): Promise<void> {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    /* best-effort */
  }
}

export const AGGREGATE_KEYS = {
  facets: "petdex:agg:facets:v1",
  approvedCount: "petdex:agg:approved-count:v1",
  metricsSummary: "petdex:agg:metrics-summary:v1",
  batches: "petdex:agg:batches:v1",
} as const;
