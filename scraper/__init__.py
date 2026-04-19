"""Product Scraper Package."""

__version__ = "1.0.0"
__author__ = "Phia Hack Team"

from models import ProductData, ScrapingError, ScraperType
from scraper import ProductScraper, scrape_product, scrape_products
from base_scraper import BaseScraper, ProxyConfig
from router import get_scraper, detect_scraper_type, get_domain
from logging_config import configure_logging, get_logger

__all__ = [
    "ProductData",
    "ScrapingError",
    "ScraperType",
    "ProductScraper",
    "scrape_product",
    "scrape_products",
    "BaseScraper",
    "ProxyConfig",
    "get_scraper",
    "detect_scraper_type",
    "get_domain",
    "configure_logging",
    "get_logger",
]
