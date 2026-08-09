/**
 * Simple in-memory rate limiter.
 *
 * For single-instance deployments. In a multi-instance setup, replace
 * with a Redis-backed rate limiter. Uses a sliding window per key.
 */

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Check if a request is allowed under the rate limit.
 * Returns { allowed: boolean, remaining: number, resetAt: number }.
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  // If bucket expired or doesn't exist, create a new one
  if (!bucket || bucket.resetAt <= now) {
    const newBucket: Bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, newBucket);
    return { allowed: true, remaining: maxRequests - 1, resetAt: newBucket.resetAt };
  }

  // Bucket exists and is valid
  if (bucket.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count++;
  return {
    allowed: true,
    remaining: maxRequests - bucket.count,
    resetAt: bucket.resetAt,
  };
}

/**
 * Get a rate-limit key from a Next.js request (IP address).
 * Falls back to a generic key if no IP can be determined.
 */
export function getRateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

// Periodically clean up expired buckets to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, 60_000); // Clean up every minute