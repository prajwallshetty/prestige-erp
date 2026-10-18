import "server-only";

/**
 * Access-code login rate limiting + lockout, in-process. Failed attempts are
 * tracked per key; after MAX failures within the window the key is locked out
 * until the window expires. A process restart clears it — acceptable for a
 * single-node deployment; a Redis-backed store can slot in behind the same
 * functions later.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

export const RATE_LIMITS = {
  LOGIN: { limit: 10, windowMs: 5 * 60 * 1000 },
  ACCESS_CODE: { limit: 5, windowMs: 15 * 60 * 1000 },
  MUTATION: { limit: 60, windowMs: 60 * 1000 },
  EXPORT: { limit: 20, windowMs: 60 * 1000 },
} as const;

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fixed-window limiter for named buckets. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.firstAt > windowMs) {
    attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return { success: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (entry.lockedUntil > now) {
    return {
      success: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }

  entry.count += 1;
  if (entry.count > limit) {
    entry.lockedUntil = entry.firstAt + windowMs;
    return { success: false, remaining: 0, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  return { success: true, remaining: limit - entry.count, retryAfterSeconds: 0 };
}

// --- Access-code specific helpers -----------------------------------------

function fingerprint(scope: string, code: string): string {
  return `access-code:${scope}:${code.toLowerCase().trim()}`;
}

export interface AccessCodeAttemptResult {
  allowed: boolean;
  remainingAttempts: number;
  lockedForSeconds: number;
}

export function checkAccessCodeAttempt(scope: string, code: string): AccessCodeAttemptResult {
  const key = fingerprint(scope, code);
  const entry = attempts.get(key);
  const now = Date.now();

  if (entry && entry.lockedUntil > now) {
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedForSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }

  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 0, firstAt: now, lockedUntil: 0 });
  }

  return { allowed: true, remainingAttempts: MAX_ATTEMPTS, lockedForSeconds: 0 };
}

export function recordAccessCodeFailure(scope: string, code: string): AccessCodeAttemptResult {
  const key = fingerprint(scope, code);
  const now = Date.now();
  const entry = attempts.get(key) ?? { count: 0, firstAt: now, lockedUntil: 0 };

  if (now - entry.firstAt > WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = now;
  }

  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + WINDOW_MS;
  }
  attempts.set(key, entry);

  return {
    allowed: entry.lockedUntil <= now,
    remainingAttempts: Math.max(0, MAX_ATTEMPTS - entry.count),
    lockedForSeconds: entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1000) : 0,
  };
}

export function clearAccessCodeAttempts(scope: string, code: string): void {
  attempts.delete(fingerprint(scope, code));
}

/** Periodic cleanup so the map cannot grow unbounded. */
let lastSweep = Date.now();
export function sweepRateLimits(): void {
  const now = Date.now();
  if (now - lastSweep < 60 * 1000) return;
  lastSweep = now;
  for (const [key, entry] of attempts) {
    if (entry.lockedUntil < now && now - entry.firstAt > WINDOW_MS) attempts.delete(key);
  }
}
