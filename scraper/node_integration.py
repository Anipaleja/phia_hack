"""
Node.js integration helper.

This module provides utilities for the Node.js backend to call the Python scraper.
Can be used either as:
1. HTTP API client (when Python scraper runs as separate service)
2. Direct subprocess calls (when running locally)
"""
import asyncio
import json
import subprocess
import os
from typing import List, Dict, Optional, Any

from logging_config import get_logger

logger = get_logger(__name__)


class ScraperClient:
    """Client for calling the product scraper."""
    
    def __init__(self, scraper_url: Optional[str] = None, use_direct_call: bool = False):
        """
        Initialize the scraper client.
        
        Args:
            scraper_url: Base URL of the scraper API (e.g., http://localhost:5000)
            use_direct_call: Whether to use direct subprocess calls instead of HTTP
        """
        self.scraper_url = scraper_url or os.getenv("SCRAPER_API_URL", "http://localhost:5000")
        self.use_direct_call = use_direct_call
    
    async def scrape_url(self, url: str) -> Dict[str, Any]:
        """
        Scrape a single product URL.
        
        Args:
            url: Product URL
            
        Returns:
            Product data dictionary
        """
        if self.use_direct_call:
            return self._scrape_url_direct(url)
        else:
            return await self._scrape_url_http(url)
    
    async def scrape_urls(self, urls: List[str]) -> List[Dict[str, Any]]:
        """
        Scrape multiple product URLs.
        
        Args:
            urls: List of product URLs
            
        Returns:
            List of product data dictionaries
        """
        if self.use_direct_call:
            return self._scrape_urls_direct(urls)
        else:
            return await self._scrape_urls_http(urls)
    
    async def _scrape_url_http(self, url: str) -> Dict[str, Any]:
        """Scrape using HTTP API."""
        try:
            import aiohttp
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.scraper_url}/scrape",
                    json={"url": url},
                    timeout=aiohttp.ClientTimeout(total=60),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        logger.info("Scraped via HTTP", url=url)
                        return data
                    else:
                        logger.error("HTTP scrape failed", url=url, status=response.status)
                        return {"product_url": url}
        except Exception as e:
            logger.error("HTTP scraping error", url=url, error=str(e))
            return {"product_url": url}
    
    async def _scrape_urls_http(self, urls: List[str]) -> List[Dict[str, Any]]:
        """Scrape multiple URLs using HTTP API."""
        try:
            import aiohttp
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.scraper_url}/scrape/batch",
                    json={"urls": urls},
                    timeout=aiohttp.ClientTimeout(total=300),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        logger.info("Batch scraped via HTTP", count=len(urls))
                        return data.get("results", [])
                    else:
                        logger.error("HTTP batch scrape failed", status=response.status)
                        return [{"product_url": url} for url in urls]
        except Exception as e:
            logger.error("HTTP batch scraping error", error=str(e))
            return [{"product_url": url} for url in urls]
    
    def _scrape_url_direct(self, url: str) -> Dict[str, Any]:
        """Scrape using direct subprocess call."""
        try:
            result = subprocess.run(
                ["python3", "cli.py", "--url", url, "--format", "json"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            
            if result.returncode == 0:
                data = json.loads(result.stdout)
                if isinstance(data, list):
                    return data[0] if data else {"product_url": url}
                return data
            else:
                logger.error("Direct scrape failed", url=url, stderr=result.stderr)
                return {"product_url": url}
        except Exception as e:
            logger.error("Direct scraping error", url=url, error=str(e))
            return {"product_url": url}
    
    def _scrape_urls_direct(self, urls: List[str]) -> List[Dict[str, Any]]:
        """Scrape multiple URLs using direct subprocess calls."""
        try:
            result = subprocess.run(
                ["python3", "cli.py", "--urls", *urls, "--format", "json"],
                capture_output=True,
                text=True,
                timeout=300,
            )
            
            if result.returncode == 0:
                data = json.loads(result.stdout)
                logger.info("Batch direct scrape completed", count=len(urls))
                return data
            else:
                logger.error("Direct batch scrape failed", stderr=result.stderr)
                return [{"product_url": url} for url in urls]
        except Exception as e:
            logger.error("Direct batch scraping error", error=str(e))
            return [{"product_url": url} for url in urls]
    
    async def detect_scraper_type(self, url: str) -> Dict[str, str]:
        """
        Detect the scraper type for a URL.
        
        Args:
            url: Product URL
            
        Returns:
            Dictionary with scraper type and domain
        """
        if self.use_direct_call:
            from router import detect_scraper_type, get_domain
            return {
                "url": url,
                "scraper_type": detect_scraper_type(url).value,
                "domain": get_domain(url),
            }
        else:
            try:
                import aiohttp
                
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{self.scraper_url}/scrape/detect",
                        json={"url": url},
                    ) as response:
                        if response.status == 200:
                            return await response.json()
            except Exception as e:
                logger.error("Detect scraper type failed", url=url, error=str(e))
            
            return {"url": url, "scraper_type": "generic", "domain": "unknown"}


# Singleton instance for easy access
_client: Optional[ScraperClient] = None


def get_client(
    scraper_url: Optional[str] = None,
    use_direct_call: bool = False,
) -> ScraperClient:
    """
    Get a scraper client instance.
    
    Args:
        scraper_url: Base URL of the scraper API
        use_direct_call: Whether to use direct subprocess calls
        
    Returns:
        ScraperClient instance
    """
    global _client
    
    if _client is None:
        _client = ScraperClient(scraper_url=scraper_url, use_direct_call=use_direct_call)
    
    return _client


async def scrape_url(url: str) -> Dict[str, Any]:
    """Convenience function to scrape a single URL."""
    client = get_client()
    return await client.scrape_url(url)


async def scrape_urls(urls: List[str]) -> List[Dict[str, Any]]:
    """Convenience function to scrape multiple URLs."""
    client = get_client()
    return await client.scrape_urls(urls)
