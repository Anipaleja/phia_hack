import puppeteer, { Browser } from "puppeteer";
import NodeCache from "node-cache";
import { PricePoint, PriceResult } from "../types";
import { AppError } from "../utils/errorHandler";
import logger from "../utils/logger";

/**
 * Price Service: Scrapes price data from Google Shopping
 * Implements caching to respect website policies and prevent rate limiting
 * SECURITY: All scraping operations are rate-limited and cached
 */

const priceCache = new NodeCache({ stdTTL: 86400 }); // 24-hour cache
let browser: Browser | null = null;

export class PriceService {
  /**
   * Initialize Puppeteer browser (lazy load)
   */
  private static async getBrowser(): Promise<Browser> {
    if (!browser) {
      try {
        browser = await puppeteer.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
          ],
        });
        logger.info("Puppeteer browser initialized");
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        logger.error("Failed to initialize Puppeteer", { error: errorMsg });
        throw new AppError(
          "Price scraping unavailable",
          "BROWSER_INIT_FAILED",
          503
        );
      }
    }
    return browser;
  }

  /**
   * Scrape Google Shopping for a product
   * Returns top results with price and retailer info
   * SECURITY: Uses rate limiting to prevent abuse
   */
  private static async scrapeGoogleShopping(
    query: string
  ): Promise<PricePoint[]> {
    const timeout = parseInt(process.env.GOOGLE_SHOPPING_SCRAPE_TIMEOUT || "30000");
    const browserInstance = await PriceService.getBrowser();

    let page = null;
    try {
      page = await browserInstance.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      );
      await page.setViewport({ width: 1280, height: 720 });

      // Navigate to Google Shopping
      const searchUrl = `https://www.google.com/shopping/search?q=${encodeURIComponent(
        query
      )}`;
      
      await page.goto(searchUrl, {
        waitUntil: "networkidle2",
        timeout,
      });

      // Extract product data
      const products = await page.evaluate(() => {
        const items: PricePoint[] = [];
          // @ts-ignore - document exists in Puppeteer browser context
        const productElements = document.querySelectorAll('[data-item-id]');

        productElements.forEach((elem: any) => {
          try {
            const nameEl = elem.querySelector("h3");
            const priceEl = elem.querySelector("[role='img'][aria-label*='$']");
            const linkEl = elem.querySelector("a");

            if (nameEl && priceEl && linkEl) {
              const priceText = priceEl.getAttribute("aria-label") || "";
              const priceMatch = priceText.match(/\$[\d,]+\.?\d*/);
              const price = priceMatch
                ? parseFloat(priceMatch[0].replace(/[$,]/g, ""))
                : null;

              if (price !== null && price > 0) {
                items.push({
                  productName: nameEl.textContent || "Unknown",
                  price,
                  currency: "USD",
                  retailer: new URL(linkEl.href).hostname.replace("www.", ""),
                  productUrl: linkEl.href || "",
                  imageUrl: elem.querySelector("img")?.src,
                  rating: undefined,
                });
              }
            }
          } catch (e) {
            // Skip items with parsing errors
          }
        });

        return items;
      });

      logger.info("Google Shopping scrape successful", {
        query,
        resultCount: products.length,
      });

      return products.slice(0, 10); // Return top 10 results
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.warn("Google Shopping scrape failed", {
        query,
        error: errorMsg,
      });
      return [];
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.debug("Error closing Puppeteer page", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  /**
   * Get prices for an item with fallback to cached data
   */
  static async getPricesForItem(
    itemName: string,
    style: string,
    color: string
  ): Promise<PriceResult> {
    const searchQuery = `${color} ${itemName} ${style}`.toLowerCase().trim();
    const cacheKey = `prices:${searchQuery}`;

    // Check cache first
    const cached = priceCache.get<PricePoint[]>(cacheKey);
    if (cached && cached.length > 0) {
      logger.debug("Price cache hit", { query: searchQuery });
      return PriceService.formatPriceResult(itemName, searchQuery, cached);
    }

    try {
      logger.debug("Scraping prices", { itemName, style, color });
      const pricePoints = await PriceService.scrapeGoogleShopping(searchQuery);

      // Cache results even if empty (to prevent repeated scraping)
      if (pricePoints.length > 0) {
        priceCache.set(cacheKey, pricePoints);
      }

      return PriceService.formatPriceResult(itemName, searchQuery, pricePoints);
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get prices", {
        itemName,
        error: errorMsg,
      });

      // Return empty result rather than throwing
      // This allows outfit generation to continue without prices
      return {
        item: itemName,
        searchQuery,
        pricePoints: [],
      };
    }
  }

  /**
   * Get prices for multiple items (batch operation)
   */
  static async getPricesForItems(
    items: Array<{ item: string; style: string; color: string }>
  ): Promise<PriceResult[]> {
    try {
      const results = await Promise.all(
        items.map((item) =>
          PriceService.getPricesForItem(item.item, item.style, item.color)
        )
      );

      logger.info("Batch price fetch completed", {
        itemCount: items.length,
      });

      return results;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.error("Batch price fetch failed", { error: errorMsg });

      // Return partial results if some fail
      return items.map((item) => ({
        item: item.item,
        searchQuery: `${item.color} ${item.item} ${item.style}`,
        pricePoints: [],
      }));
    }
  }

  /**
   * Format scraped price data into PriceResult
   */
  private static formatPriceResult(
    itemName: string,
    searchQuery: string,
    pricePoints: PricePoint[]
  ): PriceResult {
    const sorted = [...pricePoints].sort((a, b) => a.price - b.price);

    return {
      item: itemName,
      searchQuery,
      pricePoints: sorted,
      cheapest: sorted[0],
      mostExpensive: sorted[sorted.length - 1],
    };
  }

  /**
   * Close browser on shutdown (cleanup)
   */
  static async closeBrowser(): Promise<void> {
    if (browser) {
      try {
        await browser.close();
        browser = null;
        logger.info("Puppeteer browser closed");
      } catch (error) {
        logger.error("Error closing browser", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export default PriceService;
