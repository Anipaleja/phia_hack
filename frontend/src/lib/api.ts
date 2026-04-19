/**
 * Closer frontend ↔ Phia backend integration.
 * Backend: Express on PORT (default 3001). See backend/api_test.md.
 */

/**
 * When empty, requests use same-origin paths (/api/..., /health) and Next.js rewrites
 * them to Express (see next.config.ts). Set NEXT_PUBLIC_API_URL only if the API is on another origin.
 */
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const SESSION_TOKEN_KEY = "closer_access_token";

/** Exposed for debugging connection issues in the UI if needed */
export function getApiBaseUrl(): string {
  return API_BASE_URL || "(same origin — proxied to backend)";
}

function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${p}` : p;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      _nonJsonBody: true,
      _preview: text.slice(0, 280),
    };
  }
}

function formatErrorDetails(details: unknown): string | null {
  if (details == null) return null;
  if (typeof details === "string") return details.trim() || null;
  if (Array.isArray(details)) {
    const parts = details
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object" && "message" in x) return String((x as { message: unknown }).message);
        return JSON.stringify(x);
      })
      .filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  }
  if (typeof details === "object") {
    return Object.entries(details as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(". ");
  }
  return null;
}

/**
 * Reads backend `{ error: { message, code, details } }`, plain `message`, or similar shapes.
 */
export function extractApiErrorMessage(body: unknown, response: Response): string {
  const status = response.status;
  const statusText = (response.statusText || "").trim();
  const fallback = statusText ? `${statusText} (${status})` : `Request failed (${status})`;

  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b._nonJsonBody === true && typeof b._preview === "string") {
      if (status === 404) {
        return `Got 404 (HTML, not the API). Usually: (1) Restart the frontend after changing next.config or .env. (2) Do not set NEXT_PUBLIC_API_URL to the Next dev URL (e.g. :3000)—use unset/empty for the proxy, or use http://localhost:3001. (3) Run the backend on the port in BACKEND_PROXY_TARGET (default 127.0.0.1:3001).`;
      }
      return `Server returned ${status} with a non-JSON body. If you use the dev proxy, restart Next; if you call the API directly, set NEXT_PUBLIC_API_URL to the Express origin.`;
    }

    const err = b.error;
    if (err && typeof err === "object" && err !== null) {
      const e = err as Record<string, unknown>;
      if (typeof e.message === "string" && e.message.trim()) {
        const base = e.message.trim();
        const extra = formatErrorDetails(e.details);
        return extra ? `${base} (${extra})` : base;
      }
      const fromDetails = formatErrorDetails(e.details);
      if (fromDetails) return fromDetails;
    }

    if (typeof b.message === "string" && b.message.trim()) {
      return b.message.trim();
    }
  }

  return fallback;
}

function isLikelyNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed|network request failed/i.test(error.message);
}

function apiNetworkErrorMessage(): string {
  if (API_BASE_URL) {
    return `Cannot reach the API at ${API_BASE_URL}. Start the backend (\`cd backend && npm run dev\`), fix NEXT_PUBLIC_API_URL if the port differs, and ensure CORS allows this site.`;
  }
  return `Cannot reach the API. Start Express on port 3001 (\`cd backend && npm run dev\`). With NEXT_PUBLIC_API_URL unset, Next proxies /api and /health—see frontend/next.config.ts (BACKEND_PROXY_TARGET). Restart the frontend dev server after env changes.`;
}

async function fetchJsonOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    if (isLikelyNetworkFailure(e)) {
      throw new Error(apiNetworkErrorMessage());
    }
    throw e;
  }
}

export type SearchRequest = {
  query: string;
  budget?: number;
  size?: string;
  limit?: number;
  vibe?: "casual" | "sharper";
};

export type SearchItem = {
  id: string;
  title: string;
  price: number;
  currency: string;
  imageUrl: string;
  productUrl: string;
  store: string;
  score: number;
  reason?: string;
};

export type SearchResponse = {
  items: SearchItem[];
  /** Human-readable explanation from the backend (curated celebrity vs scraped, etc.) */
  summary?: string;
  meta: {
    query: string;
    total: number;
  };
};

export type ProductTrendSourceKey = "closer_listing" | "python_scraper" | "productscrapes";

export type ProductTrendObservation = {
  timestamp: string;
  price: number;
  currency: string;
  retailer: string;
  source: ProductTrendSourceKey;
  productUrl: string;
};

