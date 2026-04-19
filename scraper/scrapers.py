"""
Site-specific scrapers for different e-commerce platforms.
"""
from typing import Optional
from bs4 import BeautifulSoup
import re

from base_scraper import BaseScraper, ProxyConfig
from models import ProductData
from logging_config import get_logger

logger = get_logger(__name__)


class NikeScraper(BaseScraper):
    """Scraper for Nike.com products."""
    
    async def scrape_specific(self, url: str) -> ProductData:
        """Nike-specific scraping logic."""
        try:
            html = await self.fetch_page(url)
            soup = BeautifulSoup(html, "html.parser")
            
            # Nike often has data in script tags
            price = self._extract_nike_price(soup)
            image_url = self._extract_nike_image(soup)
            title = self._extract_nike_title(soup)
            
            return ProductData(
                product_url=url,
                price=price,
                image_url=image_url,
                title=title,
                scraper_type="NikeScraper",
            )
        except Exception as e:
            logger.error("Nike scraping failed", url=url, error=str(e))
            return ProductData(product_url=url, scraper_type="NikeScraper")
    
    def _extract_nike_price(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract price from Nike page."""
        # Try data attributes first
        price_elem = soup.find("div", {"data-testid": "product-price"})
        if price_elem:
            return price_elem.get_text(strip=True)
        
        # Try common selectors
        for selector in ["[class*='ProductPrice']", "[class*='price']"]:
            try:
                elem = soup.select_one(selector)
                if elem:
                    return elem.get_text(strip=True)
            except:
                pass
        
        return None
    
    def _extract_nike_image(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract primary product image from Nike page."""
        # Look for product image in specific containers
        img = soup.find("img", {"data-testid": "product-image"})
        if img:
            src = img.get("src")
            if src and "placeholder" not in src.lower():
                return src
        
        # Fallback to data-src (lazy loading)
        for img in soup.find_all("img"):
            if "product" in (img.get("alt") or "").lower():
                src = img.get("data-src") or img.get("src")
                if src and "placeholder" not in src.lower():
                    return src
        
        return None
    
    def _extract_nike_title(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract product title from Nike page."""
        title_elem = soup.find("h1")
        if title_elem:
            return title_elem.get_text(strip=True)
        return None


class ZaraScraper(BaseScraper):
    """Scraper for Zara.com products."""
    
    async def scrape_specific(self, url: str) -> ProductData:
        """Zara-specific scraping logic."""
        try:
            html = await self.fetch_page(url)
            soup = BeautifulSoup(html, "html.parser")
            
            price = self._extract_zara_price(soup)
            image_url = self._extract_zara_image(soup)
            title = self._extract_zara_title(soup)
            
            return ProductData(
                product_url=url,
                price=price,
                image_url=image_url,
                title=title,
                scraper_type="ZaraScraper",
            )
        except Exception as e:
            logger.error("Zara scraping failed", url=url, error=str(e))
            return ProductData(product_url=url, scraper_type="ZaraScraper")
    
    def _extract_zara_price(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract price from Zara page."""
        # Look for price in typical Zara selectors
        price_elem = soup.find("span", {"class": re.compile(r".*price.*")})
        if price_elem:
            price_text = price_elem.get_text(strip=True)
            if price_text and any(c.isdigit() for c in price_text):
                return price_text
        
        return None
    
    def _extract_zara_image(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract primary product image from Zara page."""
        # Zara images are typically in picture elements or specific containers
        picture = soup.find("picture")
        if picture:
            img = picture.find("img")
            if img:
                return img.get("src") or img.get("data-src")
        
        # Look for product image with specific class patterns
        img = soup.find("img", {"class": re.compile(r".*product.*|.*image.*")})
        if img:
            src = img.get("src") or img.get("data-src")
            if src:
                return src
        
        return None
    
    def _extract_zara_title(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract product title from Zara page."""
        title_elem = soup.find("h1")
        if title_elem:
            return title_elem.get_text(strip=True)
        
        title_elem = soup.find("span", {"class": re.compile(r".*product.*name.*")})
        if title_elem:
            return title_elem.get_text(strip=True)
        
        return None


class AmazonScraper(BaseScraper):
    """Scraper for Amazon products."""
    
    async def scrape_specific(self, url: str) -> ProductData:
        """Amazon-specific scraping logic."""
        try:
            html = await self.fetch_page(url)
            soup = BeautifulSoup(html, "html.parser")
            
            price = self._extract_amazon_price(soup)
            image_url = self._extract_amazon_image(soup)
            title = self._extract_amazon_title(soup)
            
            return ProductData(
                product_url=url,
                price=price,
                image_url=image_url,
                title=title,
                scraper_type="AmazonScraper",
            )
        except Exception as e:
            logger.error("Amazon scraping failed", url=url, error=str(e))
            return ProductData(product_url=url, scraper_type="AmazonScraper")
    
    def _extract_amazon_price(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract price from Amazon page."""
        # Try common Amazon price selectors
        selectors = [
            ".a-price-whole",
            "[data-a-color='price']",
            ".a-price",
        ]
        
        for selector in selectors:
            try:
                elem = soup.select_one(selector)
                if elem:
                    price_text = elem.get_text(strip=True)
                    if price_text:
                        return price_text
            except:
                pass
        
        return None
    
    def _extract_amazon_image(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract primary product image from Amazon page."""
        # Main product image is usually in the landingImage element
        img = soup.find("img", {"data-old-hires": True})
        if img:
            return img.get("src")
        
        # Fallback to image alt text
        img = soup.find("img", {"alt": re.compile(r".*product.*", re.I)})
        if img:
            return img.get("src")
        
        return None
    
    def _extract_amazon_title(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract product title from Amazon page."""
        title_elem = soup.find("h1")
        if title_elem:
            return title_elem.get_text(strip=True)
        
        title_elem = soup.find("span", {"id": "productTitle"})
        if title_elem:
            return title_elem.get_text(strip=True)
        
        return None


class ShopifyScraper(BaseScraper):
    """Generic Shopify store scraper."""
    
    async def scrape_specific(self, url: str) -> ProductData:
        """Shopify-specific scraping logic."""
        try:
            html = await self.fetch_page(url)
            soup = BeautifulSoup(html, "html.parser")
            
            # Shopify stores often use consistent data attributes
            price = self._extract_shopify_price(soup)
            image_url = self._extract_shopify_image(soup)
            title = self._extract_shopify_title(soup)
            
            return ProductData(
                product_url=url,
                price=price,
                image_url=image_url,
                title=title,
                scraper_type="ShopifyScraper",
            )
        except Exception as e:
            logger.error("Shopify scraping failed", url=url, error=str(e))
            return ProductData(product_url=url, scraper_type="ShopifyScraper")
    
    def _extract_shopify_price(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract price from Shopify page."""
        # Shopify meta tag
        meta_price = soup.find("meta", {"property": "product:price:amount"})
        if meta_price and meta_price.get("content"):
            return meta_price.get("content")
        
        # Shopify common selectors
        selectors = [
            "[data-price]",
            ".product-price",
            ".price",
            "[data-product-price]",
        ]
        
        for selector in selectors:
            try:
                elem = soup.select_one(selector)
                if elem:
                    return elem.get_text(strip=True).split()[0]
            except:
                pass
        
        return None
    
    def _extract_shopify_image(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract primary product image from Shopify page."""
        # Shopify meta OG image
        og_image = soup.find("meta", {"property": "og:image"})
        if og_image and og_image.get("content"):
            return og_image.get("content")
        
        # Primary product image
        img = soup.find("img", {"data-product-featured-image": True})
        if img:
            return img.get("src")
        
        return None
    
    def _extract_shopify_title(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract product title from Shopify page."""
        # Shopify meta title
        meta_title = soup.find("meta", {"property": "og:title"})
        if meta_title and meta_title.get("content"):
            return meta_title.get("content")
        
        h1 = soup.find("h1")
        if h1:
            return h1.get_text(strip=True)
        
        return None


class HAndMScraper(BaseScraper):
    """Scraper for H&M products."""
    
    async def scrape_specific(self, url: str) -> ProductData:
        """H&M-specific scraping logic."""
        try:
            html = await self.fetch_page(url)
            soup = BeautifulSoup(html, "html.parser")
            
            price = self._extract_hm_price(soup)
            image_url = self._extract_hm_image(soup)
            title = self._extract_hm_title(soup)
            
            return ProductData(
                product_url=url,
                price=price,
                image_url=image_url,
                title=title,
                scraper_type="HAndMScraper",
            )
        except Exception as e:
            logger.error("H&M scraping failed", url=url, error=str(e))
            return ProductData(product_url=url, scraper_type="HAndMScraper")
    
    def _extract_hm_price(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract price from H&M page."""
        # H&M price selectors
        price_elem = soup.find("span", {"class": re.compile(r".*price.*")})
        if price_elem:
            return price_elem.get_text(strip=True)
        
        return None
    
    def _extract_hm_image(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract primary product image from H&M page."""
        # H&M uses picture elements extensively
        picture = soup.find("picture")
        if picture:
            img = picture.find("img")
            if img:
                return img.get("src") or img.get("data-src")
        
        return None
    
    def _extract_hm_title(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract product title from H&M page."""
        h1 = soup.find("h1")
        if h1:
            return h1.get_text(strip=True)
        
        return None


class GenericScraper(BaseScraper):
    """Generic fallback scraper for unknown e-commerce sites."""
    
    async def scrape_specific(self, url: str) -> ProductData:
        """Generic fallback scraping."""
        try:
            html = await self.fetch_page(url)
            return await self.parse_html_fallback(html, url)
        except Exception as e:
            logger.error("Generic scraping failed", url=url, error=str(e))
            return ProductData(product_url=url, scraper_type="GenericScraper")
