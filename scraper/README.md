# Product Scraper

A comprehensive Python product scraper using Playwright and BeautifulSoup for extracting structured product data (URL, price, and primary product images) from modern e-commerce websites.

## Features

✅ **Multi-site Support**
- Nike, Zara, H&M, Amazon, Shopify stores, and generic fallback
- Extensible architecture for adding new sites

✅ **Advanced Scraping**
- Async/await with Playwright for JavaScript-heavy sites
- Automatic domain detection and site-specific scraping
- JSON-LD structured data extraction (SEO schema)
- DOM parsing fallback with intelligent selectors
- Retry logic with exponential backoff
- Timeout handling with graceful degradation

✅ **Resilience & Performance**
- Rotating user agents to avoid detection/blocking
- Proxy support for distributed scraping
- Concurrent URL processing (configurable workers)
- Browser context reuse for efficiency
- Comprehensive logging with structlog

✅ **Integration Options**
- Flask REST API for easy integration
- Direct Python async API
- CLI tool for batch operations
- Node.js integration helper

## Installation

### Requirements
- Python 3.8+
- Playwright browser binaries

### Setup

```bash
# Navigate to scraper directory
cd scraper

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers (required for first run)
playwright install chromium

# Verify installation
python cli.py --help
```

## Usage

### CLI Usage

```bash
# Scrape single URL
python cli.py --url "https://www.nike.com/t/revolution-5-shoes-2ahnz8"

# Scrape multiple URLs
python cli.py --urls \
  "https://www.nike.com/..." \
  "https://www.zara.com/..." \
  "https://www.amazon.com/..."

# Scrape from file (one URL per line)
python cli.py --batch urls.txt

# With options
python cli.py --url "https://..." \
  --proxy "http://proxy:8080" \
  --output results.json \
  --log-level DEBUG \
  --format json  # or csv, table

# Output examples
python cli.py --url "https://..." --format table
python cli.py --batch urls.txt --format csv --output results.csv
```

### Python API Usage

```python
import asyncio
from scraper import scrape_product, scrape_products

async def main():
    # Single URL
    result = await scrape_product("https://www.nike.com/...")
    print(result)
    # Output: {
    #   "product_url": "...",
    #   "price": "129.99",
    #   "image_url": "https://...",
    #   "title": "Nike Revolution 5",
    #   "currency": "USD",
    #   "brand": "Nike",
    #   "in_stock": True,
    #   "scraper_type": "NikeScraper"
    # }
    
    # Multiple URLs
    urls = [...]
    results = await scrape_products(urls)
    for result in results:
        print(result)

asyncio.run(main())
```

### Flask API Usage

```bash
# Start Flask server
FLASK_PORT=5000 python api.py

# Health check
curl http://localhost:5000/health

# Scrape single URL
curl -X POST http://localhost:5000/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.nike.com/..."}'

# Scrape batch
curl -X POST http://localhost:5000/scrape/batch \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.nike.com/...",
      "https://www.zara.com/..."
    ]
  }'

# Detect scraper type
curl -X POST http://localhost:5000/scrape/detect \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.nike.com/..."}'
```

### Node.js Backend Integration

In your Node backend, use the integration helper:

```javascript
// scraper_integration.js (call Python scraper from Node)
const { spawn } = require("child_process");
const { resolve } = require("path");

async function scrapProduct(productUrl) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn("python3", [
      resolve(__dirname, "../scraper/cli.py"),
      "--url", productUrl,
      "--format", "json"
    ]);

    let output = "";
    pythonProcess.stdout.on("data", (data) => {
      output += data.toString();
    });

    pythonProcess.on("close", (code) => {
      if (code === 0) {
        try {
          const results = JSON.parse(output);
          resolve(results[0] || { product_url: productUrl });
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Scraper exited with code ${code}`));
      }
    });
  });
}

module.exports = { scrapProduct };
```

Or via Flask API:

```javascript
// scraper_api_client.js
async function scrapProduct(productUrl) {
  const response = await fetch("http://localhost:5000/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: productUrl })
  });
  
  if (!response.ok) throw new Error(`Scraper API error: ${response.status}`);
  return response.json();
}

module.exports = { scrapProduct };
```

## Output Format

All scrapers return standardized ProductData:

```typescript
{
  product_url: string,         // Original URL
  price?: string,              // e.g., "129.99", "$99.99"
  image_url?: string,          // Primary product image URL
  title?: string,              // Product title/name
  currency?: string,           // e.g., "USD"
  brand?: string,              // Product brand
  in_stock?: boolean,          // Availability
  scraper_type: string         // Which scraper was used
}
```

## Architecture

### Class Hierarchy

```
BaseScraper (abstract base)
  ├── NikeScraper
  ├── ZaraScraper
  ├── AmazonScraper
  ├── HAndMScraper
  ├── ShopifyScraper
  └── GenericScraper
