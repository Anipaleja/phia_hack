/**
 * Closer frontend ↔ Phia backend integration.
 * Backend: Express on PORT (default 3001). See backend/api_test.md.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const SESSION_TOKEN_KEY = "closer_access_token";

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
  meta: {
    query: string;
    total: number;
  };
};

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
  outfit: BackendOutfitItem[];
  summary: {
    totalItems: number;
    averagePrice: unknown;
    prompt: string;
  };
  created_at: string;
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
  const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
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
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ?? data?.message ?? `Login failed (${response.status})`;
    throw new Error(message);
  }

  const token = data.token as string | undefined;
  if (!token) {
    throw new Error("No token in login response");
  }

  setStoredToken(token);
  return { token, refreshToken: data.refreshToken };
}

/**
 * POST /api/auth/signup — may require email confirmation before login works.
 */
export async function signup(
  email: string,
  password: string,
  fullName?: string
): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      fullName: fullName?.trim() || "",
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ?? data?.message ?? `Registration failed (${response.status})`;
    throw new Error(message);
  }

  return { message: (data.message as string) ?? "Account created" };
}

function pickDisplayPrice(it: BackendOutfitItem): BackendPricePoint | null {
  return it.prices.mid ?? it.prices.cheap ?? it.prices.expensive;
}

function titleCase(s: string) {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Map backend outfit items to UI cards.
 */
export function mapOutfitToSearchItems(outfit: BackendOutfitItem[]): SearchItem[] {
  return outfit.map((it, index) => {
    const price = pickDisplayPrice(it);
    const imageUrl = it.images?.[0]?.url ?? price?.imageUrl ?? "";
    return {
      id: `${it.item}-${index}`,
      title: titleCase(it.item || "Item"),
      price: price?.price ?? 0,
      currency: price?.currency ?? "USD",
      imageUrl,
      productUrl: price?.productUrl ?? "#",
      store: price?.retailer ?? "Shop",
      score: 0.9,
      reason: [it.style, it.color, it.material].filter(Boolean).join(" · "),
    };
  });
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

  const response = await fetch(`${API_BASE_URL}/api/outfits/search`, {
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

  const data = (await response.json().catch(() => ({}))) as
    | GenerateOutfitResponse
    | { error?: { message?: string; code?: string } };

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredToken();
    }
    const message =
      (data as { error?: { message?: string } }).error?.message ??
      `Outfit search failed (${response.status})`;
    throw new Error(message);
  }

  const outfit = (data as GenerateOutfitResponse).outfit ?? [];
  const items = mapOutfitToSearchItems(outfit);

  return {
    items,
    meta: {
      query: prompt,
      total: items.length,
    },
  };
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
