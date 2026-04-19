import axios from "axios";
import { load as loadHtml } from "cheerio";
import puppeteer, { Browser, Page } from "puppeteer";
import NodeCache from "node-cache";
import { PricePoint, PriceResult } from "../types";
import { AppError } from "../utils/errorHandler";
import logger from "../utils/logger";
import { getScraperClient } from "./pythonScraperClient";

/**
 * Price Service: Scrapes price data from Google Shopping
 * Implements caching to respect website policies and prevent rate limiting
 * SECURITY: All scraping operations are rate-limited and cached
 */

const priceCache = new NodeCache({ stdTTL: 86400 }); // 24-hour cache
let browser: Browser | null = null;
const priceCacheNamespace = process.env.SCRAPER_CACHE_NAMESPACE || "productscrapes-v3";
let productScrapesDisabled = process.env.DISABLE_PRODUCTSCRAPES === "true";

type ScrapedProductRecord = {
  imageUrl?: string;
  productUrl?: string;
  title?: string;
  price?: number;
  currency?: string;
  retailer?: string;
};

type LaunchStrategy = {
  name: string;
  options: Record<string, unknown>;
};

export class PriceService {
  private static isLikelyShoppableProductUrl(value: string): boolean {
    if (!PriceService.isHttpUrl(value)) {
      return false;
    }

    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const path = parsed.pathname.toLowerCase();

      const blockedHosts = [
        "reddit.com",
        "pinterest.com",
        "instagram.com",
        "facebook.com",
        "tiktok.com",
        "youtube.com",
        "wikipedia.org",
      ];

      if (blockedHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        return false;
      }

      const blockedPathFragments = [
        "/search",
        "/collections",
        "/category",
        "/ideas",
        "/wiki",
        "/blog",
        "/stories",
      ];

      if (blockedPathFragments.some((fragment) => path.includes(fragment))) {
        return false;
      }

      const segments = path.split("/").filter(Boolean);
      const searchAndPath = `${parsed.search}${path}`.toLowerCase();
      const hasSkuHint = /sku|pid|productid|item=|variant=|style=/.test(searchAndPath);
      const hasProductLikeSlug = segments.some(
        (segment) => segment.length > 12 && /[-_]/.test(segment)
      );
      const hasMultiSegmentPath = segments.length >= 2;

      return (
        path.includes("/product/") ||
        path.includes("/products/") ||
        path.includes("/gp/product/") ||
        path.includes("/dp/") ||
        path.includes("/item/") ||
        path.includes("/p/") ||
        path.includes("/itm/") ||
        /\.(html|htm)$/.test(path) ||
        hasSkuHint ||
        (hasProductLikeSlug && hasMultiSegmentPath)
      );
    } catch {
      return false;
    }
  }

  private static isHttpUrl(value?: string): boolean {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  private static isLikelyProductImageUrl(value?: string): boolean {
    if (!PriceService.isHttpUrl(value)) {
      return false;
    }

    const normalized = String(value).toLowerCase();
    const rejectKeywords = ["logo", "icon", "sprite", "thumbnail", "thumb", "avatar", "favicon"];

    return !rejectKeywords.some((keyword) => normalized.includes(keyword));
  }

  private static parseNumericPrice(rawValue: unknown): number | undefined {
    if (typeof rawValue === "number") {
      return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : undefined;
    }

    if (typeof rawValue !== "string") {
      return undefined;
    }

    const normalized = rawValue.replace(/,/g, "");
    const match = normalized.match(/(\d+(?:\.\d{1,2})?)/);
    if (!match) {
      return undefined;
    }

    const parsed = parseFloat(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private static normalizeRetailer(retailer: string | undefined, productUrl: string | undefined): string {
    if (retailer && retailer.trim()) {
      return retailer.trim();
    }

    if (productUrl && PriceService.isHttpUrl(productUrl)) {
      try {
        return new URL(productUrl).hostname.replace(/^www\./, "");
      } catch {
        // no-op: fall through to default
      }
    }

    return "shop";
  }

  private static toCompletePricePoint(product: ScrapedProductRecord | null): PricePoint | null {
    if (!product) {
      return null;
    }

    const parsedPrice = PriceService.parseNumericPrice(product.price);
    if (!parsedPrice) {
      return null;
    }

    const productUrl = product.productUrl;
    if (
      !productUrl ||
      !PriceService.isHttpUrl(productUrl) ||
      !PriceService.isLikelyShoppableProductUrl(productUrl)
    ) {
      return null;
    }

    const imageUrl = product.imageUrl;
    if (!imageUrl || !PriceService.isLikelyProductImageUrl(imageUrl)) {
      return null;
    }

    return {
      productName: (product.title || "Product").trim() || "Product",
      price: parsedPrice,
      currency: product.currency || "USD",
      retailer: PriceService.normalizeRetailer(product.retailer, productUrl),
      productUrl,
      imageUrl,
    };
  }

  private static dedupePricePoints(points: PricePoint[]): PricePoint[] {
    const byUrl = new Map<string, PricePoint>();

    for (const point of points) {
      if (!byUrl.has(point.productUrl)) {
        byUrl.set(point.productUrl, point);
      }
    }

    return Array.from(byUrl.values());
  }

  private static isCompletePricePoint(point?: PricePoint | null): point is PricePoint {
    if (!point) return false;

    return (
      Number.isFinite(point.price) &&
      point.price > 0 &&
      PriceService.isHttpUrl(point.productUrl) &&
      PriceService.isLikelyShoppableProductUrl(point.productUrl) &&
      PriceService.isLikelyProductImageUrl(point.imageUrl)
    );
  }

  private static scoreProductUrl(url: string): number {
    const normalized = url.toLowerCase();
    let score = 0;

    if (normalized.includes("/products/")) score += 5;
    if (normalized.includes("/product/")) score += 5;
    if (normalized.includes("/dp/")) score += 4;
    if (normalized.includes(".html")) score += 4;
    if (normalized.includes("/p/")) score += 3;
    if (normalized.includes("/item/")) score += 3;
    if (normalized.includes("/buy/")) score += 3;
    if (normalized.includes("?variant=")) score += 2;

    if (normalized.includes("/collections/")) score -= 3;
    if (normalized.includes("/search")) score -= 4;
    if (normalized.includes("/category")) score -= 3;
    if (normalized.includes("/l/")) score -= 2;
    if (normalized.includes("/story/")) score -= 4;
    if (normalized.includes("/blog/")) score -= 4;
    if (normalized.includes("/article")) score -= 4;

    return score;
  }

  private static getProductScrapesConfig() {
    return {
      apiBaseUrl: (process.env.PRODUCTSCRAPES_API_BASE_URL || "https://productscrapes.com/api").replace(/\/$/, ""),
      apiKey: process.env.PRODUCTSCRAPES_API_KEY || "",
    };
  }

  private static normalizeAmazonProductUrl(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl, "https://www.amazon.com");
      const host = parsed.hostname.toLowerCase();
      if (!host.includes("amazon.")) {
        return null;
      }

      const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (!asinMatch) {
        return null;
      }

      return `https://www.amazon.com/dp/${asinMatch[1].toUpperCase()}`;
    } catch {
      return null;
    }
  }

  private static inferCurrencyFromPriceText(priceText: string): string {
    if (priceText.includes("$")) return "USD";
    if (priceText.includes("£")) return "GBP";
    if (priceText.includes("€")) return "EUR";
    return "USD";
  }

  private static async scrapeAmazonSearchResults(query: string): Promise<PricePoint[]> {
    try {
      const response = await axios.get("https://www.amazon.com/s", {
        params: {
          k: `${query} fashion`,
        },
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 15000,
      });

      const html = typeof response.data === "string" ? response.data : "";
      const $ = loadHtml(html);
      const points: PricePoint[] = [];

      $("div.s-result-item[data-component-type='s-search-result']").each((_, element) => {
        if (points.length >= 12) {
          return false;
        }

        const card = $(element);
        const primaryAnchor = card.find("h2 a.a-link-normal[href]").first();
        const fallbackAnchor = card
          .find("a.a-link-normal[href*='/dp/'], a[href*='/gp/product/']")
          .first();

        const rawHref = primaryAnchor.attr("href") || fallbackAnchor.attr("href") || "";
        const productUrl = PriceService.normalizeAmazonProductUrl(rawHref);
        if (!productUrl) {
          return;
        }

        const productName =
          primaryAnchor.text().trim() ||
          card.find("h2").first().text().trim() ||
          "Amazon Product";

        const imageUrl =
          card.find("img.s-image").first().attr("src") ||
          card.find("img[data-image-latency='s-product-image']").first().attr("src") ||
          undefined;

        const priceText =
          card.find("span.a-price > span.a-offscreen").first().text().trim() ||
          card.find("span.a-price").first().text().trim();

        const parsedPrice = PriceService.parseNumericPrice(priceText);
        if (!parsedPrice || !imageUrl) {
          return;
        }

        points.push({
          productName,
          price: parsedPrice,
          currency: PriceService.inferCurrencyFromPriceText(priceText),
          retailer: "amazon.com",
          productUrl,
          imageUrl,
        });
      });

      const complete = PriceService.dedupePricePoints(points).filter((point) =>
        PriceService.isCompletePricePoint(point)
      );

      logger.debug("Amazon search scraping completed", {
        query,
        resultCount: complete.length,
      });

      return complete.slice(0, 10);
    } catch (error) {
      logger.debug("Amazon search scraping failed", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private static decodeBingRedirectTarget(value: string): string | null {
    const decodedComponent = (() => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    })();

    const candidates = [decodedComponent];
    if (decodedComponent.startsWith("a1")) {
      candidates.push(decodedComponent.slice(2));
    }

    for (const candidate of candidates) {
      if (/^https?:\/\//i.test(candidate)) {
        return candidate;
      }

      const normalized = candidate.replace(/-/g, "+").replace(/_/g, "/");
      const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));

      try {
        const base64Decoded = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
        if (/^https?:\/\//i.test(base64Decoded)) {
          return base64Decoded;
        }
      } catch {
        // Ignore malformed base64 redirect targets.
      }
    }

    return null;
  }

  private static resolveSearchResultHref(rawHref: string, baseUrl: string): string | null {
    const href = rawHref.replace(/&amp;/g, "&").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      return null;
    }

    try {
      const parsed = new URL(href, baseUrl);
      const duckDuckGoTarget = parsed.searchParams.get("uddg");
      const bingRedirectTarget = parsed.searchParams.get("u");
      const googleRedirectTarget =
        parsed.hostname.toLowerCase().includes("google.") && parsed.pathname === "/url"
          ? parsed.searchParams.get("q")
          : null;

      let resolved = parsed.toString();
      if (duckDuckGoTarget) {
        resolved = decodeURIComponent(duckDuckGoTarget);
      } else if (googleRedirectTarget) {
        resolved = decodeURIComponent(googleRedirectTarget);
      } else if (bingRedirectTarget) {
        const decodedBingTarget = PriceService.decodeBingRedirectTarget(bingRedirectTarget);
        if (decodedBingTarget) {
          resolved = decodedBingTarget;
        }
      }

      if (!/^https?:\/\//i.test(resolved)) {
        return null;
      }

      const normalized = new URL(resolved);
      normalized.hash = "";

      const blockedHosts = [
        "duckduckgo.com",
        "bing.com",
        "google.com",
        "msn.com",
        "go.microsoft.com",
        "reddit.com",
        "pinterest.com",
        "instagram.com",
        "facebook.com",
        "tiktok.com",
        "youtube.com",
        "wikipedia.org",
        "support.microsoft.com",
      ];
      const host = normalized.hostname.toLowerCase().replace(/^www\./, "");
      if (blockedHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        return null;
      }

      return normalized.toString();
    } catch {
      return null;
    }
  }

  private static extractSearchResultUrls(html: string, baseUrl: string): string[] {
    const urls = new Set<string>();
    const hrefPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;

    let match: RegExpExecArray | null;
    while ((match = hrefPattern.exec(html))) {
      const resolved = PriceService.resolveSearchResultHref(match[1], baseUrl);
      if (resolved) {
        urls.add(resolved);
      }
    }

    return Array.from(urls);
  }

  private static async searchBingProductUrls(query: string): Promise<string[]> {
    try {
      const response = await axios.get("https://www.bing.com/search", {
        params: { q: query },
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        timeout: 8000,
      });

      const html = typeof response.data === "string" ? response.data : "";
      return PriceService.extractSearchResultUrls(html, "https://www.bing.com");
    } catch (error) {
      logger.debug("Bing product URL search failed", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private static async searchProductUrlsWithBrowser(query: string): Promise<string[]> {
    let page: Page | null = null;

    try {
      const browserInstance = await PriceService.getBrowser();
      page = await browserInstance.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
      );
      await page.setViewport({ width: 1366, height: 900 });

      const searchUrls = [
        `https://www.google.com/search?q=${encodeURIComponent(`${query} buy online`)}`,
        `https://www.google.com/shopping/search?q=${encodeURIComponent(query)}`,
      ];

      const candidates = new Set<string>();
      for (const searchUrl of searchUrls) {
        try {
          await page.goto(searchUrl, {
            waitUntil: "domcontentloaded",
            timeout: 18000,
          });

          await page.waitForSelector("a[href]", { timeout: 5000 }).catch(() => undefined);

          const hrefs = await page.$$eval("a[href]", (anchors) =>
            anchors
              .map((anchor) =>
                ((anchor as { href?: string }).href || anchor.getAttribute("href") || "").trim()
              )
              .filter(Boolean)
          );

          for (const href of hrefs) {
            const resolved = PriceService.resolveSearchResultHref(href, "https://www.google.com");
            if (resolved) {
              candidates.add(resolved);
            }
          }

          const strictCount = Array.from(candidates).filter((candidate) =>
            PriceService.isLikelyShoppableProductUrl(candidate)
          ).length;
          if (strictCount >= 8 || candidates.size >= 20) {
            break;
          }
        } catch (error) {
          logger.debug("Browser search query failed", {
            query,
            searchUrl,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return Array.from(candidates).slice(0, 20);
    } catch (error) {
      logger.debug("Browser product URL search failed", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          // ignore page close errors
        }
      }
    }
  }

  private static async searchDuckDuckGoProductUrls(query: string): Promise<string[]> {
    try {
      const urls = new Set<string>();
      const queryVariants = [
        query,
        `${query} product page`,
        `${query} buy`,
        `${query} shop online`,
        `${query} site:amazon.com dp`,
        `${query} site:nordstrom.com`,
        `${query} site:macys.com`,
        `${query} site:asos.com`,
      ];

      for (const variant of queryVariants) {
        try {
          const response = await axios.get("https://html.duckduckgo.com/html/", {
            params: { q: variant },
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
              "Accept-Language": "en-US,en;q=0.9",
            },
            timeout: 8000,
          });

          const html = typeof response.data === "string" ? response.data : "";
          const extractedUrls = PriceService.extractSearchResultUrls(html, "https://duckduckgo.com");
          for (const extractedUrl of extractedUrls) {
            urls.add(extractedUrl);
          }
        } catch (error) {
          logger.debug("DuckDuckGo variant query failed", {
            query,
            variant,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Stop early once we have enough high-quality candidate URLs.
        const strictCount = Array.from(urls).filter((candidate) =>
          PriceService.isLikelyShoppableProductUrl(candidate)
        ).length;
        if (strictCount >= 10) {
          break;
        }
      }

      const strictCountAfterDuckDuckGo = Array.from(urls).filter((candidate) =>
        PriceService.isLikelyShoppableProductUrl(candidate)
      ).length;

      if (strictCountAfterDuckDuckGo < 5) {
        const bingQueryVariants = [
          query,
          `${query} product page`,
          `${query} buy`,
          `${query} site:amazon.com`,
          `${query} site:nordstrom.com`,
          `${query} site:asos.com`,
        ];
        for (const variant of bingQueryVariants) {
          const bingResults = await PriceService.searchBingProductUrls(variant);
          for (const candidate of bingResults) {
            urls.add(candidate);
          }

          const strictCount = Array.from(urls).filter((candidate) =>
            PriceService.isLikelyShoppableProductUrl(candidate)
          ).length;
          if (strictCount >= 10 || urls.size >= 20) {
            break;
          }
        }
      }

      const strictCountAfterSearchApis = Array.from(urls).filter((candidate) =>
        PriceService.isLikelyShoppableProductUrl(candidate)
      ).length;

      if (strictCountAfterSearchApis < 3) {
        const browserResults = await PriceService.searchProductUrlsWithBrowser(query);
        for (const candidate of browserResults) {
          urls.add(candidate);
        }
      }

      const ranked = Array.from(urls)
        .sort((left, right) => PriceService.scoreProductUrl(right) - PriceService.scoreProductUrl(left))
        .slice(0, 20);

      const strictCandidates = ranked.filter((candidate) =>
        PriceService.isLikelyShoppableProductUrl(candidate)
      );

      return (strictCandidates.length > 0 ? strictCandidates : ranked).slice(0, 20);
    } catch (error) {
      logger.debug("DuckDuckGo product URL search failed", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private static async fetchProductScrapesProductData(
    productUrl: string
  ): Promise<ScrapedProductRecord | null> {
    const { apiBaseUrl, apiKey } = PriceService.getProductScrapesConfig();

    if (productScrapesDisabled || !apiKey || !productUrl) {
      return null;
    }

    try {
      const response = await axios.post(
        `${apiBaseUrl}/fetch`,
        { url: productUrl },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const product = response.data?.data?.product;
      if (!product) {
        return null;
      }

      const resolvedProductUrl = product.url || product.canonical_url || productUrl;
      const parsedPrice = PriceService.parseNumericPrice(product.price);

      const retailer = PriceService.normalizeRetailer(
        String(product.brand || product.store || "").trim(),
        resolvedProductUrl
      );

      return {
        title: product.title || product.name || "Product",
        price: parsedPrice,
        currency: product.currency || undefined,
        retailer: retailer || undefined,
        productUrl: resolvedProductUrl || undefined,
        imageUrl: product.image_url || product.imageUrl || undefined,
      };
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;

      if (status === 401 || status === 403 || status === 429) {
        productScrapesDisabled = true;
        logger.warn("ProductScrapes disabled for current process due API response", {
          status,
        });
      }

      logger.debug("ProductScrapes fetch failed", {
        productUrl,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch product data using the Python scraper (Playwright + BeautifulSoup)
   * Fallback when ProductScrapes API fails or as primary source
   */
  private static async fetchPythonScrapedProductData(
    productUrl: string
  ): Promise<ScrapedProductRecord | null> {
    try {
      const scraperClient = getScraperClient();
      const scrapedData = await Promise.race([
        scraperClient.scrapeUrl(productUrl),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 22000)),
      ]);

      if (!scrapedData || !scrapedData.product_url) {
        return null;
      }

      const retailer = PriceService.normalizeRetailer(
        scrapedData.brand || "",
        scrapedData.product_url
      );

      const price = PriceService.parseNumericPrice(scrapedData.price);

      return {
        title: scrapedData.title || "Product",
        price,
        currency: scrapedData.currency,
        retailer: retailer || undefined,
        productUrl: scrapedData.product_url,
        imageUrl: scrapedData.image_url,
      };
    } catch (error) {
      logger.debug("Python scraper fetch failed", {
        productUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private static getPriceScrapeTimeoutMs(): number {
    const configuredTimeout = parseInt(
      process.env.PRICE_SCRAPE_MAX_WAIT_MS ||
        process.env.GOOGLE_SHOPPING_SCRAPE_TIMEOUT ||
        "25000"
    );

    return Number.isFinite(configuredTimeout)
      ? Math.max(configuredTimeout, 60000)
      : 60000;
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
    try {
      const amazonSearchPoints = await PriceService.scrapeAmazonSearchResults(query);
      if (amazonSearchPoints.length > 0) {
        logger.info("Product scraping completed", {
          query,
          source: "amazon-search",
          amazonSearchCompleteCount: amazonSearchPoints.length,
          candidateCount: 0,
          productscrapesCompleteCount: 0,
          pythonCompleteCount: 0,
          mergedCompleteCount: amazonSearchPoints.length,
        });

        return amazonSearchPoints.slice(0, 10);
      }

      const candidateUrls = await PriceService.searchDuckDuckGoProductUrls(query);
      const rankedUrls = candidateUrls.slice(0, 12);

      if (rankedUrls.length === 0 && amazonSearchPoints.length === 0) {
        logger.info("No candidate product URLs found", { query });
        return [];
      }

      const completePythonPoints: PricePoint[] = [];
      for (const productUrl of rankedUrls.slice(0, 3)) {
        const pythonResult = await PriceService.fetchPythonScrapedProductData(productUrl);
        const completePoint = PriceService.toCompletePricePoint(pythonResult);
        if (completePoint) {
          completePythonPoints.push(completePoint);
        }

        if (completePythonPoints.length >= 3) {
          break;
        }
      }

      const shouldTryProductScrapes = !productScrapesDisabled && completePythonPoints.length < 3;
      const completeProductScrapesPoints: PricePoint[] = [];
      if (shouldTryProductScrapes) {
        for (const productUrl of rankedUrls.slice(0, 3)) {
          const productScrapesResult = await PriceService.fetchProductScrapesProductData(productUrl);
          const completePoint = PriceService.toCompletePricePoint(productScrapesResult);
          if (completePoint) {
            completeProductScrapesPoints.push(completePoint);
          }

          if (completeProductScrapesPoints.length >= 3) {
            break;
          }
        }
      }

      const merged = PriceService.dedupePricePoints([
        ...amazonSearchPoints,
        ...completePythonPoints,
        ...completeProductScrapesPoints,
      ]).filter((point) => PriceService.isCompletePricePoint(point));

      logger.info("Product scraping completed", {
        query,
        amazonSearchCompleteCount: amazonSearchPoints.length,
        candidateCount: rankedUrls.length,
        productscrapesCompleteCount: completeProductScrapesPoints.length,
        pythonCompleteCount: completePythonPoints.length,
        mergedCompleteCount: merged.length,
      });

      return merged.slice(0, 10);
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.warn("Product scraping failed", {
        query,
        error: errorMsg,
      });
      return [];
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
    const cacheKey = `${priceCacheNamespace}:prices:${searchQuery}`;

    // Check cache first (only accept complete live records)
    const cached = priceCache.get<PricePoint[]>(cacheKey);
    if (cached && cached.length > 0) {
      const completeCached = cached.filter((point) => PriceService.isCompletePricePoint(point));

      if (completeCached.length > 0) {
        logger.debug("Price cache hit", { query: searchQuery, count: completeCached.length });
        return PriceService.formatPriceResult(itemName, searchQuery, completeCached);
      }

      priceCache.del(cacheKey);
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
          logger.warn("Price scrape timed out", {
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
            logger.warn("Product scraping failed", {
              itemName,
              searchQuery,
              error: error instanceof Error ? error.message : String(error),
            });
            resolve([]);
          });
      });

      const finalPrices = pricePoints.filter((point) => PriceService.isCompletePricePoint(point));

      if (finalPrices.length === 0) {
        throw new AppError(
          `No live product listings found for ${itemName} with complete price, image, and product URL data`,
          "LIVE_PRODUCT_DATA_UNAVAILABLE",
          502,
          { itemName, style, color }
        );
      }

      // Cache only complete live records.
      priceCache.set(cacheKey, finalPrices);

      return PriceService.formatPriceResult(itemName, searchQuery, finalPrices);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.error("Failed to get prices", {
        itemName,
        error: errorMsg,
      });

      throw new AppError(
        `Failed to fetch live product data for ${itemName}`,
        "LIVE_PRODUCT_DATA_FETCH_FAILED",
        502,
        { originalError: errorMsg, itemName, style, color }
      );
    }
  }

  /**
   * Get prices for multiple items (batch operation)
   */
  static async getPricesForItems(
    items: Array<{ item: string; style: string; color: string }>
  ): Promise<PriceResult[]> {
    const settledResults = await Promise.allSettled(
      items.map((item) =>
        PriceService.getPricesForItem(item.item, item.style, item.color)
      )
    );

    const results: PriceResult[] = settledResults.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }

      const failedItem = items[index];
      logger.warn("Failed to fetch live prices for item", {
        itemName: failedItem.item,
        style: failedItem.style,
        color: failedItem.color,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });

      return {
        item: failedItem.item,
        searchQuery: `${failedItem.color} ${failedItem.item} ${failedItem.style}`,
        pricePoints: [],
      };
    });

    logger.info("Batch price fetch completed", {
      itemCount: items.length,
      successfulItems: results.filter((entry) => entry.pricePoints.length > 0).length,
    });

    return results;
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
