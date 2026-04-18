// User types
export interface User {
  id: string;
  email: string;
  full_name?: string;
  style_preferences?: Record<string, any>;
  budget_range?: string;
  created_at: string;
  updated_at: string;
}

// AI generated style types
export interface StyleItem {
  item: string;
  style: string;
  color: string;
  material: string;
  description?: string;
}

// Image types
export interface Image {
  url: string;
  source: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface ImageResult {
  itemName: string;
  images: Image[];
  searchQuery: string;
}

// Price types
export interface PricePoint {
  productName: string;
  price: number;
  currency: string;
  retailer: string;
  productUrl: string;
  imageUrl?: string;
  rating?: number;
}

export interface PriceResult {
  item: string;
  searchQuery: string;
  pricePoints: PricePoint[];
  cheapest?: PricePoint;
  mostExpensive?: PricePoint;
}

// Outfit types
export interface OutfitItem {
  item: string;
  style: string;
  color: string;
  material: string;
  images: Image[];
  prices: {
    cheap: PricePoint | null;
    mid: PricePoint | null;
    expensive: PricePoint | null;
  };
}

export type OutfitVariant = OutfitItem;

export interface Outfit {
  id: string;
  user_id: string;
  prompt: string;
  outfit_items: OutfitItem[];
  ai_response: StyleItem[];
  created_at: string;
  is_saved: boolean;
}

// API Request/Response types
export interface GenerateStylesRequest {
  prompt: string;
  modelPreference?: "gemini" | "openai";
}

export interface GenerateStylesResponse {
  styles: StyleItem[];
  model_used: string;
  generated_at: string;
}

export interface GenerateOutfitRequest {
  prompt: string;
  budgetTier?: "all" | "cheap" | "mid" | "expensive";
  includeHistory?: boolean;
}

export interface GenerateOutfitResponse {
  prompt: string;
  summary: string;
  variants: OutfitVariant[];
  recommendations: {
    label: string;
    items: string[];
  };
  shareId?: string;
  cached: boolean;
  created_at?: string;
}

export type OutfitResponse = GenerateOutfitResponse;

// Search history
export interface SearchHistory {
  id: string;
  user_id: string;
  prompt: string;
  outfit_id?: string;
  created_at: string;
}

// AI Provider Response
export interface AIProviderResponse {
  styles: StyleItem[];
  provider: "openai" | "gemini";
  timestamp: string;
}

export type AnalyticsEvent = {
  prompt: string;
  timestamp: number;
  latencyMs: number;
  cacheHit: boolean;
};

export type AnalyticsSummary = {
  topPrompts: string[];
  topVibes: string[];
  cacheHitRate: number;
  avgLatencyMs: number;
  totalEvents: number;
};

export type SharedOutfit = {
  id: string;
  outfit: OutfitResponse;
  createdAt: number;
};

// Error types
export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, any>;
}
