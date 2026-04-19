"""
Data models for the product scraper.
"""
from dataclasses import dataclass
from typing import Optional
from enum import Enum


class ScraperType(str, Enum):
    """Supported scraper types."""
    NIKE = "nike"
    ZARA = "zara"
    H_AND_M = "h_and_m"
    AMAZON = "amazon"
    SHOPIFY = "shopify"
    GENERIC = "generic"


@dataclass
class ProductData:
    """Structured product data output."""
    product_url: str
    price: Optional[str] = None
    image_url: Optional[str] = None
    title: Optional[str] = None
    currency: Optional[str] = None
    brand: Optional[str] = None
    in_stock: Optional[bool] = None
    scraper_type: str = "unknown"
    
    def to_dict(self):
        """Convert to dictionary."""
        return {
            "product_url": self.product_url,
            "price": self.price,
            "image_url": self.image_url,
            "title": self.title,
            "currency": self.currency,
            "brand": self.brand,
            "in_stock": self.in_stock,
            "scraper_type": self.scraper_type,
        }


@dataclass
class ScrapingError:
    """Error information from scraping."""
    url: str
    error_type: str
    message: str
    retry_count: int = 0
