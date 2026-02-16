import type { Request, Response, NextFunction } from "express";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Store: Map<name, Map<key, { count, resetAt }>>
const stores = new Map<string, Map<string, RateLimitEntry>>();

export function rateLimit(name: string, config: RateLimitConfig) {
  const store = new Map<string, RateLimitEntry>();
  stores.set(name, store);

  // Clean expired entries every minute
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 60_000);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + config.windowMs });
      return next();
    }

    if (entry.count >= config.maxRequests) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    entry.count++;
    return next();
  };
}

// Pre-configured limiters
export const generalLimiter = rateLimit("general", { windowMs: 60_000, maxRequests: 100 });
export const betLimiter = rateLimit("bets", { windowMs: 60_000, maxRequests: 5 });
export const withdrawLimiter = rateLimit("withdraw", { windowMs: 3600_000, maxRequests: 3 });
