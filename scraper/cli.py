#!/usr/bin/env python3
"""
Command-line interface for the product scraper.

Usage:
    python cli.py --url <url>
    python cli.py --urls <url1> <url2> <url3>
    python cli.py --batch <file.txt>
"""
import asyncio
import argparse
import json
import sys
import os
from pathlib import Path

from scraper import scrape_product, scrape_products
from logging_config import configure_logging, get_logger

logger = get_logger(__name__)


def parse_arguments():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Product scraper CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape a single URL
  python cli.py --url https://www.nike.com/t/revolution-5-shoes-2ahnz8
  
  # Scrape multiple URLs
  python cli.py --urls https://www.nike.com/... https://www.zara.com/...
  
  # Scrape from file (one URL per line)
  python cli.py --batch urls.txt
  
  # With proxy
  python cli.py --url https://example.com --proxy http://proxy:8080
  
  # With log level
  python cli.py --url https://example.com --log-level DEBUG
        """
    )
    
    parser.add_argument(
        "--url",
        type=str,
        help="Single product URL to scrape",
    )
    parser.add_argument(
        "--urls",
        nargs="+",
        help="Multiple product URLs to scrape",
    )
    parser.add_argument(
        "--batch",
        type=str,
        help="File containing URLs (one per line)",
    )
    parser.add_argument(
        "--proxy",
        type=str,
        help="Proxy URL (e.g., http://proxy:8080)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output file (default: stdout)",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Logging level",
    )
    parser.add_argument(
        "--format",
        type=str,
        default="json",
        choices=["json", "csv", "table"],
        help="Output format",
    )
    
    return parser.parse_args()


async def main():
    """Main CLI entry point."""
    args = parse_arguments()
    
    # Configure logging
    configure_logging(level=args.log_level)
    
    # Determine URLs to scrape
    urls = []
    if args.url:
        urls = [args.url]
    elif args.urls:
        urls = args.urls
    elif args.batch:
        try:
            with open(args.batch, "r") as f:
                urls = [line.strip() for line in f if line.strip()]
        except FileNotFoundError:
            logger.error("Batch file not found", file=args.batch)
            sys.exit(1)
    else:
        logger.error("No URLs provided. Use --url, --urls, or --batch")
        sys.exit(1)
    
    if not urls:
        logger.error("No valid URLs to scrape")
        sys.exit(1)
    
    # Scrape URLs
    logger.info("Starting scrape", url_count=len(urls))
    
    try:
        if len(urls) == 1:
            results = await scrape_product(urls[0], proxy=args.proxy)
            results = [results]
        else:
            results = await scrape_products(urls, proxy=args.proxy)
    except Exception as e:
        logger.error("Scraping failed", error=str(e))
        sys.exit(1)
    
    # Format output
    output = format_output(results, args.format)
    
    # Write output
    if args.output:
        try:
            with open(args.output, "w") as f:
                f.write(output)
            logger.info("Results written to file", file=args.output)
        except Exception as e:
            logger.error("Failed to write output file", error=str(e))
            sys.exit(1)
    else:
        print(output)


def format_output(results, format_type):
    """Format results for output."""
    if format_type == "json":
        return json.dumps(results, indent=2)
    
    elif format_type == "csv":
        if not results:
            return ""
        
        # Get all keys
        keys = set()
        for result in results:
            keys.update(result.keys())
        
        keys = sorted(list(keys))
        
        # Build CSV
        lines = [",".join(keys)]
        for result in results:
            values = [str(result.get(k, "")) for k in keys]
            lines.append(",".join(f'"{v}"' if "," in v else v for v in values))
        
        return "\n".join(lines)
    
    elif format_type == "table":
        if not results:
            return "No results"
        
        # Simple table format
        lines = []
        lines.append("=" * 120)
        
        for i, result in enumerate(results, 1):
            lines.append(f"\n[{i}] {result.get('product_url', 'N/A')}")
            lines.append("-" * 120)
            for key, value in sorted(result.items()):
                if key != "product_url":
                    lines.append(f"  {key:20s}: {value}")
        
        lines.append("=" * 120)
        return "\n".join(lines)
    
    return json.dumps(results, indent=2)


if __name__ == "__main__":
    asyncio.run(main())
