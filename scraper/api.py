"""
Flask API wrapper for the product scraper.

This allows the Node.js backend to call the Python scraper via HTTP.
"""
import asyncio
import os
from flask import Flask, request, jsonify
from typing import Optional

from scraper import ProductScraper
from base_scraper import ProxyConfig
from logging_config import configure_logging, get_logger

# Configure logging
configure_logging(level=os.getenv("LOG_LEVEL", "INFO"))
logger = get_logger(__name__)

app = Flask(__name__)

# Initialize scraper with configuration from environment
PROXY_URL = os.getenv("SCRAPER_PROXY_URL")
HEADLESS = os.getenv("SCRAPER_HEADLESS", "true").lower() == "true"
MAX_CONCURRENT = int(os.getenv("SCRAPER_MAX_CONCURRENT", "3"))

proxy_config = ProxyConfig(proxy_url=PROXY_URL) if PROXY_URL else None
scraper = ProductScraper(
    proxy_config=proxy_config,
    headless=HEADLESS,
    max_concurrent=MAX_CONCURRENT,
)


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "service": "product-scraper",
        "version": "1.0.0",
    }), 200


@app.route("/scrape", methods=["POST"])
def scrape_single():
    """
    Scrape a single product URL.
    
    Request JSON:
    {
        "url": "https://example.com/product",
        "proxy": "http://proxy:8080" (optional),
        "timeout": 30 (optional, default 30s)
    }
    
    Response JSON:
    {
        "product_url": str,
        "price": str | null,
        "image_url": str | null,
        "title": str | null,
        "currency": str | null,
        "brand": str | null,
        "in_stock": bool | null,
        "scraper_type": str
    }
    """
    try:
        data = request.get_json()
        
        if not data or "url" not in data:
            return jsonify({"error": "Missing required field: url"}), 400
        
        url = data.get("url")
        timeout = int(data.get("timeout", 30))
        
        # Use provided proxy or default
        proxy = data.get("proxy")
        proxy_config_arg = ProxyConfig(proxy_url=proxy) if proxy else proxy_config
        
        # Create scraper with custom proxy if provided
        local_scraper = ProductScraper(
            proxy_config=proxy_config_arg,
            headless=HEADLESS,
        )
        
        # Run async scraping
        result = asyncio.run(local_scraper.scrape_url_with_timeout(url, timeout))
        
        return jsonify(result.to_dict()), 200
    
    except Exception as e:
        logger.error("Scraping error", error=str(e), request_data=data)
        return jsonify({"error": str(e)}), 500


@app.route("/scrape/batch", methods=["POST"])
def scrape_batch():
    """
    Scrape multiple product URLs.
    
    Request JSON:
    {
        "urls": ["https://example1.com/product", "https://example2.com/product"],
        "proxy": "http://proxy:8080" (optional),
        "timeout": 30 (optional, default 30s per URL)
    }
    
    Response JSON:
    {
        "results": [
            {
                "product_url": str,
                "price": str | null,
                "image_url": str | null,
                ...
            },
            ...
        ],
        "count": int,
        "successful": int
    }
    """
    try:
        data = request.get_json()
        
        if not data or "urls" not in data:
            return jsonify({"error": "Missing required field: urls"}), 400
        
        urls = data.get("urls", [])
        if not isinstance(urls, list) or not urls:
            return jsonify({"error": "urls must be a non-empty list"}), 400
        
        timeout = int(data.get("timeout", 30))
        
        # Use provided proxy or default
        proxy = data.get("proxy")
        proxy_config_arg = ProxyConfig(proxy_url=proxy) if proxy else proxy_config
        
        local_scraper = ProductScraper(
            proxy_config=proxy_config_arg,
            headless=HEADLESS,
            max_concurrent=MAX_CONCURRENT,
        )
        
        # Run async batch scraping
        results = asyncio.run(local_scraper.scrape_urls(urls))
        
        successful = sum(1 for r in results if r.price or r.image_url)
        
        return jsonify({
            "results": [r.to_dict() for r in results],
            "count": len(results),
            "successful": successful,
        }), 200
    
    except Exception as e:
        logger.error("Batch scraping error", error=str(e))
        return jsonify({"error": str(e)}), 500


@app.route("/scrape/detect", methods=["POST"])
def detect_scraper_type():
    """
    Detect the scraper type for a given URL without scraping.
    
    Request JSON:
    {
        "url": "https://example.com/product"
    }
    
    Response JSON:
    {
        "url": str,
        "scraper_type": str,
        "domain": str
    }
    """
    try:
        data = request.get_json()
        
        if not data or "url" not in data:
            return jsonify({"error": "Missing required field: url"}), 400
        
        url = data.get("url")
        
        from router import detect_scraper_type, get_domain
        
        scraper_type = detect_scraper_type(url)
        domain = get_domain(url)
        
        return jsonify({
            "url": url,
            "scraper_type": scraper_type.value,
            "domain": domain,
        }), 200
    
    except Exception as e:
        logger.error("Scraper detection error", error=str(e))
        return jsonify({"error": str(e)}), 500


@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors."""
    return jsonify({
        "error": "Endpoint not found",
        "available_endpoints": [
            "POST /scrape",
            "POST /scrape/batch",
            "POST /scrape/detect",
            "GET /health",
        ]
    }), 404


@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors."""
    logger.error("Internal server error", error=str(e))
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    
    logger.info("Starting Flask API server", port=port, debug=debug)
    app.run(host="0.0.0.0", port=port, debug=debug)