```

### Data Flow

1. **Router** (`router.py`) - Analyzes URL domain and selects appropriate scraper
2. **Scraper** (`scraper.py`) - Orchestrates async concurrent scraping
3. **Site-Specific Scrapers** (`scrapers.py`) - Domain-specific parsing logic
4. **Base Scraper** (`base_scraper.py`) - Shared Playwright + BeautifulSoup logic
5. **Models** (`models.py`) - Type definitions
6. **API Layer** (`api.py`) - Flask REST endpoints
7. **CLI** (`cli.py`) - Command-line interface
8. **Integration** (`node_integration.py`) - Node.js calling helpers

### Scraping Strategy

For each URL:

1. **Fetch** - Load page with Playwright, wait for network idle
2. **Extract JSON-LD** - Try structured data schema first
3. **Extract Price, Image, Title, Brand** from JSON-LD if available
4. **Fallback to DOM** - Parse HTML for common selectors if JSON-LD missing
5. **Image Selection** - Prefer hero/product images, exclude thumbnails
6. **Return** - Structured ProductData or partial data on failure

### Configuration

Environment variables:

```bash
# Logging
LOG_LEVEL=INFO

# Flask API
FLASK_PORT=5000
FLASK_DEBUG=false

# Scraper behavior
SCRAPER_HEADLESS=true
SCRAPER_MAX_CONCURRENT=3
SCRAPER_PROXY_URL=http://proxy:8080  # Optional

# Playwright timeouts
PLAYWRIGHT_TIMEOUT_MS=30000
PLAYWRIGHT_WAIT_UNTIL=networkidle
```

## Advanced Features

### Retry Logic

Automatic retry with exponential backoff:
```python
max_retries=3  # Default
# Retry delays: 1s, 2s, 4s
```

### Proxy Support

```python
from base_scraper import ProxyConfig
from scraper import ProductScraper

proxy_config = ProxyConfig(proxy_url="http://proxy:8080")
scraper = ProductScraper(proxy_config=proxy_config)
result = await scraper.scrape_url("https://...")
```

### User Agent Rotation

Automatically rotates between common user agents to avoid detection.

### Concurrent Processing

```python
scraper = ProductScraper(max_concurrent=5)
urls = [...]
results = await scraper.scrape_urls(urls)  # Processes 5 at a time
```

### Structured Logging

All operations logged with structured context:

```json
{"event": "page_fetched", "url": "...", "attempt": 1}
{"event": "json_ld_extracted", "type": "Product"}
{"event": "scraping_failed", "url": "...", "error": "..."}
```

## Error Handling

The scraper handles errors gracefully:

- **Network timeouts** → Retry with backoff → Return partial data
- **DOM parsing errors** → Skip selector, try next → Return partial data
- **Browser crashes** → Reinitialize → Retry
- **Invalid URLs** → Log warning → Return product with URL only

Never crashes entirely; always returns at least the product URL.

## Performance Tips

1. **Batch Processing** - Use `scrape_urls()` for multiple URLs (more efficient)
2. **Concurrency** - Adjust `max_concurrent` based on target site (default 3)
3. **Timeouts** - Increase for slow sites, decrease for fast responses
4. **Caching** - Implement caching layer to avoid re-scraping same URL
5. **Proxies** - Use for high-volume scraping to avoid blocking

## Adding New Sites

1. Create scraper class inheriting from `BaseScraper`
2. Implement `scrape_specific()` and site-specific extraction methods
3. Add domain mapping to `DOMAIN_TO_SCRAPER` in `router.py`
4. Test with URLs from that site

```python
class TargetScraper(BaseScraper):
    async def scrape_specific(self, url: str) -> ProductData:
        html = await self.fetch_page(url)
        soup = BeautifulSoup(html, "html.parser")
        
        price = self._extract_price(soup)
        image = self._extract_image(soup)
        
        return ProductData(
            product_url=url,
            price=price,
            image_url=image,
            scraper_type="TargetScraper"
        )
```

## Testing

```bash
# Single URL quick test
python cli.py --url "https://www.nike.com/t/revolution-5-shoes-2ahnz8"

# Batch test
echo "https://www.nike.com/..." > test_urls.txt
echo "https://www.zara.com/..." >> test_urls.txt
python cli.py --batch test_urls.txt

# API test
FLASK_PORT=5000 python api.py &
curl -X POST http://localhost:5000/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.nike.com/..."}'
```

## Troubleshooting

### "Browser not initialized"
- Call `scraper.initialize_browser()` before scraping
- Or use `ProductScraper` wrapper which handles this automatically

### Timeout errors
- Increase `timeout_ms` parameter
- Check network connectivity
- Try with a proxy

### Empty results (price/image missing)
- Site may use JavaScript rendering (handled by Playwright)
- May need site-specific extraction logic
- Check logs with `--log-level DEBUG`

### Rate limiting / Blocking
- Add delays between requests
- Use proxy rotation
- Reduce `max_concurrent`
- Implement backoff strategy

## License

MIT

## Support

For issues or improvements, add site-specific scrapers to `scrapers.py` or extend `BaseScraper`.
