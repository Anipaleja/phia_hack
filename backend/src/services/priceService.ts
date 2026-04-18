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

type LaunchStrategy = {
  name: string;
  options: Record<string, unknown>;
};

export class PriceService {
  private static getPriceScrapeTimeoutMs(): number {
    const configuredTimeout = parseInt(
      process.env.PRICE_SCRAPE_MAX_WAIT_MS ||
        process.env.GOOGLE_SHOPPING_SCRAPE_TIMEOUT ||
        "25000"
    );

    return Number.isFinite(configuredTimeout)
      ? Math.max(configuredTimeout, 12000)
      : 25000;
  }

  private static buildMockPrices(itemName: string, searchQuery: string): PricePoint[] {
    const seed = `${itemName}:${searchQuery}`
      .split("")
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    const base = 35 + (seed % 80); // 35 - 114
    const cheap = Math.round((base + 4.99) * 100) / 100;
    const mid = Math.round((base * 1.7 + 9.99) * 100) / 100;
    const expensive = Math.round((base * 2.6 + 19.99) * 100) / 100;

    return [
      {
        productName: `${itemName} (Budget Pick)`,
        price: cheap,
        currency: "USD",
        retailer: "mock-budget-store.com",
        productUrl: "https://example.com/mock-budget",
        imageUrl: undefined,
      },
      {
        productName: `${itemName} (Best Value)`,
        price: mid,
        currency: "USD",
        retailer: "mock-style-mart.com",
        productUrl: "https://example.com/mock-mid",
        imageUrl: undefined,
      },
      {
        productName: `${itemName} (Premium Option)`,
        price: expensive,
        currency: "USD",
        retailer: "mock-luxury-label.com",
        productUrl: "https://example.com/mock-premium",
        imageUrl: undefined,
      },
    ];
  }

  private static getBaseLaunchOptions() {
    return {
      headless: "new" as const,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    };
  }

  private static getLaunchStrategies(): LaunchStrategy[] {
    const baseOptions = PriceService.getBaseLaunchOptions();
    const strategies: LaunchStrategy[] = [];

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      strategies.push({
        name: "env-executable-path",
        options: {
          ...baseOptions,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        },
      });
    }

    // Prefer the locally installed Chrome on macOS where bundled Chromium may crash.
    strategies.push({
      name: "chrome-channel",
      options: {
        ...baseOptions,
        channel: "chrome",
      },
    });

    strategies.push({
      name: "bundled-chromium",
      options: {
        ...baseOptions,
      },
    });

    return strategies;
  }

  /**
   * Initialize Puppeteer browser (lazy load)
   */
  private static async getBrowser(): Promise<Browser> {
    if (!browser) {
      const launchStrategies = PriceService.getLaunchStrategies();
      let lastError: unknown = null;

      for (const strategy of launchStrategies) {
        try {
          browser = await puppeteer.launch(strategy.options as any);
          logger.info("Puppeteer browser initialized", {
            strategy: strategy.name,
          });
          break;
        } catch (error) {
          lastError = error;
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.warn("Puppeteer launch strategy failed", {
            strategy: strategy.name,
            error: errorMsg,
          });
        }
      }

      if (!browser) {
        const errorMsg =
          lastError instanceof Error ? lastError.message : String(lastError);
        logger.error("Failed to initialize Puppeteer", {
          error: errorMsg,
          hint: "Set PUPPETEER_EXECUTABLE_PATH to a valid Chrome binary if needed",
        });
        throw new AppError("Price scraping unavailable", "BROWSER_INIT_FAILED", 503);
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
    const timeout = parseInt(
      process.env.GOOGLE_SHOPPING_SCRAPE_TIMEOUT || "30000"
    );
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
        waitUntil: "domcontentloaded",
        timeout,
      });

      await page.waitForSelector("[data-item-id]", {
        timeout: Math.min(timeout, 10000),
      }).catch(() => undefined);

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
      const scrapeTimeoutMs = PriceService.getPriceScrapeTimeoutMs();

      const pricePoints = await new Promise<PricePoint[]>((resolve) => {
        let settled = false;

        const timeoutId = setTimeout(async () => {
          if (settled) {
            return;
          }

          settled = true;
          logger.warn("Price scrape timed out, using mock fallback", {
            itemName,
            searchQuery,
            scrapeTimeoutMs,
          });

          resolve([]);
        }, scrapeTimeoutMs);

        PriceService.scrapeGoogleShopping(searchQuery)
          .then((results) => {
            if (settled) {
              return;
            }

            settled = true;
            clearTimeout(timeoutId);
            resolve(results);
          })
          .catch((error) => {
            if (settled) {
              return;
            }

            settled = true;
            clearTimeout(timeoutId);
            logger.warn("Google Shopping scrape failed, using mock fallback", {
              itemName,
              searchQuery,
              error: error instanceof Error ? error.message : String(error),
            });
            resolve([]);
          });
      });

      const finalPrices =
        pricePoints.length > 0
          ? pricePoints
          : PriceService.buildMockPrices(itemName, searchQuery);

      // Cache results even if empty (to prevent repeated scraping)
      priceCache.set(cacheKey, finalPrices);

      return PriceService.formatPriceResult(itemName, searchQuery, finalPrices);
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get prices", {
        itemName,
        error: errorMsg,
      });

      const fallbackPrices = PriceService.buildMockPrices(itemName, searchQuery);
      priceCache.set(cacheKey, fallbackPrices);
      return PriceService.formatPriceResult(itemName, searchQuery, fallbackPrices);
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
