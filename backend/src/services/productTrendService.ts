import fs from "fs";
import path from "path";
import logger from "../utils/logger";

export type ProductTrendSource = "closer_listing" | "python_scraper" | "productscrapes";

export type ProductTrendObservation = {
  timestamp: string;
  price: number;
  currency: string;
  retailer: string;
  source: ProductTrendSource;
  productUrl: string;
};

type ProductTrendStore = {
  version: 1;
  products: Record<string, ProductTrendObservation[]>;
};

const TREND_STORE_PATH = path.resolve(__dirname, "../../data/runtime/product-trends.json");
const MAX_OBSERVATIONS_PER_PRODUCT = 120;
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;

function parseTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCanonicalProductUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    parsed.hash = "";

    const removableParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "msclkid",
    ];

    for (const key of removableParams) {
      parsed.searchParams.delete(key);
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeObservation(
  productUrl: string,
  observation: ProductTrendObservation
): ProductTrendObservation | null {
  const canonicalUrl = toCanonicalProductUrl(productUrl);
  if (!canonicalUrl) {
    return null;
  }

  if (!Number.isFinite(observation.price) || observation.price <= 0) {
    return null;
  }

  const timestampMs = parseTimestampMs(observation.timestamp);
  const normalizedTimestamp = timestampMs > 0 ? new Date(timestampMs).toISOString() : new Date().toISOString();

  return {
    timestamp: normalizedTimestamp,
    price: Math.round(observation.price * 100) / 100,
    currency: observation.currency || "USD",
    retailer: (observation.retailer || "shop").trim() || "shop",
    source: observation.source,
    productUrl: canonicalUrl,
  };
}

function createEmptyStore(): ProductTrendStore {
  return {
    version: 1,
    products: {},
  };
}

function readStore(): ProductTrendStore {
  if (!fs.existsSync(TREND_STORE_PATH)) {
    return createEmptyStore();
  }

  try {
    const raw = fs.readFileSync(TREND_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProductTrendStore>;

    if (!parsed || typeof parsed !== "object") {
      return createEmptyStore();
    }

    return {
      version: 1,
      products: parsed.products && typeof parsed.products === "object" ? parsed.products : {},
    };
  } catch (error) {
    logger.warn("Failed to read trend store, using empty store", {
      error: error instanceof Error ? error.message : String(error),
    });
    return createEmptyStore();
  }
}

function writeStore(store: ProductTrendStore): void {
  try {
    fs.mkdirSync(path.dirname(TREND_STORE_PATH), { recursive: true });
    fs.writeFileSync(TREND_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    logger.warn("Failed to persist trend store", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sortObservations(observations: ProductTrendObservation[]): ProductTrendObservation[] {
  return [...observations].sort((a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp));
}

export class ProductTrendService {
  static normalizeProductUrl(rawUrl: string): string | null {
    return toCanonicalProductUrl(rawUrl);
  }

  static listObservations(productUrl: string): ProductTrendObservation[] {
    const canonicalUrl = toCanonicalProductUrl(productUrl);
    if (!canonicalUrl) {
      return [];
    }

    const store = readStore();
    const existing = store.products[canonicalUrl] || [];
    const normalized = existing
      .map((entry) => normalizeObservation(canonicalUrl, entry))
      .filter((entry): entry is ProductTrendObservation => entry !== null);

    return sortObservations(normalized);
  }

  static appendObservation(productUrl: string, observation: ProductTrendObservation): ProductTrendObservation[] {
    const canonicalUrl = toCanonicalProductUrl(productUrl);
    if (!canonicalUrl) {
      return [];
    }

    const normalized = normalizeObservation(canonicalUrl, observation);
    if (!normalized) {
      return ProductTrendService.listObservations(canonicalUrl);
    }

    const store = readStore();
    const current = sortObservations(
      (store.products[canonicalUrl] || [])
        .map((entry) => normalizeObservation(canonicalUrl, entry))
        .filter((entry): entry is ProductTrendObservation => entry !== null)
    );
    const normalizedTimestampMs = parseTimestampMs(normalized.timestamp);

    const isDuplicate = current.some((existing) => {
      const existingTimestampMs = parseTimestampMs(existing.timestamp);
      const sameSource = existing.source === normalized.source;
      const samePrice = Math.abs(existing.price - normalized.price) < 0.01;
      const withinWindow = Math.abs(existingTimestampMs - normalizedTimestampMs) <= DUPLICATE_WINDOW_MS;

      return sameSource && samePrice && withinWindow;
    });

    if (!isDuplicate) {
      current.push(normalized);
    }

    const deduped = sortObservations(current).slice(-MAX_OBSERVATIONS_PER_PRODUCT);
    store.products[canonicalUrl] = deduped;
    writeStore(store);

    return deduped;
  }
}

export default ProductTrendService;