export type ProductTrendMarketPoint = {
  label: string;
  price: number;
  currency: string;
  retailer: string;
  productUrl: string;
};

export type ProductTrendSourceInfo = {
  key: ProductTrendSourceKey;
  label: string;
  description: string;
  used: boolean;
};

export type ProductTrendResponse = {
  productUrl: string;
  observations: ProductTrendObservation[];
  marketScan: ProductTrendMarketPoint[];
  seriesMode: "observed_history" | "market_scan_fallback";
  historyLooksFlat: boolean;
  latestPrice: number | null;
  currency: string;
  updatedAt: string;
  note: string;
  sources: ProductTrendSourceInfo[];
};

export type CelebrityLookalikeMatch = {
  celebrity: string;
  confidence: number;
};

export type CelebrityLookalikeResponse = {
  closestCelebrity: string;
  confidence: number;
  topMatches: CelebrityLookalikeMatch[];
  provider: "gemini" | "openai";
  note: string;
};

export type LookalikeGender = "male" | "female";

/** Backend GET /health */
export type HealthStatus = {
  status: string;
  timestamp: string;
  services?: Record<string, string>;
};

/** Mirrors backend/src/types OutfitItem (subset used by UI) */
type BackendOutfitItem = {
  item: string;
  style: string;
  color: string;
  material: string;
  images: { url: string; alt?: string }[];
  prices: {
    cheap: BackendPricePoint | null;
    mid: BackendPricePoint | null;
    expensive: BackendPricePoint | null;
  };
};

type BackendPricePoint = {
  productName: string;
  price: number;
  currency: string;
  retailer: string;
  productUrl: string;
  imageUrl?: string;
};

type GenerateOutfitResponse = {
  prompt: string;
  summary: string;
  variants: BackendOutfitItem[];
  outfit?: BackendOutfitItem[];
  recommendations?: { label: string; items: string[] };
  cached?: boolean;
  created_at?: string;
};

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

export function setStoredToken(token: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearStoredToken() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export function getAccessToken(): string | null {
  return getStoredToken();
}

/**
 * GET /health (not under /api)
 */
export async function getHealth(): Promise<HealthStatus> {
  const response = await fetchJsonOrThrow(apiUrl("/health"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Backend health check failed");
  }
  return response.json();
}

export type LoginResult = {
  token: string;
  refreshToken?: string;
};

/**
 * POST /api/auth/login
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const response = await fetchJsonOrThrow(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = (await parseJsonSafe(response)) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(extractApiErrorMessage(data, response));
  }

  const token = data.token as string | undefined;
  if (!token) {
    throw new Error("No token in login response");
  }

  setStoredToken(token);
  return { token, refreshToken: data.refreshToken as string | undefined };
}

/**
 * POST /api/auth/signup — may require email confirmation before login works.
 */
export async function signup(
  email: string,
  password: string,
  fullName?: string
): Promise<{ message: string }> {
  const response = await fetchJsonOrThrow(apiUrl("/api/auth/signup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      fullName: fullName?.trim() || "",
    }),
  });

  const data = (await parseJsonSafe(response)) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(extractApiErrorMessage(data, response));
  }

  return { message: (data.message as string) ?? "Account created" };
}

function pickDisplayPrice(it: BackendOutfitItem): BackendPricePoint | null {
  const ordered = [it.prices.mid, it.prices.cheap, it.prices.expensive];
  const found = ordered.find((pricePoint) => hasListableProductPrice(pricePoint));
  return found ?? null;
}

function titleCase(s: string) {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function isRealProductUrl(url?: string): boolean {
  return Boolean(url && /^https?:\/\//i.test(url) && !url.includes("example.com"));
}

function isRealImageUrl(url?: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) {
    return false;
  }

  const normalized = url.toLowerCase();
  const blockedKeywords = ["logo", "icon", "sprite", "thumbnail", "thumb", "avatar", "placeholder"];
  return !blockedKeywords.some((keyword) => normalized.includes(keyword));
}

/** Includes price 0 for curated listings where the retailer does not expose a stable price. */
function hasListableProductPrice(price?: BackendPricePoint | null): price is BackendPricePoint {
  if (!price) {
    return false;
  }

  return (
    Number.isFinite(price.price) &&
    price.price >= 0 &&
    isRealProductUrl(price.productUrl) &&
    isRealImageUrl(price.imageUrl)
  );
}

function parseStoreFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Shop";
  }
}

