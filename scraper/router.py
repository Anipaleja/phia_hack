"""
Scraper router and factory functions.
"""
from urllib.parse import urlparse
from typing import Optional

from base_scraper import BaseScraper, ProxyConfig
from models import ScraperType
from scrapers import (
    NikeScraper,
    ZaraScraper,
    AmazonScraper,
    ShopifyScraper,
    HAndMScraper,
    GenericScraper,
)
from logging_config import get_logger

logger = get_logger(__name__)


DOMAIN_TO_SCRAPER = {
    "nike.com": NikeScraper,
    "zara.com": ZaraScraper,
    "amazon.com": AmazonScraper,
    "amazon.co.uk": AmazonScraper,
    "amazon.ca": AmazonScraper,
    "amazon.de": AmazonScraper,
    "amazon.fr": AmazonScraper,
    "h-and-m.com": HAndMScraper,
    "hm.com": HAndMScraper,
    "mytheresa.com": ShopifyScraper,
}

SHOPIFY_DOMAINS = [
    "myshopify.com",
    "shopify.com",
]


def get_domain(url: str) -> str:
    """
    Extract domain from URL.
    
    Args:
        url: Product URL
        
    Returns:
        Domain name (e.g., "nike.com")
    """
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Remove www. prefix
        if domain.startswith("www."):
            domain = domain[4:]
        return domain
    except Exception as e:
        logger.error("Failed to parse URL", url=url, error=str(e))
        return ""


def detect_scraper_type(url: str) -> ScraperType:
    """
    Detect the appropriate scraper type for a URL.
    
    Args:
        url: Product URL
        
    Returns:
        ScraperType enum value
    """
    domain = get_domain(url)
    
    # Check exact domain matches
    for known_domain, scraper_class in DOMAIN_TO_SCRAPER.items():
        if domain == known_domain or domain.endswith("." + known_domain):
            if scraper_class == NikeScraper:
                return ScraperType.NIKE
            elif scraper_class == ZaraScraper:
                return ScraperType.ZARA
            elif scraper_class == AmazonScraper:
                return ScraperType.AMAZON
            elif scraper_class == HAndMScraper:
                return ScraperType.H_AND_M
            elif scraper_class == ShopifyScraper:
                return ScraperType.SHOPIFY
    
    # Check for Shopify domains
    for shopify_domain in SHOPIFY_DOMAINS:
        if shopify_domain in domain:
            return ScraperType.SHOPIFY
    
    return ScraperType.GENERIC


def get_scraper(
    url: str,
    proxy_config: Optional[ProxyConfig] = None,
    headless: bool = True,
) -> BaseScraper:
    """
    Factory function to get the appropriate scraper for a URL.
    
    Args:
        url: Product URL to scrape
        proxy_config: Optional proxy configuration
        headless: Run browser in headless mode
        
    Returns:
        Appropriate BaseScraper instance
    """
    scraper_type = detect_scraper_type(url)
    
    logger.info("Selected scraper", url=url, scraper_type=scraper_type.value)
    
    scrapers = {
        ScraperType.NIKE: NikeScraper,
        ScraperType.ZARA: ZaraScraper,
        ScraperType.AMAZON: AmazonScraper,
        ScraperType.H_AND_M: HAndMScraper,
        ScraperType.SHOPIFY: ShopifyScraper,
        ScraperType.GENERIC: GenericScraper,
    }
    
    scraper_class = scrapers.get(scraper_type, GenericScraper)
    return scraper_class(proxy_config=proxy_config, headless=headless)
