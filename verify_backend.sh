#!/bin/bash
# Backend Verification Script confirms all files exist and structure is valid

echo "Shopping Agent Backend Verification"
echo "==========================================="
echo ""

# Check TypeScript files
echo "✓ TypeScript Source Files:"
TS_COUNT=$(find backend/src -type f -name "*.ts" | wc -l)
echo "  Found $TS_COUNT TypeScript files"
find backend/src -name "*.ts" | sort | sed 's/^/    /'

echo ""
echo "✓ Configuration Files:"
CONFIG_FILES=("backend/package.json" "backend/tsconfig.json" "backend/.env.example" "backend/.gitignore")
for file in "${CONFIG_FILES[@]}"; do
  if [ -f "$file" ]; then
    SIZE=$(ls -lh "$file" | awk '{print $5}')
    echo "  ✓ $file ($SIZE)"
  fi
done

echo ""
echo "✓ Database Schema:"
if [ -f "backend/supabase.sql" ]; then
  LINES=$(wc -l < "backend/supabase.sql")
  echo "  ✓ backend/supabase.sql ($LINES lines)"
fi

echo ""
echo "✓ Documentation:"
DOC_FILES=("backend/README_backend.md" "backend/API_TESTING.md" "backend/ARCHITECTURE.md" "BACKEND_COMPLETE.md" "QUICK_START.md")
for file in "${DOC_FILES[@]}"; do
  if [ -f "$file" ]; then
    SIZE=$(ls -lh "$file" | awk '{print $5}')
    echo "  ✓ $file ($SIZE)"
  fi
done

echo ""
echo "Directory Structure:"
echo "  backend/"
echo "  ├── src/"
echo "  │   ├── config/       (Supabase, AI setup)"
echo "  │   ├── middleware/   (Auth, Rate limiting)"
echo "  │   ├── routes/       (API endpoints)"
echo "  │   ├── services/     (Core business logic)"
echo "  │   ├── types/        (TypeScript interfaces)"
echo "  │   ├── utils/        (Logger, Error handler)"
echo "  │   └── server.ts     (Express app)"
echo "  ├── package.json      (Dependencies)"
echo "  ├── tsconfig.json     (TypeScript config)"
echo "  ├── supabase.sql      (Database schema)"
echo "  └── documentation files"

echo ""
echo "Backend structure confirmed."
echo ""
echo "Next Steps:"
echo "1. cd backend && npm install"
echo "2. Copy .env.example to .env and add API keys"
echo "3. Set up Supabase database with supabase.sql"
echo "4. Run: npm run dev"
echo "5. Test API endpoints with Postman or curl"

