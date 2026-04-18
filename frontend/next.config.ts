import type { NextConfig } from "next";

/**
 * API proxy lives in Route Handlers:
 * - `src/app/api/[[...path]]/route.ts` → Express `/api/...`
 * - `src/app/health/route.ts` → Express `/health`
 * Set BACKEND_PROXY_TARGET if the API is not on http://127.0.0.1:3001
 */
const nextConfig: NextConfig = {};

export default nextConfig;
