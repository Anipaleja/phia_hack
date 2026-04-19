"""
Product scraper orchestrator and main entry point.
"""
import asyncio
from typing import List, Optional, Dict, Any
from concurrent.futures import ThreadPoolExecutor

from base_scraper import ProxyConfig
from models import ProductData
from router import get_scraper
from logging_config import get_logger, configure_logging

logger = get_logger(__name__)


class ProductScraper:
    """
    Main product scraper orchestrator.
    
    Handles:
    - Single URL scraping
    - Batch URL scraping
    - Async operations
    - Browser lifecycle management
    """
    
    def __init__(
        self,
        proxy_config: Optional[ProxyConfig] = None,
        headless: bool = True,
        max_concurrent: int = 3,
    ):
        """
        Initialize the product scraper.
        
        Args:
            proxy_config: Optional proxy configuration
            headless: Run browser in headless mode
            max_concurrent: Maximum concurrent scraping operations
        """
        self.proxy_config = proxy_config
        self.headless = headless
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
    
    async def scrape_url(self, url: str) -> ProductData:
        """
        Scrape a single product URL.
        
        Args:
            url: Product URL to scrape
            
        Returns:
            ProductData with extracted information
        """
        async with self.semaphore:
            try:
                scraper = get_scraper(
                    url,
                    proxy_config=self.proxy_config,
                    headless=self.headless,
                )
                
                await scraper.initialize_browser()
                try:
                    product_data = await scraper.scrape(url)
                    return product_data
                finally:
                    await scraper.close_browser()
            
            except Exception as e:
                logger.error("Failed to scrape URL", url=url, error=str(e))
                return ProductData(product_url=url)
    
    async def scrape_urls(self, urls: List[str]) -> List[ProductData]:
        """
        Scrape multiple product URLs concurrently.
        
        Args:
            urls: List of product URLs
            
        Returns:
            List of ProductData objects
        """
        logger.info("Starting batch scrape", count=len(urls))
        
        tasks = [self.scrape_url(url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Handle exceptions
        product_data_list = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error("Scraping task failed", index=i, error=str(result))
                product_data_list.append(ProductData(product_url=urls[i]))
            else:
                product_data_list.append(result)
        
        logger.info("Batch scrape complete", success_count=len([r for r in results if not isinstance(r, Exception)]))
        return product_data_list
    
    async def scrape_url_with_timeout(
        self,
        url: str,
        timeout_seconds: int = 30,
    ) -> ProductData:
        """
        Scrape a URL with timeout protection.
        
        Args:
            url: Product URL
            timeout_seconds: Timeout in seconds
            
        Returns:
            ProductData or product with only URL set if timeout
        """
        try:
            return await asyncio.wait_for(
                self.scrape_url(url),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            logger.warning("Scraping timeout", url=url, timeout=timeout_seconds)
            return ProductData(product_url=url)
        except Exception as e:
            logger.error("Scraping error", url=url, error=str(e))
            return ProductData(product_url=url)


async def scrape_product(url: str, proxy: Optional[str] = None) -> Dict[str, Any]:
    """
    Convenience function to scrape a single product.
    
    Args:
        url: Product URL
        proxy: Optional proxy URL
        
    Returns:
        Product data dictionary
    """
    proxy_config = ProxyConfig(proxy_url=proxy) if proxy else None
    scraper = ProductScraper(proxy_config=proxy_config)
    result = await scraper.scrape_url(url)
    return result.to_dict()


async def scrape_products(urls: List[str], proxy: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Convenience function to scrape multiple products.
    
    Args:
        urls: List of product URLs
        proxy: Optional proxy URL
        
    Returns:
        List of product data dictionaries
    """
    proxy_config = ProxyConfig(proxy_url=proxy) if proxy else None
    scraper = ProductScraper(proxy_config=proxy_config)
    results = await scraper.scrape_urls(urls)
    return [result.to_dict() for result in results]


if __name__ == "__main__":
    # Example usage
    configure_logging(level="INFO")
    
    async def main():
        # Single URL
        url = "https://www.nike.com/t/revolution-5-shoes-2ahnz8"
        result = await scrape_product(url)
        print("Single URL Result:")
        print(result)
        
        # Multiple URLs
        urls = [
            "https://www.nike.com/t/revolution-5-shoes-2ahnz8",
            "https://www.zara.com/us/en/knit-dress-p08676018.html",
        ]
        results = await scrape_products(urls)
        print("\nBatch Results:")
        for result in results:
            print(result)
    
    asyncio.run(main())
