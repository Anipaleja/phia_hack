import { Router, Request, Response } from "express";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { lookalikeLimiter, searchLimiter } from "../middleware/rateLimiter";
import { handleError } from "../utils/errorHandler";
import logger from "../utils/logger";
import ShoppingAgentService from "../services/shoppingAgentService";
import AIService from "../services/aiService";
import AnalyticsService from "../services/analyticsService";
import ShareService from "../services/shareService";
import CelebrityLookalikeService from "../services/celebrityLookalikeService";
import { supabaseClient } from "../config/supabase";
import {
  GenerateStylesRequest,
  GenerateOutfitRequest,
  OutfitResponse,
  GenerateStylesResponse,
  GenerateOutfitResponse,
} from "../types";

const router = Router();

/**
 * AI & Shopping Agent Routes
 */

/**
 * POST /ai/generate-styles
 * Generate fashion styles using AI
 * Endpoint for testing AI service independently
 */
router.post(
  "/generate-styles",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { prompt, modelPreference } = req.body as GenerateStylesRequest;

      logger.info("Generating styles", {
        userId: req.user?.id,
        promptLength: prompt?.length,
      });

      const response = await AIService.generateStyles(
        prompt,
        modelPreference
      );

      const result: GenerateStylesResponse = {
        styles: response.styles,
        model_used: response.provider,
        generated_at: response.timestamp,
      };

      return res.status(200).json(result);
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * POST /outfits/search
 * Main endpoint: Generate complete outfit with images and 3-tier pricing
 * SECURITY: Rate-limited per user to prevent abuse of expensive operations
 */
router.post(
  "/search",
  authMiddleware,
  searchLimiter,
  async (req: Request, res: Response) => {
    try {
      const { prompt, budgetTier, includeHistory } =
        req.body as GenerateOutfitRequest;
      const userId = req.user?.id;

      logger.info("Starting outfit search", {
        userId,
        promptLength: prompt?.length,
        budgetTier,
      });

      // Validate budget tier
      if (
        budgetTier &&
        !["all", "cheap", "mid", "expensive"].includes(budgetTier)
      ) {
        return res.status(400).json({
          error: {
            code: "INVALID_BUDGET_TIER",
            message:
              "Budget tier must be one of: all, cheap, mid, expensive",
          },
        });
      }

      // Generate outfit with recommendations and cache metadata
      const outfitResponse = await ShoppingAgentService.buildOutfit(
        prompt,
        budgetTier || "all"
      );

      // Save search to database if user wants history
      if (includeHistory && userId) {
        try {
          await supabaseClient.from("searches").insert({
            user_id: userId,
            prompt,
            ai_response: JSON.stringify(outfitResponse),
            created_at: new Date().toISOString(),
          });
          logger.info("Search saved to history", { userId });
        } catch (error) {
          logger.warn("Failed to save search history", {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Don't fail the request if history saving fails
        }
      }

      const result: GenerateOutfitResponse = outfitResponse;

      logger.info("Outfit search completed successfully", {
        userId,
        itemCount: outfitResponse.variants.length,
        cached: outfitResponse.cached,
      });

      return res.status(200).json(result);
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * POST /outfits/lookalike
 * Match uploaded selfie to closest celebrity from the hardcoded roster.
 */
router.post(
  "/lookalike",
  optionalAuthMiddleware,
  lookalikeLimiter,
  async (req: Request, res: Response) => {
    try {
      const imageDataUrl = typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl : "";
      const genderRaw = typeof req.body?.gender === "string" ? req.body.gender.trim().toLowerCase() : "";

      if (!imageDataUrl) {
        return res.status(400).json({
          error: {
            code: "MISSING_IMAGE",
            message: "imageDataUrl is required",
          },
        });
      }

      if (!genderRaw) {
        return res.status(400).json({
          error: {
            code: "MISSING_GENDER",
            message: "gender is required and must be male or female",
          },
        });
      }

      if (genderRaw !== "male" && genderRaw !== "female") {
        return res.status(400).json({
          error: {
            code: "INVALID_GENDER",
            message: "gender must be male or female",
          },
        });
      }

      const gender = genderRaw as "male" | "female";

      logger.info("Processing celebrity lookalike request", {
        userId: req.user?.id,
        gender,
      });

      const result = await CelebrityLookalikeService.findClosestCelebrity(imageDataUrl, gender);

      return res.status(200).json(result);
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * GET /analytics/summary
 * Lightweight analytics dashboard for demo visibility
 */
router.get(
  "/analytics/summary",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const summary = AnalyticsService.getSummary();

      return res.status(200).json({
        topPrompts: summary.topPrompts,
        topVibes: summary.topVibes,
        cacheHitRate: summary.cacheHitRate,
        avgLatencyMs: summary.avgLatencyMs,
        totalEvents: summary.totalEvents,
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * POST /outfits/share
 * Creates a shareable outfit link from a generated outfit response.
 */
router.post(
  "/share",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { outfit } = req.body as { outfit: OutfitResponse };

      if (!outfit || !outfit.prompt || !Array.isArray(outfit.variants)) {
        return res.status(400).json({
          error: {
            code: "INVALID_OUTFIT_PAYLOAD",
            message: "Body must include a valid outfit response",
          },
        });
      }

      const shared = ShareService.createShare(outfit);

      return res.status(201).json({
        shareId: shared.id,
        shareUrl: `/outfits/shared/${shared.id}`,
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * GET /outfits/shared/:id
 * Public endpoint for shared outfit retrieval.
 */
router.get(
  "/shared/:id",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const shared = ShareService.getSharedOutfit(id);

      if (!shared) {
        return res.status(404).json({
          error: {
            code: "SHARED_OUTFIT_NOT_FOUND",
            message: "Shared outfit not found",
          },
        });
      }

      return res.status(200).json({
        id: shared.id,
        createdAt: shared.createdAt,
        outfit: shared.outfit,
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * GET /outfits/search-history
 * Get user's past outfit searches
 */
router.get(
  "/search-history",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      logger.info("Fetching search history", { userId, limit });

      const { data, error } = await supabaseClient
        .from("searches")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return res.status(200).json({
        searches: data || [],
        totalCount: data?.length || 0,
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * POST /outfits/save
 * Save an outfit to user's favorites
 */
router.post(
  "/save",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { outfit, prompt } = req.body;

      if (!outfit) {
        return res.status(400).json({
          error: {
            code: "MISSING_OUTFIT",
            message: "Outfit data is required",
          },
        });
      }

      logger.info("Saving outfit", { userId });

      // Insert into saved_outfits table
      const { data, error } = await supabaseClient
        .from("saved_outfits")
        .insert({
          user_id: userId,
          outfit_data: JSON.stringify(outfit),
          prompt,
          created_at: new Date().toISOString(),
        })
        .select();

      if (error) {
        throw error;
      }

      return res.status(201).json({
        message: "Outfit saved successfully",
        outfitId: data?.[0]?.id,
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * GET /outfits/saved
 * Get user's saved outfits
 */
router.get(
  "/saved",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      logger.info("Fetching saved outfits", { userId, limit });

      const { data, error } = await supabaseClient
        .from("saved_outfits")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return res.status(200).json({
        outfits: data || [],
        totalCount: data?.length || 0,
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

/**
 * DELETE /outfits/:outfitId
 * Delete a saved outfit
 */
router.delete(
  "/:outfitId",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { outfitId } = req.params;

      logger.info("Deleting outfit", { userId, outfitId });

      const { error } = await supabaseClient
        .from("saved_outfits")
        .delete()
        .eq("id", outfitId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }

      return res.status(200).json({
        message: "Outfit deleted successfully",
      });
    } catch (error) {
      return handleError(error as Error, res);
    }
  }
);

export default router;
