# Phia Shopping Agent - Backend

Advanced Node.js + Express backend for AI-powered fashion shopping agent.

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account (free tier)
- OpenAI API key (fallback for Ollama)
- Unsplash API key (free)
- Pexels API key (free)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
# SUPABASE_URL=your_url
# SUPABASE_ANON_KEY=your_key
# OPENAI_API_KEY=your_key
# UNSPLASH_ACCESS_KEY=your_key
# PEXELS_API_KEY=your_key

# Start development server
npm run dev

# Build for production
npm run build
npm start
```

## Architecture

### Core Services

**AIService** — Style Generation
- Generates 5 fashion items using Ollama (local) or OpenAI (fallback)
- Validates JSON parsing and returns structured StyleItem[]
- Automatic fallback if Ollama unavailable

**ImageService** — Visual Search
- Fetches outfit images from Unsplash and Pexels APIs
- Implements 24-hour caching to respect API quotas
- Returns 5+ images per item with source attribution

**PriceService** — Price Aggregation
- Scrapes Google Shopping using Puppeteer headless browser
- Extracts prices, retailers, and product links
- Implements 24-hour caching and graceful degradation
- Returns top 10 results sorted by price

**ShoppingAgentService** — Orchestrator
- Combines AI + Images + Prices into single outfit
- Implements 3-tier pricing: cheap/mid/expensive
- Calculates outfit summaries with total and average costs
- Allows filtering by budget tier

### API Endpoints

#### Authentication (Public, Rate-Limited)
```
POST /api/auth/signup        — Register with email/password
POST /api/auth/login         — Login, returns JWT token
POST /api/auth/refresh       — Refresh expired token
```

#### Outfit Search (Authenticated, Rate-Limited to 50/day)
```
POST /api/outfits/search     — Main endpoint, generates outfit
GET  /api/outfits/search-history — View past searches
POST /api/outfits/save       — Save outfit to favorites
GET  /api/outfits/saved      — View saved outfits
DELETE /api/outfits/:id      — Delete saved outfit
```

#### User Profile (Authenticated)
```
GET  /api/user/profile       — Get user preferences
PUT  /api/user/profile       — Update style preferences, budget
POST /api/user/logout        — Logout
DELETE /api/user/account     — Delete account
```

#### System
```
GET /health                  — Health check (all services)
```

## Request/Response Examples

### Generate Outfit
```bash
curl -X POST http://localhost:3001/api/outfits/search \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "JFK Jr. preppy style outfit",
    "budgetTier": "all",
    "includeHistory": true
  }'
```

**Response:**
```json
{
  "outfit": [
    {
      "item": "blazer",
      "style": "preppy",
      "color": "navy blue",
      "material": "wool",
      "images": [
        {
          "url": "https://...",
          "source": "unsplash",
          "alt": "navy blazer"
        }
      ],
      "prices": {
        "cheap": { "price": 89.99, "retailer": "h&m.com", "productUrl": "..." },
        "mid": { "price": 199.99, "retailer": "bananarepublic.com", "productUrl": "..." },
        "expensive": { "price": 599.99, "retailer": "ralphlauren.com", "productUrl": "..." }
      }
    }
  ],
  "summary": {
    "totalItems": 5,
    "averagePrice": {
      "cheap": 127.98,
      "mid": 249.58,
      "expensive": 699.80
    },
    "prompt": "JFK Jr. preppy style outfit"
  }
}
```

## Security Features

**Authentication** - Supabase JWT tokens required for protected routes
**Rate Limiting** — 100 req/15min general, 50 searches/24h per user, 5 auth attempts/15min
**Server-Side Validation** — All inputs validated on backend
**API Key Protection** — All keys stored server-side (.env.example for reference)
**Error Handling** — Graceful degradation if any service fails (AI, images, prices)
**Logging** — Winston logger captures all events and errors
**CORS** — Whitelist frontend URLs only

## Database Schema

### Tables (Supabase PostgreSQL)

**searches**
- id, user_id, prompt, ai_response (JSON), created_at

**saved_outfits**
- id, user_id, outfit_data (JSON), prompt, created_at

**user_profiles** (optional)
- user_id, style_preferences (JSON), budget_range, updated_at

## Environment Variables

```
NODE_ENV=development
PORT=3001

# Supabase (required)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyNxxx...
SUPABASE_SERVICE_ROLE_KEY=eyNxxx...

# AI (OpenAI is fallback, Ollama is optional)
OPENAI_API_KEY=sk-xxx
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral

# Images (both required)
UNSPLASH_ACCESS_KEY=xxx
PEXELS_API_KEY=xxx

# Scraping
GOOGLE_SHOPPING_SCRAPE_TIMEOUT=30000
PRICE_CACHE_TTL=86400

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
```

## Development

### Run Tests
```bash
npm test
```

### Type Checking
```bash
npm run type-check
```

### Linting
```bash
npm run lint
```

## Performance Considerations

1. **Caching** — Images and prices cached for 24h to reduce API calls
2. **Parallel Operations** — AI, images, and prices fetched in parallel
3. **Graceful Degradation** — If image or price service fails, outfit is still returned
4. **Browser Pool** — Puppeteer reuses browser instance for scraping
5. **Rate Limiting** — Per-user limits prevent abuse of expensive operations

## Deployment

### Docker
```bash
docker build -t phia-backend .
docker run -p 3001:3001 --env-file .env phia-backend
```

### Vercel (Node.js)
```bash
vercel deploy
# Requires .env vars in Vercel project settings
```

## Troubleshooting

### "Ollama connection unavailable"
- This is expected if Ollama not running locally
- Backend will fallback to OpenAI automatically
- Make sure OPENAI_API_KEY is configured

### "Rate limit exceeded"
- Limit increased to 50 searches/24h per user
- Contact admin for quota increase if needed

### Images not loading
- Check UNSPLASH_ACCESS_KEY and PEXELS_API_KEY
- Verify they haven't exceeded free tier quotas
- Check API keys are valid in .env file

### Prices not fetching
- Puppeteer requires ~/.cache for Chromium
- On Linux, may need: `apt-get install -y libxss1`
- Google Shopping scraping is fragile (may need updates if Google changes layout)

## Future Enhancements

- [ ] Vector embeddings for style recommendations
- [ ] User style profile learning from saved outfits
- [ ] Real-time price drop notifications
- [ ] Integration with Shopify/Amazon for affiliate links
- [ ] Mobile app authentication (OAuth)
- [ ] Advanced filtering (size, color, eco-friendly, etc)
- [ ] Outfit share/social features
