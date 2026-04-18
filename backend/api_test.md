## API Testing Guide - Phia Shopping Agent Backend

### Quick Test with curl

**Step 1: Start the server**
```bash
cd backend
npm install
npm run dev
# Server should start on http://localhost:3001
```

**Step 2: Health Check**
```bash
curl http://localhost:3001/health
```

**Step 3: Signup**
```bash
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123",
    "fullName": "Test User"
  }'
```

**Step 4: Login**
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123"
  }'
```

**Response:** You'll get a `token` (access token) and `refreshToken`. Copy the `token` for next steps.

**Step 5: Generate Outfit (Main Feature)**
```bash
TOKEN="your_token_from_login_response"

curl -X POST http://localhost:3001/api/outfits/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "JFK Jr. preppy style outfit",
    "budgetTier": "all",
    "includeHistory": true
  }'
```

**Expected Response:**
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
        "cheap": { "price": 89.99, "retailer": "h&m.com" },
        "mid": { "price": 199.99, "retailer": "bananarepublic.com" },
        "expensive": { "price": 599.99, "retailer": "ralphlauren.com" }
      }
    },
    ...
  ],
  "summary": {
    "totalItems": 5,
    "averagePrice": {
      "cheap": 127.98,
      "mid": 249.58,
      "expensive": 699.80
    }
  }
}
```

### Postman Collection

**Import this into Postman for easier testing:**

```json
{
  "info": {
    "name": "Phia Shopping Agent API",
    "description": "API collection for testing the Phia shopping agent backend"
  },
  "item": [
    {
      "name": "Health Check",
      "request": {
        "method": "GET",
        "url": "http://localhost:3001/health"
      }
    },
    {
      "name": "Auth - Signup",
      "request": {
        "method": "POST",
        "url": "http://localhost:3001/api/auth/signup",
        "header": [
          { "key": "Content-Type", "value": "application/json" }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"email\": \"test@example.com\",\n  \"password\": \"TestPassword123\",\n  \"fullName\": \"Test User\"\n}"
        }
      }
    },
    {
      "name": "Auth - Login",
      "request": {
        "method": "POST",
        "url": "http://localhost:3001/api/auth/login",
        "header": [
          { "key": "Content-Type", "value": "application/json" }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"email\": \"test@example.com\",\n  \"password\": \"TestPassword123\"\n}"
        }
      }
    },
    {
      "name": "Outfits - Generate",
      "request": {
        "method": "POST",
        "url": "http://localhost:3001/api/outfits/search",
        "header": [
          { "key": "Content-Type", "value": "application/json" },
          { "key": "Authorization", "value": "Bearer YOUR_TOKEN" }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"prompt\": \"JFK Jr. preppy style outfit\",\n  \"budgetTier\": \"all\",\n  \"includeHistory\": true\n}"
        }
      }
    },
    {
      "name": "Outfits - Search History",
      "request": {
        "method": "GET",
        "url": "http://localhost:3001/api/outfits/search-history",
        "header": [
          { "key": "Authorization", "value": "Bearer YOUR_TOKEN" }
        ]
      }
    },
    {
      "name": "User - Get Profile",
      "request": {
        "method": "GET",
        "url": "http://localhost:3001/api/user/profile",
        "header": [
          { "key": "Authorization", "value": "Bearer YOUR_TOKEN" }
        ]
      }
    },
    {
      "name": "User - Update Profile",
      "request": {
        "method": "PUT",
        "url": "http://localhost:3001/api/user/profile",
        "header": [
          { "key": "Content-Type", "value": "application/json" },
          { "key": "Authorization", "value": "Bearer YOUR_TOKEN" }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"stylePreferences\": {\"colors\": [\"blue\", \"navy\"]},\n  \"budgetRange\": \"mid\"\n}"
        }
      }
    }
  ]
}
```

### VS Code REST Client Extension

**Create `.http` file for testing:**

