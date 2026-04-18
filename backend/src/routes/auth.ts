import { Router, Request, Response } from "express";
import { supabaseClient } from "../config/supabase";
import { AppError, handleError } from "../utils/errorHandler";
import { authLimiter } from "../middleware/rateLimiter";
import logger from "../utils/logger";

const router = Router();

/**
 * Auth Routes
 * SECURITY: All endpoints are rate-limited to prevent brute force
 */

/**
 * POST /auth/signup
 * Register a new user with email and password using Supabase Auth
 */
router.post("/signup", authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = req.body;

    // Validate input
    if (!email || !password) {
      throw new AppError(
        "Email and password are required",
        "MISSING_CREDENTIALS",
        400
      );
    }

    if (password.length < 8) {
      throw new AppError(
        "Password must be at least 8 characters",
        "INVALID_PASSWORD",
        400
      );
    }

    // Sign up with Supabase Auth
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || "",
        },
      },
    });

    if (error) {
      logger.warn("Signup error", { email, error: error.message });
      if (error.message.toLowerCase().includes("rate limit")) {
        throw new AppError(
          "Signup temporarily rate-limited. Please wait a minute and try again, or log in if you already have an account.",
          "SIGNUP_RATE_LIMITED",
          429
        );
      }
      throw new AppError(
        error.message || "Signup failed",
        "SIGNUP_ERROR",
        400
      );
    }

    if (!data.user) {
      throw new AppError("User creation failed", "USER_CREATION_FAILED", 500);
    }

    logger.info("User signed up", { userId: data.user.id, email });

    return res.status(201).json({
      message: "Signup successful. Please check your email to confirm.",
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (error) {
    return handleError(error as Error, res);
  }
});

/**
 * POST /auth/login
 * Authenticate user and return JWT token
 */
router.post("/login", authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      throw new AppError(
        "Email and password are required",
        "MISSING_CREDENTIALS",
        400
      );
    }

    // Authenticate with Supabase
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      logger.warn("Login failed", { email, error: error?.message });
      throw new AppError(
        "Invalid email or password",
        "INVALID_CREDENTIALS",
        401
      );
    }

    logger.info("User logged in", { userId: data.user.id, email });

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  } catch (error) {
    return handleError(error as Error, res);
  }
});

/**
 * POST /auth/refresh
 * Refresh JWT token using refresh token
 */
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError(
        "Refresh token is required",
        "MISSING_REFRESH_TOKEN",
        400
      );
    }

    const { data, error } = await supabaseClient.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      logger.warn("Token refresh failed");
      throw new AppError("Failed to refresh token", "REFRESH_FAILED", 401);
    }

    logger.info("Token refreshed");

    return res.status(200).json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  } catch (error) {
    return handleError(error as Error, res);
  }
});

export default router;
