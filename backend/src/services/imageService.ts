import axios from "axios";
import NodeCache from "node-cache";
import { Image, ImageResult } from "../types";
import { AppError } from "../utils/errorHandler";
import logger from "../utils/logger";

/**
 * Image Service: Fetches product images from free APIs
 * Uses Unsplash for fashion images, with Pexels as fallback
 * Implements caching to respect API quotas
 */

const imageCache = new NodeCache({ stdTTL: 86400 }); // 24-hour cache

interface UnsplashPhoto {
  id: string;
  urls: { small: string; regular: string };
  alt_description: string;
  width: number;
  height: number;
}

interface PexelsPhoto {
  id: number;
  url: string;
  src: { small: string; original: string };
  alt: string;
  width: number;
  height: number;
}

export class ImageService {
  /**
   * Fetch images from Unsplash
   * SECURITY: API key is server-side only
   */
  private static async fetchFromUnsplash(
    query: string,
    perPage: number = 5
  ): Promise<Image[]> {
    try {
      if (!process.env.UNSPLASH_ACCESS_KEY) {
        logger.warn("Unsplash API key not configured");
        return [];
      }

      const response = await axios.get(
        "https://api.unsplash.com/search/photos",
        {
          params: {
            query,
            per_page: perPage,
            orientation: "portrait",
          },
          headers: {
            Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
          },
          timeout: 10000,
        }
      );

      if (!response.data.results) {
        return [];
      }

      return response.data.results.map((photo: UnsplashPhoto) => ({
        url: photo.urls.regular,
        source: "unsplash",
        alt: photo.alt_description || "Fashion item",
        width: photo.width,
        height: photo.height,
      }));
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.warn("Unsplash fetch failed", {
        query,
        error: errorMsg,
      });
      return [];
    }
  }

  /**
   * Fetch images from Pexels (free alternative to Unsplash)
   * SECURITY: API key is server-side only
   */
  private static async fetchFromPexels(
    query: string,
    perPage: number = 5
  ): Promise<Image[]> {
    try {
      if (!process.env.PEXELS_API_KEY) {
        logger.warn("Pexels API key not configured");
        return [];
      }

      const response = await axios.get("https://api.pexels.com/v1/search", {
        params: {
          query,
          per_page: perPage,
          orientation: "portrait",
        },
        headers: {
          Authorization: process.env.PEXELS_API_KEY,
        },
        timeout: 10000,
      });

      if (!response.data.photos) {
        return [];
      }

      return response.data.photos.map((photo: PexelsPhoto) => ({
        url: photo.src.original,
        source: "pexels",
        alt: photo.alt || "Fashion item",
        width: photo.width,
        height: photo.height,
      }));
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.warn("Pexels fetch failed", {
        query,
        error: errorMsg,
      });
      return [];
    }
  }

  /**
   * Fetch images for a query with fallback
   * Tries Unsplash first, falls back to Pexels
   */
  private static async fetchImagesForQuery(
    query: string
  ): Promise<Image[]> {
    // Check cache first
    const cacheKey = `images:${query}`;
    const cached = imageCache.get<Image[]>(cacheKey);
    if (cached) {
      logger.debug("Image cache hit", { query });
      return cached;
    }

    // Try Unsplash first
    let images = await ImageService.fetchFromUnsplash(query, 5);

    // If Unsplash fails or returns no results, try Pexels
    if (images.length === 0) {
      logger.info("Falling back to Pexels for images", { query });
      images = await ImageService.fetchFromPexels(query, 5);
    }

    // Cache results even if empty (to prevent repeated API calls)
    if (images.length > 0) {
      imageCache.set(cacheKey, images);
    }

    return images;
  }

  /**
   * Get images for a style item
   * Creates search query from item name, style, and color
   */
  static async getImagesForItem(
    itemName: string,
    style: string,
    color: string
  ): Promise<ImageResult> {
    try {
      // Build search query: "blue jacket preppy style"
      const searchQuery = `${color} ${itemName} ${style}`.toLowerCase().trim();

      logger.debug("Fetching images", { itemName, style, color });

      const images = await ImageService.fetchImagesForQuery(searchQuery);

      if (images.length === 0) {
        logger.warn("No images found", { searchQuery });
        // Return empty result but don't throw - allow outfit to continue
      }

      return {
        itemName,
        images,
        searchQuery,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get images", {
        itemName,
        error: errorMsg,
      });

      // Return empty images rather than failing
      // This allows the outfit generation to continue with just descriptions
      return {
        itemName,
        images: [],
        searchQuery: `${color} ${itemName} ${style}`,
      };
    }
  }

  /**
   * Get images for multiple items (batch operation)
   */
  static async getImagesForItems(
    items: Array<{ item: string; style: string; color: string }>
  ): Promise<ImageResult[]> {
    try {
      const results = await Promise.all(
        items.map((item) =>
          ImageService.getImagesForItem(item.item, item.style, item.color)
        )
      );

      logger.info("Batch image fetch completed", {
        itemCount: items.length,
        successCount: results.filter((r) => r.images.length > 0).length,
      });

      return results;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.error("Batch image fetch failed", { error: errorMsg });
      throw new AppError(
        "Failed to fetch images",
        "IMAGE_FETCH_FAILED",
        500,
        { originalError: errorMsg }
      );
    }
  }
}

export default ImageService;