```http
### Health Check
GET http://localhost:3001/health

### Signup
POST http://localhost:3001/api/auth/signup
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "TestPassword123",
  "fullName": "Test User"
}

### Login
POST http://localhost:3001/api/auth/login
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "TestPassword123"
}

### Generate Outfit (UPDATE TOKEN BELOW)
POST http://localhost:3001/api/outfits/search
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "prompt": "JFK Jr. preppy style",
  "budgetTier": "all",
  "includeHistory": true
}

### Get Search History
GET http://localhost:3001/api/outfits/search-history
Authorization: Bearer YOUR_TOKEN_HERE

### Get Profile
GET http://localhost:3001/api/user/profile
Authorization: Bearer YOUR_TOKEN_HERE

### Update Profile
PUT http://localhost:3001/api/user/profile
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "stylePreferences": {
    "colors": ["blue", "navy", "white"],
    "styles": ["preppy", "classic"]
  },
  "budgetRange": "mid"
}
```

### Service-by-Service Testing

**Test AI Service Only**
```bash
curl -X POST http://localhost:3001/api/ai/generate-styles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Minimalist Japanese fashion",
    "modelPreference": "gemini"
  }'
```

**Test with Different Prompts**
```bash
# Classic luxury
curl ... -d '{"prompt": "Hermès, luxury leather jacket, designer outfit"}'

# Streetwear
curl ... -d '{"prompt": "Supreme, streetwear, hip-hop inspired"}'

# Minimalist
curl ... -d '{"prompt": "All-black minimalist capsule wardrobe"}'

# Vintage
curl ... -d '{"prompt": "Y2K vintage early 2000s fashion"}'

# Athletic
curl ... -d '{"prompt": "Nike, Adidas, athletic wear, gym outfit"}'
```

### Budget Tier Testing

Test each budget tier to see price variation:

```bash
# Cheap only
curl ... -d '{"prompt": "yoga outfit", "budgetTier": "cheap"}'

# Mid only
curl ... -d '{"prompt": "yoga outfit", "budgetTier": "mid"}'

# Expensive only
curl ... -d '{"prompt": "yoga outfit", "budgetTier": "expensive"}'

# All (default)
curl ... -d '{"prompt": "yoga outfit", "budgetTier": "all"}'
```

### Error Testing

**Missing token** (should return 401)
```bash
curl http://localhost:3001/api/outfits/search \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}'
```

**Invalid token** (should return 401)
```bash
curl http://localhost:3001/api/outfits/search \
  -H "Authorization: Bearer invalid_token" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}'
```

**Rate limit exceeded** (make 51+ requests in 24h)
```bash
# Will eventually return 429 after 50 searches
```

**Invalid password** (should return 401)
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "wrong"}'
```

**Empty prompt** (should return 400)
```bash
curl -X POST http://localhost:3001/api/outfits/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": ""}'
```

### Performance Testing

**Time the outfit generation**
```bash
time curl -X POST http://localhost:3001/api/outfits/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test outfit", "budgetTier": "all"}'
```

**Typical response times:**
- First request: 10-30 seconds (cache miss)
- Subsequent requests (same query): <1 second (cache hit)

### Database Testing

**Check saved data in Supabase**
```sql
-- View all searches
SELECT * FROM searches;

-- View saved outfits
SELECT * FROM saved_outfits;

-- View user preferences
SELECT * FROM user_profiles;
```

### Troubleshooting

**Endpoint returns 404**
- Check URL spelling and HTTP method (GET vs POST)
- Verify server is running (`npm run dev`)

**"Gemini not configured" error**
- Set GEMINI_API_KEY in .env file
- Optionally set GEMINI_MODEL (default is gemini-1.5-flash)

**"OpenAI not configured" error**
- Set OPENAI_API_KEY in .env file
- Or rely on Gemini as primary provider

**"Rate limit exceeded"**
- Wait 24 hours or use different email
- Check X-RateLimit-Remaining header

**Prices not showing**
- Google Shopping scraping may fail
- Check Puppeteer logs
- May need Chromium binary on Linux

**Images not loading**
- Check UNSPLASH_ACCESS_KEY and PEXELS_API_KEY
- Verify they haven't exceeded quota
- Should default to Pexels if Unsplash fails
