import { Request, Response, NextFunction } from "express";
import { supabaseClient } from "../config/supabase";
import { AppError } from "../utils/errorHandler";
import logger from "../utils/logger";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        aud?: string;
      };
    }
  }
}

/**
 * Auth Middleware: Verifies JWT token from Supabase
 * Validates token signature and extracts user ID
 * SECURITY: Only accepts valid tokens from Supabase auth
 */
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(
        "Missing or invalid authorization header",
        "MISSING_AUTH_HEADER",
        401
      );
    }

    const token = authHeader.substring(7);

    // Verify token using Supabase
    const { data, error } = await supabaseClient.auth.getUser(token);

    if (error || !data.user) {
      logger.warn("Invalid auth token attempted", {
        error: error?.message,
      });
      throw new AppError(
        "Invalid or expired token",
        "INVALID_TOKEN",
        401
      );
    }

    // Attach user to request context
    req.user = {
      id: data.user.id,
      email: data.user.email,
      aud: data.user.aud,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: { code: error.code, message: error.message },
      });
    }

    logger.error("Auth middleware error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: { code: "AUTH_ERROR", message: "Authentication failed" },
    });
  }
};

/**
 * Optional Auth Middleware: Attempts to authenticate but allows unauthenticated requests
 */
export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.substring(7);
      const { data } = await supabaseClient.auth.getUser(token);

      if (data.user) {
        req.user = {
          id: data.user.id,
          email: data.user.email,
          aud: data.user.aud,
        };
      }
    } catch (error) {
      logger.debug("Optional auth token validation failed");
    }
  }

  next();
};
