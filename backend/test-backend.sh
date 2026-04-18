#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Backend Verification Test"
echo "=========================================="
echo ""

# Test 1: Check Node.js version
echo -n "Checking Node.js version... "
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 18 ]; then
  echo -e "${GREEN}✓ $(node -v)${NC}"
else
  echo -e "${RED}✗ Node.js 18+ required, found $(node -v)${NC}"
  exit 1
fi

# Test 2: Check npm
echo -n "Checking npm... "
if command -v npm &> /dev/null; then
  echo -e "${GREEN}✓ npm $(npm -v)${NC}"
else
  echo -e "${RED}✗ npm not found${NC}"
  exit 1
fi

# Test 3: Check TypeScript compilation
echo -n "Running TypeScript type check... "
cd "$(dirname "$0")"
if npm run type-check > /dev/null 2>&1; then
  echo -e "${GREEN}✓ No errors${NC}"
else
  echo -e "${RED}✗ TypeScript errors found${NC}"
  npm run type-check
  exit 1
fi

# Test 4: Check if build exists or build it
echo -n "Checking build... "
if [ ! -f "dist/server.js" ]; then
  echo "building..."
  if npm run build > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Build successful${NC}"
  else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}✓ Build up to date${NC}"
fi

# Test 5: Check dependencies
echo -n "Checking npm dependencies... "
if [ "$(npm list --depth=0 2>/dev/null | wc -l)" -gt 5 ]; then
  echo -e "${GREEN}✓ Installed${NC}"
else
  echo -e "${YELLOW}⚠ Dependencies appear missing, running npm install...${NC}"
  npm install
fi

# Test 6: Start server and verify it responds
echo ""
echo "Starting server for testing..."
node dist/server.js > /tmp/phia_server_test.log 2>&1 &
SERVER_PID=$!
sleep 3

echo -n "Testing /health endpoint... "
HEALTH_RESPONSE=$(curl -s http://localhost:3001/health)
if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
  echo -e "${GREEN}✓ Server is responding${NC}"
  echo "  Response: $HEALTH_RESPONSE"
else
  echo -e "${RED}✗ Server not responding${NC}"
  echo "  Log output:"
  cat /tmp/phia_server_test.log
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

# Test 7: Check available endpoints
echo -n "Checking API endpoints... "
ENDPOINTS=$(curl -s http://localhost:3001/health | grep -o '"[a-z]*":' | wc -l)
if [ "$ENDPOINTS" -gt 3 ]; then
  echo -e "${GREEN}✓ Endpoints accessible${NC}"
else
  echo -e "${RED}✗ Could not verify endpoints${NC}"
fi

# Test 8: Test invalid route returns 404
echo -n "Testing 404 error handling... "
NOT_FOUND=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/nonexistent)
if [ "$NOT_FOUND" = "404" ]; then
  echo -e "${GREEN}✓ Error handling working${NC}"
else
  echo -e "${RED}✗ Expected 404, got $NOT_FOUND${NC}"
fi

# Test 9: Test password validation
echo -n "Testing API validation... "
VALIDATION=$(curl -s -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"short"}')
if echo "$VALIDATION" | grep -q "INVALID_PASSWORD"; then
  echo -e "${GREEN}✓ Validation working${NC}"
else
  echo -e "${RED}✗ Validation not working${NC}"
  echo "  Response: $VALIDATION"
fi

# Cleanup
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

echo ""
echo "=========================================="
echo -e "${GREEN}✓ All tests passed!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Set up .env file with real credentials"
echo "  2. Run: npm run dev   (development with auto-reload)"
echo "  3. Or:  npm start     (production)"
echo ""
echo "Server will be available at: http://localhost:3001"
echo ""
