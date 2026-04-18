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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function getHealth() {
  const response = await fetch(`${API_BASE_URL}/api/health`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Backend health check failed");
  }

  return response.json();
}

export async function searchProducts(payload: SearchRequest): Promise<SearchResponse> {
  const response = await fetch(`${API_BASE_URL}/api/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Search request failed");
  }

  return response.json();
}
