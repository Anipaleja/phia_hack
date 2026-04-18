import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import logger from "./utils/logger";
import { handleError } from "./utils/errorHandler";
import { apiLimiter } from "./middleware/rateLimiter";
import { verifySupabaseConnection } from "./config/supabase";
import { verifyOllamaConnection } from "./config/aiConfig";
import PriceService from "./services/priceService";

// Load environment variables
dotenv.config();

// Route imports
import authRoutes from "./routes/auth";
import outfitRoutes from "./routes/outfits";
import userRoutes from "./routes/user";

const app = express();
const PORT = process.env.PORT || 3001;

/**
 * Middleware Setup
 */

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// CORS - allow frontend access
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  next();
});

// Apply rate limiting to all API routes
app.use("/api/", apiLimiter);

/**
 * Health Check Endpoint
 * Used to verify all services are running
 */
app.get("/health", async (req: Request, res: Response) => {
  try {
    const supabaseOk = await verifySupabaseConnection();
    const ollamaOk = await verifyOllamaConnection();

    const status = {
      status: supabaseOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      services: {
        supabase: supabaseOk ? "ok" : "unavailable",
        ollama: ollamaOk ? "ok" : "unavailable",
        openai: process.env.OPENAI_API_KEY ? "configured" : "not_configured",
        unsplash: process.env.UNSPLASH_ACCESS_KEY ? "configured" : "not_configured",
        pexels: process.env.PEXELS_API_KEY ? "configured" : "not_configured",
      },
    };

    const statusCode =
      supabaseOk && (ollamaOk || process.env.OPENAI_API_KEY)
        ? 200
        : 503;
    return res.status(statusCode).json(status);
  } catch (error) {
    logger.error("Health check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(503).json({
      status: "unhealthy",
      error: "Health check failed",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * API Routes
 */

// Auth routes (public, rate limited)
app.use("/api/auth", authRoutes);

// Outfit/shopping agent routes (authenticated, rate limited)
app.use("/api/outfits", outfitRoutes);

// User profile routes (authenticated)
app.use("/api/user", userRoutes);

/**
 * 404 Handler
 */
app.use((req: Request, res: Response) => {
  logger.warn("Not found", { method: req.method, path: req.path });
  return res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

/**
 * Global Error Handler
 */
app.use((err: Error | any, req: Request, res: Response, next: NextFunction) => {
  logger.error("Unhandled error", {
    error: err instanceof Error ? err.message : String(err),
    path: req.path,
    method: req.method,
    stack: err instanceof Error ? err.stack : undefined,
  });

  return handleError(err, res);
});

/**
 * Graceful Shutdown
 */
const gracefulShutdown = async () => {
  logger.info("Received shutdown signal, closing gracefully...");

  // Close Puppeteer browser
  try {
    await PriceService.closeBrowser();
  } catch (error) {
    logger.error("Error closing browser", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

/**
 * Start Server
 */
const startServer = async () => {
  try {
    // Verify critical services on startup
    logger.info("Verifying service connections...");
    const supabaseOk = await verifySupabaseConnection();

    if (!supabaseOk) {
      logger.error("Supabase connection failed - this is critical");
      process.exit(1);
    }

    // Ollama and OpenAI are not critical (fallback available)
    const ollamaOk = await verifyOllamaConnection();
    if (!ollamaOk && !process.env.OPENAI_API_KEY) {
      logger.error(
        "Both Ollama and OpenAI are unavailable - style generation will fail"
      );
    }

    // Start listening
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${PORT}`, {
        nodeEnv: process.env.NODE_ENV,
        port: PORT,
      });
      logger.info("Available endpoints:", {
        health: "GET /health",
        auth: "POST /api/auth/signup, /api/auth/login, /api/auth/refresh",
        outfits: "POST /api/outfits/search, GET /api/outfits/search-history",
        user: "GET /api/user/profile, PUT /api/user/profile",
      });
    });
  } catch (error) {
    logger.error("Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
};

// Start the server
startServer();

export default app;
