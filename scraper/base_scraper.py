"""
Base scraper class with shared functionality.
"""
import asyncio
import json
import random
import re
from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin

from playwright.async_api import async_playwright, Browser, BrowserContext
from bs4 import BeautifulSoup

from models import ProductData, ScrapingError
from logging_config import get_logger

logger = get_logger(__name__)


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
]


class ProxyConfig:
    """Proxy configuration for requests."""
    
    def __init__(self, proxy_url: Optional[str] = None):
        self.proxy_url = proxy_url
    
    def get_proxy_dict(self) -> Optional[Dict[str, str]]:
        """Get proxy configuration for Playwright."""
        if not self.proxy_url:
            return None
        return {
            "server": self.proxy_url,
        }


class BaseScraper(ABC):
    """
    Base scraper class with shared functionality.
    
    Provides:
    - Async Playwright integration
    - JSON-LD extraction
    - DOM parsing fallbacks
    - Retry logic
    - User agent rotation
    - Timeout handling
    - Graceful error handling
    """
    
    def __init__(
        self,
        max_retries: int = 1,
        timeout_ms: int = 30000,
        proxy_config: Optional[ProxyConfig] = None,
        headless: bool = True,
    ):
        """
        Initialize the scraper.
        
        Args:
            max_retries: Maximum number of retry attempts
            timeout_ms: Page load timeout in milliseconds
            proxy_config: Optional proxy configuration
            headless: Run browser in headless mode
        """
        self.max_retries = max_retries
        self.timeout_ms = timeout_ms
        self.proxy_config = proxy_config or ProxyConfig()
        self.headless = headless
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
    
    async def initialize_browser(self) -> None:
        """Initialize the browser and context."""
        try:
            playwright = await async_playwright().start()
            launch_strategies = [
                {
                    "name": "chrome-channel",
                    "kwargs": {
                        "channel": "chrome",
                        "headless": self.headless,
                        "proxy": self.proxy_config.get_proxy_dict() if self.proxy_config else None,
                        "args": ["--disable-dev-shm-usage", "--no-sandbox"],
                    },
                },
                {
                    "name": "bundled-chromium",
                    "kwargs": {
                        "headless": self.headless,
                        "proxy": self.proxy_config.get_proxy_dict() if self.proxy_config else None,
                        "args": ["--disable-dev-shm-usage", "--no-sandbox"],
                    },
                },
            ]

            launch_error = None
            for strategy in launch_strategies:
                try:
                    self.browser = await playwright.chromium.launch(**strategy["kwargs"])
                    logger.info("Browser initialized successfully", strategy=strategy["name"])
                    break
                except Exception as strategy_error:
                    launch_error = strategy_error
                    logger.warning(
                        "Browser launch strategy failed",
                        strategy=strategy["name"],
                        error=str(strategy_error),
                    )

            if not self.browser:
                raise launch_error if launch_error else RuntimeError("No browser launch strategy succeeded")

            self.context = await self.browser.new_context(
                user_agent=random.choice(USER_AGENTS),
            )
        except Exception as e:
            logger.error("Failed to initialize browser", error=str(e))
            raise
    
    async def close_browser(self) -> None:
        """Close the browser."""
        try:
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            logger.info("Browser closed successfully")
        except Exception as e:
            logger.error("Error closing browser", error=str(e))
    
    async def fetch_page(self, url: str) -> str:
        """
        Fetch page content using Playwright with retries.
        
        Args:
            url: URL to fetch
            
        Returns:
            Page HTML content
            
        Raises:
            Exception: If all retries fail
        """
        if not self.context:
            raise RuntimeError("Browser not initialized. Call initialize_browser() first.")
        
        last_error = None
        for attempt in range(self.max_retries):
            try:
                page = await self.context.new_page()
                try:
                    # Set random user agent
                    await page.set_extra_http_headers({
                        "User-Agent": random.choice(USER_AGENTS),
                    })
                    
                    # Navigate to URL
                    await page.goto(url, wait_until="networkidle", timeout=self.timeout_ms)
                    
                    # Wait for content to settle
                    await asyncio.sleep(1)

                    # Trigger lazy-loaded product media by scrolling through the page.
                    await page.evaluate(
                        """
                        async () => {
                            const maxScrolls = 8;
                            for (let step = 0; step < maxScrolls; step += 1) {
                                window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
                                await new Promise((resolve) => setTimeout(resolve, 250));
                            }
                            window.scrollTo(0, 0);
                        }
                        """
                    )
                    await asyncio.sleep(0.5)
                    
                    # Get page content
                    content = await page.content()
                    
                    logger.info("Page fetched successfully", url=url, attempt=attempt + 1)
                    return content
                finally:
                    await page.close()
            except asyncio.TimeoutError as e:
                last_error = e
                logger.warning("Timeout loading page", url=url, attempt=attempt + 1, error=str(e))
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
            except Exception as e:
                last_error = e
                logger.warning("Error fetching page", url=url, attempt=attempt + 1, error=str(e))
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
        
        raise Exception(f"Failed to fetch {url} after {self.max_retries} retries: {last_error}")
    
    def extract_json_ld(self, html: str) -> List[Dict[str, Any]]:
        """
        Extract JSON-LD structured data from HTML.
        
        Args:
            html: HTML content
            
        Returns:
            List of JSON-LD objects
        """
        soup = BeautifulSoup(html, "html.parser")
        json_ld_scripts = soup.find_all("script", {"type": "application/ld+json"})
        
        extracted_data = []
        for script in json_ld_scripts:
            try:
                data = json.loads(script.string)
                extracted_data.append(data)
                logger.debug("Extracted JSON-LD", type=data.get("@type"))
            except json.JSONDecodeError as e:
                logger.warning("Failed to parse JSON-LD", error=str(e))
        
        return extracted_data
    
    def extract_product_from_json_ld(self, json_ld_data: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """
        Extract product information from JSON-LD data.
        
        Args:
            json_ld_data: List of JSON-LD objects
            
        Returns:
            Product data dict or None
        """
        for data in json_ld_data:
            # Handle nested @graph
            if "@graph" in data:
                for item in data["@graph"]:
                    if item.get("@type") == "Product":
                        return self._extract_product_fields(item)
            elif data.get("@type") == "Product":
                return self._extract_product_fields(data)
        
        return None
    
    def _extract_product_fields(self, product: Dict[str, Any]) -> Dict[str, Any]:
        """Extract relevant fields from a Product JSON-LD object."""
        result = {}
        
        # Title
        result["title"] = product.get("name")
        
        # Price
        offers = product.get("offers")
        if isinstance(offers, dict):
            result["price"] = offers.get("price")
            result["currency"] = offers.get("priceCurrency")
            result["in_stock"] = offers.get("availability", "").endswith("InStock")
        elif isinstance(offers, list) and offers:
            result["price"] = offers[0].get("price")
            result["currency"] = offers[0].get("priceCurrency")
            result["in_stock"] = offers[0].get("availability", "").endswith("InStock")
        
        # Image
        image = product.get("image")
        if isinstance(image, list) and image:
            result["image_url"] = self._select_best_image(image)
        elif isinstance(image, str):
            result["image_url"] = image
        
        # Brand
        brand = product.get("brand")
        if isinstance(brand, dict):
            result["brand"] = brand.get("name")
        elif isinstance(brand, str):
            result["brand"] = brand
        
        return result
    
    def _select_best_image(self, images: List[Any]) -> Optional[str]:
        """
        Select the best image from a list.
        
        Prefers images with certain keywords and larger sizes.
        """
        candidates = []
        
        for img in images:
            if isinstance(img, str):
                candidates.append((img, 0))
            elif isinstance(img, dict):
                url = img.get("url") or img.get("contentUrl")
                if url:
                    # Score based on keywords
                    score = 0
                    lower_url = url.lower()
                    if any(kw in lower_url for kw in ["model", "product", "wear", "hero", "main"]):
                        score += 10
                    if any(kw in lower_url for kw in ["thumbnail", "thumb", "icon", "logo"]):
                        score -= 5
                    
                    candidates.append((url, score))
        
        if not candidates:
            return None
        
        # Sort by score (descending) and return the best
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[0][0]
    
    async def parse_html_fallback(self, html: str, url: str) -> ProductData:
        """
        Fallback DOM parsing when JSON-LD is not available.
        
        This is site-specific and should be overridden by subclasses.
        
        Args:
            html: HTML content
            url: Original URL
            
        Returns:
            ProductData with extracted information
        """
        soup = BeautifulSoup(html, "html.parser")
        
        # Prefer structured meta data before broad DOM selectors.
        price = self._extract_price_from_meta(soup)
        image_url = self._extract_image_from_meta(soup)
        
        if not price:
            price = self._extract_price_from_dom(soup)
        
        if not image_url:
            image_url = self._extract_image_from_dom(soup)

        if image_url:
            image_url = self._to_absolute_url(image_url, url)
        
        return ProductData(
            product_url=url,
            price=price,
            image_url=image_url,
            scraper_type=self.__class__.__name__,
        )

    def _to_absolute_url(self, value: str, page_url: str) -> str:
        """Normalize relative image URLs against page URL."""
        if value.startswith("http://") or value.startswith("https://"):
            return value
        return urljoin(page_url, value)

    def _extract_price_from_meta(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract price from OpenGraph/meta tags and embedded application data."""
        meta_candidates = [
            ("property", "product:price:amount"),
            ("property", "og:price:amount"),
            ("name", "product:price:amount"),
            ("itemprop", "price"),
        ]

        for key, value in meta_candidates:
            tag = soup.find("meta", {key: value})
            if tag and tag.get("content"):
                return str(tag.get("content")).strip()

        # Common embedded JSON payloads often contain "price": <number>
        for script in soup.find_all("script"):
            script_text = script.string or script.get_text() or ""
            if not script_text:
                continue

            match = re.search(r'"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?', script_text)
            if match:
                return match.group(1)

        return None

    def _extract_image_from_meta(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract product/hero image from OpenGraph/Twitter/meta tags."""
        candidates = [
            ("property", "og:image"),
            ("name", "twitter:image"),
            ("itemprop", "image"),
        ]

        for key, value in candidates:
            tag = soup.find("meta", {key: value})
            if tag and tag.get("content"):
                image = str(tag.get("content")).strip()
                if image and not any(k in image.lower() for k in ["logo", "icon", "sprite"]):
                    return image

        link_tag = soup.find("link", {"rel": "image_src"})
        if link_tag and link_tag.get("href"):
            image = str(link_tag.get("href")).strip()
            if image:
                return image

        return None
    
    def _extract_price_from_dom(self, soup: BeautifulSoup) -> Optional[str]:
        """
        Extract price from DOM using common selectors.
        
        Args:
            soup: BeautifulSoup object
            
        Returns:
            Price string or None
        """
        price_selectors = [
            "[data-testid='price']",
            ".price",
            ".product-price",
            "[class*='price']",
            "[id*='price']",
            ".cost",
            ".amount",
            "[class*='cost']",
        ]
        
        for selector in price_selectors:
            try:
                for element in soup.select(selector):
                    if not element or not element.get_text(strip=True):
                        continue

                    price_text = element.get_text(strip=True)
                    match = re.search(r'[\$£€]?\s?(\d+(?:[.,]\d{2})?)', price_text)
                    if match:
                        return price_text
            except Exception as e:
                logger.debug("Error extracting price with selector", selector=selector, error=str(e))
        
        return None
    
    def _extract_image_from_dom(self, soup: BeautifulSoup) -> Optional[str]:
        """
        Extract product image from DOM.
        
        Prioritizes large images and filters out icons/logos.
        
        Args:
            soup: BeautifulSoup object
            
        Returns:
            Image URL or None
        """
        image_candidates = []
        
        # Look for img tags
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or img.get("data-original")
            if not src:
                continue
            
            # Skip thumbnails and icons
            if any(x in src.lower() for x in ["thumb", "icon", "logo", "badge", "small"]):
                continue
            
            # Score the image
            score = 0
            alt_text = img.get("alt", "").lower()
            if any(kw in alt_text for kw in ["model", "product", "wear"]):
                score += 10
            
            # Prefer higher resolution
            width = img.get("width")
            if width:
                try:
                    score += min(int(width) // 100, 10)
                except (ValueError, TypeError):
                    pass
            
            image_candidates.append((src, score))

            srcset = img.get("srcset")
            if srcset:
                parsed_srcset = [segment.strip().split(" ")[0] for segment in srcset.split(",") if segment.strip()]
                if parsed_srcset:
                    # Highest resolution usually appears last in srcset.
                    image_candidates.append((parsed_srcset[-1], score + 4))
        
        # Look for picture elements (srcset)
        for picture in soup.find_all("picture"):
            for source in picture.find_all("source"):
                srcset = source.get("srcset")
                if srcset:
                    # Parse srcset and take the highest resolution
                    urls = [url.strip().split() for url in srcset.split(",")]
                    if urls:
                        image_candidates.append((urls[-1][0], 15))
            
            # Also check img within picture
            img = picture.find("img")
            if img:
                src = img.get("src")
                if src:
                    image_candidates.append((src, 12))
        
        if not image_candidates:
            return None
        
        image_candidates.sort(key=lambda x: x[1], reverse=True)
        best_image = image_candidates[0][0]
        
        return best_image
    
    async def scrape(self, url: str) -> ProductData:
        """
        Scrape a product page.
        
        This is the main entry point that should be called by subclasses.
        
        Args:
            url: Product URL to scrape
            
        Returns:
            ProductData with extracted information
        """
        try:
            # Fetch the page
            html = await self.fetch_page(url)
            
            # Try JSON-LD first
            json_ld_data = self.extract_json_ld(html)
            product_data = self.extract_product_from_json_ld(json_ld_data)
            
            if product_data:
                fallback = await self.parse_html_fallback(html, url)
                return ProductData(
                    product_url=url,
                    price=product_data.get("price") or fallback.price,
                    image_url=product_data.get("image_url") or fallback.image_url,
                    title=product_data.get("title") or fallback.title,
                    currency=product_data.get("currency") or fallback.currency,
                    brand=product_data.get("brand") or fallback.brand,
                    in_stock=product_data.get("in_stock"),
                    scraper_type=self.__class__.__name__,
                )
            
            # Fall back to DOM parsing
            logger.info("JSON-LD not found, using DOM fallback", url=url)
            return await self.parse_html_fallback(html, url)
        
        except Exception as e:
            logger.error("Scraping failed", url=url, error=str(e))
            # Return product with URL but no data rather than crashing
            return ProductData(
                product_url=url,
                scraper_type=self.__class__.__name__,
            )
    
    @abstractmethod
    async def scrape_specific(self, url: str) -> ProductData:
        """
        Site-specific scraping logic.
        
        Should be implemented by subclasses for specialized handling.
        
        Args:
            url: Product URL
            
        Returns:
            ProductData
        """
        pass
