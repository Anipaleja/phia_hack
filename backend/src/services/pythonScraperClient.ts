/**
 * Python Product Scraper Client
 * 
 * Provides TypeScript integration for the Python product scraper.
 * Supports both Flask API (HTTP) and direct subprocess calls.
 */

import axios, { AxiosError } from "axios";
import { spawn } from "child_process";
import path from "path";
import logger from "../utils/logger";

export interface ScrapedProduct {
  product_url: string;
  price?: string;
  image_url?: string;
  title?: string;
  currency?: string;
  brand?: string;
  in_stock?: boolean;
  scraper_type: string;
}

export interface ScraperDetectionResult {
  url: string;
  scraper_type: string;
  domain: string;
}

/**
 * Python Scraper Client
 * Calls the Python scraper via Flask API
 */
export class PythonScraperClient {
  private apiUrl: string;
  private requestTimeout: number;

  constructor(
    apiUrl: string = process.env.SCRAPER_API_URL || "http://localhost:5000",
    requestTimeout: number = 60000
  ) {
    this.apiUrl = apiUrl.replace(/\/$/, ""); // Remove trailing slash
    this.requestTimeout = requestTimeout;
  }

  /**
   * Scrape a single product URL
   * 
   * @param productUrl - URL to scrape
   * @param timeoutSeconds - Timeout for this specific request
   * @returns Scraped product data or null if scraper API unavailable
   */
  async scrapeUrl(
    productUrl: string,
    timeoutSeconds: number = 30
  ): Promise<ScrapedProduct | null> {
    try {
      const response = await axios.post<ScrapedProduct>(
        `${this.apiUrl}/scrape`,
        {
          url: productUrl,
          timeout: timeoutSeconds,
        },
        {
          timeout: (timeoutSeconds + 5) * 1000, // Add 5s buffer for HTTP overhead
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      logger.debug("Python scraper: URL scraped successfully", {
        productUrl,
        scraperType: response.data.scraper_type,
      });

      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      
      // Log differently for timeout vs other errors
      if (err.code === "ECONNREFUSED") {
        logger.debug("Python scraper API unavailable (connection refused)", {
          apiUrl: this.apiUrl,
          productUrl,
        });
      } else if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
        logger.debug("Python scraper timeout", {
          productUrl,
          timeoutSeconds,
        });
      } else {
        logger.debug("Python scraper request failed", {
          productUrl,
          error: err.message,
          status: err.response?.status,
        });
      }

      return null;
    }
  }

  /**
   * Scrape multiple product URLs
   * 
   * @param productUrls - URLs to scrape
   * @param timeoutSeconds - Timeout per URL
   * @returns Array of scraped products (partial failures included)
   */
  async scrapeUrls(
    productUrls: string[],
    timeoutSeconds: number = 30
  ): Promise<ScrapedProduct[]> {
    try {
      const response = await axios.post<{ results: ScrapedProduct[] }>(
        `${this.apiUrl}/scrape/batch`,
        {
          urls: productUrls,
          timeout: timeoutSeconds,
        },
        {
          timeout: (timeoutSeconds * productUrls.length + 10) * 1000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      logger.debug("Python scraper: Batch scrape completed", {
        requested: productUrls.length,
        received: response.data.results.length,
      });

      return response.data.results;
    } catch (error) {
      const err = error as AxiosError;
      
      if (err.code === "ECONNREFUSED") {
        logger.debug("Python scraper API unavailable", {
          apiUrl: this.apiUrl,
        });
      } else {
        logger.debug("Python scraper batch request failed", {
          urlCount: productUrls.length,
          error: err.message,
        });
      }

      // Return empty on failure - caller should have fallback
      return [];
    }
  }

  /**
   * Detect which scraper type will be used for a URL
   * 
   * @param productUrl - URL to analyze
   * @returns Scraper type info
   */
  async detectScraperType(
    productUrl: string
  ): Promise<ScraperDetectionResult | null> {
    try {
      const response = await axios.post<ScraperDetectionResult>(
        `${this.apiUrl}/scrape/detect`,
        { url: productUrl },
        {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.debug("Python scraper detection failed", {
        productUrl,
        error: error instanceof Error ? error.message : String(error),
      });

      return null;
    }
  }

  /**
   * Check if the scraper API is available
   * 
   * @returns true if API is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.apiUrl}/health`, {
        timeout: 5000,
      });

      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Direct Scraper Integration (subprocess)
 * 
 * Calls Python scraper directly via subprocess (no separate Flask server needed)
 */
export class DirectPythonScraperClient {
  private scraperDir: string;

  constructor(scraperDir: string = path.resolve(__dirname, "../../../scraper")) {
    this.scraperDir = scraperDir;
  }

  private parseCliJsonOutput(output: string): ScrapedProduct[] | null {
    const trimmed = output.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? (parsed as ScrapedProduct[]) : null;
    } catch {
      const firstArrayBracket = trimmed.indexOf("[");
      const lastArrayBracket = trimmed.lastIndexOf("]");

      if (firstArrayBracket === -1 || lastArrayBracket === -1 || lastArrayBracket <= firstArrayBracket) {
        return null;
      }

      const jsonChunk = trimmed.slice(firstArrayBracket, lastArrayBracket + 1);

      try {
        const parsed = JSON.parse(jsonChunk);
        return Array.isArray(parsed) ? (parsed as ScrapedProduct[]) : null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Scrape a single product URL
   */
  async scrapeUrl(productUrl: string): Promise<ScrapedProduct | null> {
    return new Promise((resolve) => {
      const pythonProcess = spawn("python3", [
        path.join(this.scraperDir, "cli.py"),
        "--url",
        productUrl,
        "--format",
        "json",
        "--log-level",
        "ERROR",
      ], {
        cwd: this.scraperDir,
      });

      let output = "";
      let error = "";

      pythonProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        error += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code === 0) {
          try {
            const results = this.parseCliJsonOutput(output);
            if (!results || results.length === 0) {
              resolve(null);
              return;
            }

            const result = results[0];

            if (result && result.product_url) {
              logger.debug("Direct Python scraper: URL scraped successfully", {
                productUrl,
                scraperType: result.scraper_type,
              });
              resolve(result as ScrapedProduct);
            } else {
              resolve(null);
            }
          } catch (e) {
            logger.debug("Direct Python scraper: Failed to parse output", {
              productUrl,
              error: e instanceof Error ? e.message : String(e),
              outputSnippet: output.substring(0, 200),
            });
            resolve(null);
          }
        } else {
          logger.debug("Direct Python scraper: Process exited with error", {
            productUrl,
            code,
            error: error.substring(0, 200),
          });
          resolve(null);
        }
      });

      pythonProcess.on("error", (err) => {
        logger.debug("Direct Python scraper: Process error", {
          productUrl,
          error: err.message,
        });
        resolve(null);
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        pythonProcess.kill();
        logger.debug("Direct Python scraper: Timeout", { productUrl });
        resolve(null);
      }, 60000);
    });
  }

  /**
   * Scrape multiple product URLs
   */
  async scrapeUrls(productUrls: string[]): Promise<ScrapedProduct[]> {
    return new Promise((resolve) => {
      const pythonProcess = spawn("python3", [
        path.join(this.scraperDir, "cli.py"),
        "--urls",
        ...productUrls,
        "--format",
        "json",
        "--log-level",
        "ERROR",
      ], {
        cwd: this.scraperDir,
      });

      let output = "";
      let error = "";

      pythonProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        error += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code === 0) {
          try {
            const results = this.parseCliJsonOutput(output) || [];
            logger.debug("Direct Python scraper: Batch complete", {
              requested: productUrls.length,
              received: results.length,
            });
            resolve(results as ScrapedProduct[]);
          } catch (e) {
            logger.debug("Direct Python scraper: Failed to parse batch output", {
              error: e instanceof Error ? e.message : String(e),
              outputSnippet: output.substring(0, 200),
            });
            resolve([]);
          }
        } else {
          logger.debug("Direct Python scraper: Batch process error", {
            code,
            error: error.substring(0, 200),
          });
          resolve([]);
        }
      });

      pythonProcess.on("error", (err) => {
        logger.debug("Direct Python scraper: Process error", {
          error: err.message,
        });
        resolve([]);
      });

      // Timeout after 5 minutes for batch
      setTimeout(() => {
        pythonProcess.kill();
        logger.debug("Direct Python scraper: Batch timeout");
        resolve([]);
      }, 300000);
    });
  }
}

/**
 * Get a scraper client instance
 * 
 * Priority order:
 * 1. If SCRAPER_USE_SUBPROCESS=true, use direct subprocess
 * 2. Otherwise, use Flask API (default)
 */
export function getScraperClient(): PythonScraperClient | DirectPythonScraperClient {
  const useSubprocess =
    process.env.SCRAPER_USE_SUBPROCESS === "true" ||
    !process.env.SCRAPER_API_URL;

  if (useSubprocess) {
    logger.debug("Using direct Python subprocess scraper");
    return new DirectPythonScraperClient() as any;
  } else {
    logger.debug("Using Flask API scraper", {
      apiUrl: process.env.SCRAPER_API_URL,
    });
    return new PythonScraperClient(process.env.SCRAPER_API_URL);
  }
}

export default PythonScraperClient;
