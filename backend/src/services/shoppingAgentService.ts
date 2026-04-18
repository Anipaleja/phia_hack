import NodeCache from "node-cache";
import { StyleItem, OutfitItem, PricePoint } from "../types";
import { OutfitResponse } from "../types";
import { AppError } from "../utils/errorHandler";
import logger from "../utils/logger";
import AIService from "./aiService";
import AnalyticsService from "./analyticsService";
import ImageService from "./imageService";
import PriceService from "./priceService";
import RecommendationService from "./recommendationService";
import ShareService from "./shareService";

/**
 * Shopping Agent Service: Orchestrates the entire shopping workflow
 * Combines AI style generation, image fetching, and price scraping
 * Implements 3-tier pricing logic (cheap, mid, expensive)
 */

const outfitCache = new NodeCache({ stdTTL: 3600 });
const promptCache = new NodeCache({ stdTTL: 3600 });

export class ShoppingAgentService {
  /**
   * Select best price point based on tier preference
   */
  private static selectPriceByTier(
    pricePoints: PricePoint[],
    tier: "cheap" | "mid" | "expensive"
  ): PricePoint | null {
    if (!pricePoints || pricePoints.length === 0) {
      return null;
    }

    const sorted = [...pricePoints].sort((a, b) => a.price - b.price);

    switch (tier) {
      case "cheap":
        return sorted[0]; // Lowest price
      case "expensive":
        return sorted[sorted.length - 1]; // Highest price
      case "mid":
        // Middle price (or average of lower and upper quartiles)
        const midIndex = Math.floor(sorted.length / 2);
        return sorted[midIndex];
      default:
        return sorted[0];
    }
  }

  /**
   * Generate a complete outfit with 3-tier pricing
   * Returns outfit items with images and prices at each tier
   */
  static async generateOutfit(
    prompt: string,
    budgetTier: "all" | "cheap" | "mid" | "expensive" = "all"
  ): Promise<OutfitItem[]> {
    try {
      // Step 1: Generate styles using AI
      logger.info("Starting outfit generation", { prompt, budgetTier });

      const aiResponse = await AIService.generateStyles(prompt);
      const styleItems: StyleItem[] = aiResponse.styles;

      logger.info("AI generated styles", {
        count: styleItems.length,
        provider: aiResponse.provider,
      });

      if (styleItems.length === 0) {
        throw new AppError(
          "AI failed to generate style recommendations",
          "NO_STYLES_GENERATED",
          500
        );
      }

      // Step 2: Fetch images for all items in parallel
      const imageResults = await ImageService.getImagesForItems(
        styleItems.map((s) => ({
          item: s.item,
          style: s.style,
          color: s.color,
        }))
      );

      logger.info("Images fetched", {
        itemCount: imageResults.length,
        itemsWithImages: imageResults.filter((r) => r.images.length > 0)
          .length,
      });

      // Step 3: Fetch prices for all items in parallel
      const priceResults = await PriceService.getPricesForItems(
        styleItems.map((s) => ({
          item: s.item,
          style: s.style,
          color: s.color,
        }))
      );

      logger.info("Prices fetched", {
        itemCount: priceResults.length,
        itemsWithPrices: priceResults.filter(
          (r) => r.pricePoints.length > 0
        ).length,
      });

      // Step 4: Combine into outfit items with 3-tier pricing
      const outfitItems: OutfitItem[] = styleItems.map((style, index) => {
        const images = imageResults[index]?.images || [];
        const priceData = priceResults[index];
        const pricePoints = priceData?.pricePoints || [];

        // Select prices based on budget tier
        let cheapPrice: PricePoint | null = null;
        let midPrice: PricePoint | null = null;
        let expensivePrice: PricePoint | null = null;

        if (budgetTier === "all" || budgetTier === "cheap") {
          cheapPrice = ShoppingAgentService.selectPriceByTier(
            pricePoints,
            "cheap"
          );
        }
        if (budgetTier === "all" || budgetTier === "mid") {
          midPrice = ShoppingAgentService.selectPriceByTier(
            pricePoints,
            "mid"
          );
        }
        if (budgetTier === "all" || budgetTier === "expensive") {
          expensivePrice = ShoppingAgentService.selectPriceByTier(
            pricePoints,
            "expensive"
          );
        }

        return {
          item: style.item,
          style: style.style,
          color: style.color,
          material: style.material,
          images,
          prices: {
            cheap: cheapPrice,
            mid: midPrice,
            expensive: expensivePrice,
          },
        };
      });

      logger.info("Outfit generation complete", {
        itemCount: outfitItems.length,
      });

      return outfitItems;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.error("Outfit generation failed", { prompt, error: errorMsg });

      throw new AppError(
        "Failed to generate outfit",
        "OUTFIT_GENERATION_FAILED",
        500,
        { originalError: errorMsg }
      );
    }
  }

