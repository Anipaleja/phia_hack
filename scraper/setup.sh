#!/bin/bash
# Scraper setup script

set -e

echo "======================================"
echo "Product Scraper Setup"
echo "======================================"

# Check Python version
echo "Checking Python version..."
PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo "Found Python $PYTHON_VERSION"

# Install dependencies
echo ""
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Install Playwright browsers
echo ""
echo "Installing Playwright browsers..."
echo "(This may take 1-2 minutes)"
playwright install chromium

# Test installation
echo ""
echo "Testing installation..."
python3 -c "from scraper import ProductScraper; print('✓ Scraper module imported successfully')"

# Verify Playwright
echo ""
echo "Verifying Playwright..."
python3 -c "import asyncio; from scraper import scrape_product; print('✓ Async scraper ready')"

echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Test with: python cli.py --url <PRODUCT_URL>"
echo "2. Start API with: python api.py"
echo "3. Check README.md for detailed usage"
echo ""