/**
 * Map backend outfit items to UI cards.
 */
export function mapOutfitToSearchItems(outfit: BackendOutfitItem[]): SearchItem[] {
  return outfit
    .map((it, index): SearchItem | null => {
      const price = pickDisplayPrice(it);

      if (!hasListableProductPrice(price)) {
        return null;
      }

      const store = (price.retailer || "").trim() || parseStoreFromUrl(price.productUrl);

      const reasonLine = [it.style, it.color, it.material].filter(Boolean).join(" · ");

      return {
        id: `${it.item}-${index}`,
        title: titleCase(price.productName || it.item || "Item"),
        price: price.price,
        currency: price.currency || "USD",
        imageUrl: price.imageUrl!,
        productUrl: price.productUrl,
        store,
        score: 0.9,
        ...(reasonLine ? { reason: reasonLine } : {}),
      };
    })
    .filter((item): item is SearchItem => Boolean(item));
}

export type SearchOutfitOptions = {
  budgetTier?: "all" | "cheap" | "mid" | "expensive";
  includeHistory?: boolean;
};

/**
 * POST /api/outfits/search — requires Authorization: Bearer <access_token>
 */
export async function searchOutfit(
  prompt: string,
  options: SearchOutfitOptions = {}
): Promise<SearchResponse> {
  const token = getStoredToken();
  if (!token) {
    throw new Error("Not signed in");
  }

  const response = await fetchJsonOrThrow(apiUrl("/api/outfits/search"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      prompt,
      budgetTier: options.budgetTier ?? "all",
      includeHistory: options.includeHistory ?? true,
    }),
  });

  const data = (await parseJsonSafe(response)) as
    | GenerateOutfitResponse
    | { error?: { message?: string; code?: string } };

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredToken();
    }
    throw new Error(extractApiErrorMessage(data, response));
  }

  const outfitResponse = data as GenerateOutfitResponse;
  const outfit = outfitResponse.variants ?? outfitResponse.outfit ?? [];
  const items = mapOutfitToSearchItems(outfit);

  if (items.length === 0) {
    throw new Error(
      "No live products with complete price, image, and product link were found. Try a more specific prompt."
    );
  }

  return {
    items,
    summary: outfitResponse.summary,
    meta: {
      query: prompt,
      total: items.length,
    },
  };
}

/**
 * POST /api/outfits/lookalike
 * Optional auth: if user is signed in we send token, otherwise IP-based rate limit applies.
 */
export async function findCelebrityLookalike(
  imageDataUrl: string,
  gender: LookalikeGender
): Promise<CelebrityLookalikeResponse> {
  const token = getStoredToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchJsonOrThrow(apiUrl("/api/outfits/lookalike"), {
    method: "POST",
    headers,
    body: JSON.stringify({ imageDataUrl, gender }),
  });

  const data = (await parseJsonSafe(response)) as
    | CelebrityLookalikeResponse
    | { error?: { message?: string; code?: string } };

  if (!response.ok) {
    throw new Error(extractApiErrorMessage(data, response));
  }

  return data as CelebrityLookalikeResponse;
}

/**
 * POST /api/outfits/trend
 * Returns real observed product price points with source attribution.
 */
export async function getProductTrend(item: SearchItem): Promise<ProductTrendResponse> {
  const token = getStoredToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchJsonOrThrow(apiUrl("/api/outfits/trend"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      productUrl: item.productUrl,
      title: item.title,
      store: item.store,
      currentPrice: item.price,
      currency: item.currency,
    }),
  });

  const data = (await parseJsonSafe(response)) as
    | ProductTrendResponse
    | { error?: { message?: string; code?: string } };

  if (!response.ok) {
    throw new Error(extractApiErrorMessage(data, response));
  }

  return data as ProductTrendResponse;
}

/** @deprecated Use searchOutfit + mapOutfitToSearchItems — kept for older imports */
export async function searchProducts(payload: SearchRequest): Promise<SearchResponse> {
  return searchOutfit(
    [payload.query, payload.budget != null ? `Budget around ${payload.budget}` : ""]
      .filter(Boolean)
      .join(". "),
    { budgetTier: "all" }
  );
}