  static async buildOutfit(
    prompt: string,
    budgetTier: "all" | "cheap" | "mid" | "expensive" = "all"
  ): Promise<OutfitResponse> {
    const startTime = Date.now();
    const normalizedPrompt = prompt.trim().toLowerCase();
    const cacheKey = `outfit:${budgetTier}:${normalizedPrompt}`;
    const promptCacheKey = `prompt:${normalizedPrompt}`;

    const cachedResponse = outfitCache.get<OutfitResponse>(cacheKey);
    if (cachedResponse) {
      const latencyMs = Date.now() - startTime;
      AnalyticsService.logEvent({
        prompt,
        timestamp: Date.now(),
        latencyMs,
        cacheHit: true,
      });

      const existingShare =
        cachedResponse.shareId ||
        ShareService.getShareByPrompt(prompt)?.id ||
        ShareService.createShare(cachedResponse).id;

      return {
        ...cachedResponse,
        shareId: existingShare,
        cached: true,
      };
    }

    // Reuse same-prompt cache across budget tier changes for instant perceived response.
    const promptCachedResponse = promptCache.get<OutfitResponse>(promptCacheKey);
    if (promptCachedResponse) {
      const latencyMs = Date.now() - startTime;
      AnalyticsService.logEvent({
        prompt,
        timestamp: Date.now(),
        latencyMs,
        cacheHit: true,
      });

      return {
        ...promptCachedResponse,
        cached: true,
      };
    }

    const variants = await ShoppingAgentService.generateOutfit(prompt, budgetTier);
    const summaryStats = ShoppingAgentService.calculateOutfitSummary(variants);
    const recommendations = RecommendationService.generateRecommendations(prompt);

    const response: OutfitResponse = {
      prompt,
      summary: `Built ${summaryStats.totalItems} pieces with average ${budgetTier === "all" ? "tiered" : budgetTier} pricing.`,
      variants,
      recommendations: {
        label: "Like this style?",
        items: recommendations,
      },
      cached: false,
      created_at: new Date().toISOString(),
    };

    outfitCache.set(cacheKey, response);
    promptCache.set(promptCacheKey, response);

    const latencyMs = Date.now() - startTime;
    AnalyticsService.logEvent({
      prompt,
      timestamp: Date.now(),
      latencyMs,
      cacheHit: false,
    });

    const shareId = ShareService.createShare(response).id;

    // Keep a stable shared link for frequently repeated prompts.
    const promptCount = AnalyticsService.getPromptCount(prompt) + 1;
    ShareService.preGenerateShareForPopularPrompt(
      prompt,
      response,
      promptCount
    );

    return {
      ...response,
      shareId,
    };
  }

  /**
   * Calculate summary statistics for an outfit
   */
  static calculateOutfitSummary(outfit: OutfitItem[]) {
    const cheapPrices: number[] = [];
    const midPrices: number[] = [];
    const expensivePrices: number[] = [];

    outfit.forEach((item) => {
      if (item.prices.cheap) cheapPrices.push(item.prices.cheap.price);
      if (item.prices.mid) midPrices.push(item.prices.mid.price);
      if (item.prices.expensive) expensivePrices.push(item.prices.expensive.price);
    });

    const average = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    return {
      totalItems: outfit.length,
      averagePrice: {
        cheap: Math.round(average(cheapPrices) * 100) / 100,
        mid: Math.round(average(midPrices) * 100) / 100,
        expensive: Math.round(average(expensivePrices) * 100) / 100,
      },
      totalPrice: {
        cheap: Math.round(
          cheapPrices.reduce((a, b) => a + b, 0) * 100
        ) / 100,
        mid: Math.round(
          midPrices.reduce((a, b) => a + b, 0) * 100
        ) / 100,
        expensive: Math.round(
          expensivePrices.reduce((a, b) => a + b, 0) * 100
        ) / 100,
      },
    };
  }
}

export default ShoppingAgentService;
