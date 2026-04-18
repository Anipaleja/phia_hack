#!/usr/bin/env bash
set -euo pipefail

node dist/server.js > /tmp/phia_e2e.log 2>&1 &
SERVER_PID=$!
cleanup(){ kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT
sleep 3

echo '--- Health ---'
curl -s http://localhost:3001/health | head -c 300; echo

EMAIL="e2e$(date +%s)@example.com"
PASSWORD="StrongPass123"

if [ -n "${E2E_EMAIL:-}" ]; then
  EMAIL="$E2E_EMAIL"
fi

if [ -n "${E2E_PASSWORD:-}" ]; then
  PASSWORD="$E2E_PASSWORD"
fi

echo '--- Signup ---'
SIGNUP=$(curl -s -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$SIGNUP" | head -c 300; echo

if echo "$SIGNUP" | grep -qi "rate limit"; then
  echo 'Signup rate limited by Supabase; proceeding to login with provided credentials.'
fi

echo '--- Login ---'
LOGIN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$LOGIN" | head -c 300; echo

TOKEN=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.token||x.session?.access_token||"")' "$LOGIN")
if [ -z "$TOKEN" ]; then
  echo 'FAILED: no token from login'
  echo 'Tip: export E2E_EMAIL and E2E_PASSWORD for an existing account if signup is rate-limited.'
  tail -n 80 /tmp/phia_e2e.log
  exit 1
fi

echo '--- Outfit Search ---'
SEARCH=$(curl -s -X POST http://localhost:3001/api/outfits/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"JFK Jr spring outfit in NYC","budgetTier":"all","includeHistory":true}')
echo "$SEARCH" | head -c 500; echo

HAS_RECS=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(Array.isArray(x.recommendations?.items) && x.recommendations.items.length>0 ? "yes":"no")' "$SEARCH")
HAS_VARIANTS=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(Array.isArray(x.variants) && x.variants.length>0 ? "yes":"no")' "$SEARCH")
SHARE_ID=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.shareId||"")' "$SEARCH")

if [ "$HAS_RECS" != "yes" ] || [ "$HAS_VARIANTS" != "yes" ]; then
  echo 'FAILED: search response missing variants/recommendations'
  tail -n 80 /tmp/phia_e2e.log
  exit 1
fi

echo '--- Analytics Summary (global) ---'
AN1=$(curl -s http://localhost:3001/analytics/summary)
echo "$AN1" | head -c 300; echo

echo '--- Analytics Summary (auth route) ---'
AN2=$(curl -s http://localhost:3001/api/outfits/analytics/summary -H "Authorization: Bearer $TOKEN")
echo "$AN2" | head -c 300; echo

if [ -z "$SHARE_ID" ]; then
  echo '--- Share Create ---'
  SHARE=$(curl -s -X POST http://localhost:3001/api/outfits/share \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"outfit\":$SEARCH}")
  echo "$SHARE" | head -c 300; echo
  SHARE_ID=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.shareId||"")' "$SHARE")
fi

if [ -z "$SHARE_ID" ]; then
  echo 'FAILED: no shareId available'
  tail -n 100 /tmp/phia_e2e.log
  exit 1
fi

echo '--- Shared Outfit Fetch ---'
SHARED=$(curl -s http://localhost:3001/api/outfits/shared/$SHARE_ID)
echo "$SHARED" | head -c 400; echo

OK_SHARED=$(node -e 'const x=JSON.parse(process.argv[1]); console.log(x.outfit?.shareId ? "yes":"no")' "$SHARED")
if [ "$OK_SHARED" != "yes" ]; then
  echo 'FAILED: shared outfit fetch invalid payload'
  tail -n 100 /tmp/phia_e2e.log
  exit 1
fi

echo 'E2E_RESULT: PASS'
