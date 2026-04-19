/**
 * Example integration of Python scraper with Node.js backend
 * 
 * This shows how to integrate the product scraper with your existing
 * PriceService to replace or supplement the ProductScrapes API.
 */

const { spawn } = require("child_process");
const path = require("path");
const axios = require("axios");

/**
 * Option 1: Direct subprocess integration (simpler, no separate service)
 */
class DirectScraperIntegration {
  constructor(scraperDir = path.join(__dirname, "../../scraper")) {
    this.scraperDir = scraperDir;
  }

  /**
   * Scrape a single product URL
   */
  async scrapeProduct(productUrl) {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn("python3", [
        path.join(this.scraperDir, "cli.py"),
        "--url",
        productUrl,
        "--format",
        "json",
      ]);

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
            const results = JSON.parse(output);
            const result = results[0] || { product_url: productUrl };
            resolve({
              success: true,
              data: result,
            });
          } catch (e) {
            reject(new Error(`Failed to parse scraper output: ${e.message}`));
          }
        } else {
          reject(
            new Error(
              `Scraper exited with code ${code}: ${error || "Unknown error"}`
            )
          );
        }
      });

      pythonProcess.on("error", (err) => {
        reject(new Error(`Failed to spawn scraper process: ${err.message}`));
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        pythonProcess.kill();
        reject(new Error(`Scraper timeout after 60s for ${productUrl}`));
      }, 60000);
    });
  }

  /**
   * Scrape multiple product URLs
   */
  async scrapeProducts(productUrls) {
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn("python3", [
        path.join(this.scraperDir, "cli.py"),
        "--urls",
        ...productUrls,
        "--format",
        "json",
      ]);

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
            const results = JSON.parse(output);
            resolve(results);
          } catch (e) {
            reject(new Error(`Failed to parse scraper output: ${e.message}`));
          }
        } else {
          reject(
            new Error(
              `Scraper exited with code ${code}: ${error || "Unknown error"}`
            )
          );
        }
      });

      pythonProcess.on("error", (err) => {
        reject(new Error(`Failed to spawn scraper process: ${err.message}`));
      });

      // Timeout after 5 minutes for batch
      setTimeout(() => {
        pythonProcess.kill();
        reject(new Error(`Scraper batch timeout after 300s`));
      }, 300000);
    });
  }
}

/**
 * Option 2: Flask API integration (recommended for production)
 * 
 * Start the Flask server separately:
 *   cd scraper && python api.py
 */
class APIScraperIntegration {
  constructor(apiUrl = "http://localhost:5000") {
    this.apiUrl = apiUrl;
    this.client = axios.create({
      baseURL: apiUrl,
      timeout: 60000,
    });
  }

  /**
   * Scrape a single product URL
   */
  async scrapeProduct(productUrl) {
    try {
      const response = await this.client.post("/scrape", {
        url: productUrl,
        timeout: 30,
      });

      if (response.status === 200) {
        return {
          success: true,
          data: response.data,
        };
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Scraper API error: ${error.response.status} - ${error.response.data?.error}`
        );
      } else {
        throw error;
      }
    }
  }

  /**
   * Scrape multiple product URLs
   */
  async scrapeProducts(productUrls) {
    try {
      const response = await this.client.post("/scrape/batch", {
        urls: productUrls,
        timeout: 30,
      });

      if (response.status === 200) {
        return response.data.results; // Returns list of products
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Scraper API error: ${error.response.status} - ${error.response.data?.error}`
        );
      } else {
        throw error;
      }
    }
  }

  /**
   * Detect which scraper will be used for a URL
   */
  async detectScraperType(productUrl) {
    try {
      const response = await this.client.post("/scrape/detect", {
        url: productUrl,
      });

      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error(`API returned status ${response.status}`);
      }
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Scraper detection error: ${error.response.status} - ${error.response.data?.error}`
        );
      } else {
        throw error;
      }
    }
  }
}

/**
 * Usage in PriceService
 * 
 * Example of integrating with your existing PriceService:
 */

// Initialize one of the scrapers at module load time
// Option 1: Direct subprocess (simpler, but blocks Node event loop)
// const scraper = new DirectScraperIntegration();

// Option 2: Flask API (recommended, non-blocking)
const scraper = new APIScraperIntegration(
  process.env.SCRAPER_API_URL || "http://localhost:5000"
);

/**
 * Integration with PriceService
 * 
 * Add this to your priceService.ts:
 * 
 * async function scrapeProductWithPythonScraper(productUrl: string) {
 *   try {
 *     const result = await scraper.scrapeProduct(productUrl);
 *     if (result.success) {
 *       return {
 *         price: result.data.price,
 *         imageUrl: result.data.image_url,
 *         title: result.data.title,
 *         currency: result.data.currency,
 *       };
 *     }
 *   } catch (error) {
 *     logger.error("Python scraper failed", { productUrl, error });
 *   }
 *   return null;
 * }
 */

module.exports = {
  DirectScraperIntegration,
  APIScraperIntegration,
  scraper, // Default instance
};

/**
 * Example usage:
 * 
 * // Single product
 * const result = await scraper.scrapeProduct("https://www.nike.com/...");
 * console.log(result.data.price, result.data.image_url);
 * 
 * // Multiple products
 * const results = await scraper.scrapeProducts([
 *   "https://www.nike.com/...",
 *   "https://www.zara.com/...",
 * ]);
 * 
 * // Detect scraper type
 * const { scraper_type } = await scraper.detectScraperType("...");
 * console.log(scraper_type); // "NikeScraper", "ZaraScraper", etc.
 */
