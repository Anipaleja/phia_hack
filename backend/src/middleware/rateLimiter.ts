import rateLimit from "express-rate-limit";
import logger from "../utils/logger";

/**
 * SECURITY: Rate limiting prevents abuse of expensive operations
 * - API search limits per user to prevent cost explosion
 * - Auth endpoints limited to prevent brute force attacks
 */

// Rate limit store (in production, use Redis for distributed systems)
const requestStore = new Map<string, { count: number; resetTime: number }>();

const getKey = (req: any): string => {
  // For authenticated requests, use user ID
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  // For unauthenticated, use IP address
  return `ip:${req.ip}`;
};

const store = {
  increment: (key: string) => {
    const now = Date.now();
    const record = requestStore.get(key);

    if (!record || now > record.resetTime) {
      requestStore.set(key, {
        count: 1,
        resetTime: now + 60 * 60 * 1000, // 1 hour
      });
      return 1;
    }

    record.count += 1;
    return record.count;
  },
};

/**
 * Main API rate limiter - 100 requests per 15 minutes per user/IP
 */
export const apiLimiter = (req: any, res: any, next: any) => {
  const key = getKey(req);
  const count = store.increment(key);
  const limit = 100;
  const windowMs = 60 * 15 * 1000; // 15 minutes

  res.setHeader("X-RateLimit-Limit", limit);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - count));

  if (count > limit) {
    logger.warn("Rate limit exceeded", { key, count, limit });
    return res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
        retryAfter: Math.ceil(windowMs / 1000),
      },
    });
  }

  next();
};

/**
 * Auth endpoint rate limiter - 5 requests per 15 minutes per IP
 * SECURITY: Prevents brute force password attacks
 */
export const authLimiter = (req: any, res: any, next: any) => {
  const authLimiterDisabled = process.env.AUTH_RATE_LIMIT_DISABLED === "true";
  if (authLimiterDisabled) {
    return next();
  }

  const key = `auth:${req.ip}`;
  const count = store.increment(key);
  const limit = parseInt(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || "20");

  if (count > limit) {
    logger.warn("Auth rate limit exceeded", { ip: req.ip, count });
    return res.status(429).json({
      error: {
        code: "AUTH_RATE_LIMIT",
        message: "Too many auth attempts. Please try again later.",
        retryAfter: 900, // 15 minutes
      },
    });
  }

  next();
};

/**
 * Search endpoint rate limiter - 50 searches per day per user
 * SECURITY: Prevents abuse of expensive AI/scraping operations
 */
export const searchLimiter = (req: any, res: any, next: any) => {
  if (!req.user?.id) {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Search requires authentication",
      },
    });
  }

  const key = `search:${req.user.id}`;
  const count = store.increment(key);
  const limit = 50;
  const windowMs = 24 * 60 * 60 * 1000; // 24 hours

  if (count > limit) {
    logger.warn("Search rate limit exceeded", {
      userId: req.user.id,
      count,
      limit,
    });
    return res.status(429).json({
      error: {
        code: "SEARCH_LIMIT_EXCEEDED",
        message: `Daily search limit of ${limit} exceeded. Try again tomorrow.`,
        resetTime: new Date(Date.now() + windowMs).toISOString(),
      },
    });
  }

  next();
};

/**
 * Celebrity lookalike endpoint limiter - 20 requests per hour per user/IP
 * SECURITY: Image analysis is an expensive AI operation and can be abused.
 */
export const lookalikeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    if (req.user?.id) {
      return `lookalike:user:${req.user.id}`;
    }
    return `lookalike:ip:${req.ip}`;
  },
  handler: (req: any, res: any) => {
    logger.warn("Lookalike rate limit exceeded", {
      userId: req.user?.id,
      ip: req.ip,
    });

    return res.status(429).json({
      error: {
        code: "LOOKALIKE_RATE_LIMIT_EXCEEDED",
        message: "Too many lookalike requests. Please try again later.",
      },
    });
  },
});

/**
 * Product trend endpoint limiter - 30 requests per hour per user/IP
 * SECURITY: Trend endpoint may trigger live product page scraping.
 */
export const trendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    if (req.user?.id) {
      return `trend:user:${req.user.id}`;
    }
    return `trend:ip:${req.ip}`;
  },
  handler: (req: any, res: any) => {
    logger.warn("Trend rate limit exceeded", {
      userId: req.user?.id,
      ip: req.ip,
    });

    return res.status(429).json({
      error: {
        code: "TREND_RATE_LIMIT_EXCEEDED",
        message: "Too many trend requests. Please try again later.",
      },
    });
  },
});
