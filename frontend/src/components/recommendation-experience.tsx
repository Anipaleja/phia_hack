"use client";

import type { ReactNode } from "react";
import { isHttpProductUrl, type SearchItem } from "@/lib/api";

export type ChatMessageLike = {
  role: "assistant" | "user";
  text: string;
  products?: SearchItem[];
  lockedPreview?: boolean;
};

export type ProductSection = {
  title: string;
  subtitle: string;
  products: SearchItem[];
};

export function splitProductsIntoSections(products: SearchItem[], headline: string): ProductSection[] {
  if (products.length === 0) return [];
  if (products.length <= 3) {
    return [
      {
        title: headline || "Curated for you",
        subtitle: "A focused selection aligned with your brief.",
        products,
      },
    ];
  }
  const mid = Math.ceil(products.length / 2);
  return [
    {
      title: "Foundation",
      subtitle: "Anchor pieces that define this direction.",
      products: products.slice(0, mid),
    },
    {
      title: "Finish & detail",
      subtitle: "Layering, texture, and polish.",
      products: products.slice(mid),
    },
  ];
}

function sectionHeadlineFromMessage(text: string): string {
  const t = text.trim();
  if (!t || t === "Preview") return "Curated for you";
  if (t.length < 72 && !t.includes("\n")) return t;
  return "Recommended pieces";
}

/** Shapes API-style messages into recommendation-first layout (explain → recommend). */
export function deriveRecommendationLayout(messages: ChatMessageLike[]): {
  primaryQuery: string;
  followUpQueries: string[];
  explanationBlocks: string[];
  sections: ProductSection[];
  lockedPreview: boolean;
  lockedProducts: SearchItem[] | null;
} {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.text.trim()).filter(Boolean);
  const primaryQuery = userTexts[0] ?? "";
  const followUpQueries = userTexts.slice(1);

  const explanationBlocks: string[] = [];
  const rawProductSections: { headline: string; products: SearchItem[] }[] = [];
  let lockedPreview = false;
  let lockedProducts: SearchItem[] | null = null;

  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (m.lockedPreview && m.products && m.products.length > 0) {
      lockedPreview = true;
      lockedProducts = m.products;
      continue;
    }
    if (m.products && m.products.length > 0) {
      rawProductSections.push({
        headline: sectionHeadlineFromMessage(m.text),
        products: m.products,
      });
      continue;
    }
    if (m.text?.trim()) {
      explanationBlocks.push(m.text.trim());
    }
  }

  const sections: ProductSection[] = [];
  for (const block of rawProductSections) {
    sections.push(...splitProductsIntoSections(block.products, block.headline));
  }

  return {
    primaryQuery,
    followUpQueries,
    explanationBlocks,
    sections,
    lockedPreview,
    lockedProducts,
  };
}

function IconHome({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6H10v6H5a1 1 0 01-1-1v-9.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SoftProductCard({ item }: { item: SearchItem }) {
  const canLink = isHttpProductUrl(item.productUrl);
  const shellClass =
    "block overflow-hidden border border-[rgba(37,35,33,0.12)] bg-[#f3f0ea] transition-[transform,border-color,background-color] duration-300 ease-out " +
    (canLink
      ? "hover:border-[rgba(37,35,33,0.24)] hover:bg-[#eeebe4] cursor-pointer"
      : "cursor-default");

  const inner = (
    <>
      <div
        className="aspect-[4/5] bg-[#ddd8d0] bg-cover bg-center transition-transform duration-500 ease-out group-hover:scale-[1.015]"
        style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
      />
      <div className="space-y-1.5 px-3.5 pb-4 pt-3.5">
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.22em] text-stone-500">{item.store}</p>
        <h3 className="font-editorial text-[1.02rem] leading-[1.12] tracking-[-0.02em] text-stone-900 line-clamp-3">
          {item.title}
        </h3>
        {item.slotLabel ? (
          <p className="text-[0.68rem] leading-snug text-stone-500 line-clamp-2">{item.slotLabel}</p>
        ) : null}
        <p className="text-[0.8rem] tabular-nums text-stone-800">
          {item.currency} {item.price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
        </p>
        {item.websiteHost ? (
          <p className="text-[0.68rem] leading-snug text-stone-500">{item.websiteHost}</p>
        ) : null}
        {canLink ? (
          <p className="text-[0.62rem] uppercase tracking-[0.18em] text-stone-400">Open listing</p>
        ) : null}
      </div>
    </>
  );

  return (
    <article className="group rec-card-enter w-[min(100%,15rem)] shrink-0 snap-start sm:w-[min(100%,16.5rem)]">
      {canLink ? (
        <a href={item.productUrl} target="_blank" rel="noreferrer" className={shellClass}>
          {inner}
        </a>
      ) : (
        <div className={shellClass}>{inner}</div>
      )}
    </article>
  );
}

function LockedRecommendationsGate({
  products,
  onOpenLogin,
}: {
  products: SearchItem[];
  onOpenLogin: () => void;
}) {
  const preview = products.slice(0, 6);
  return (
    <div
      className="relative overflow-hidden border border-[rgba(37,35,33,0.12)] bg-[#ece9e2]"
      role="status"
      aria-label="Your outfit recommendations are ready. Sign in to view details."
    >
      <div className="grid grid-cols-3 gap-px bg-[rgba(37,35,33,0.12)]">
        {preview.map((item) => (
          <div key={item.id} className="relative aspect-[4/5] overflow-hidden bg-[#ddd8d0]">
            <div
              className="h-full w-full scale-110 bg-cover bg-center blur-md"
              style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
              aria-hidden
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-900/20 to-transparent" />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-900/[0.08] p-4 backdrop-blur-[2px]">
        <div className="pointer-events-auto max-w-[min(100%,20rem)] border border-[rgba(37,35,33,0.15)] bg-[#f4f1ea]/95 px-6 py-5 text-left">
          <p className="font-editorial text-[1.08rem] leading-[1.04] tracking-[-0.02em] text-stone-900">
            Your picks are ready
          </p>
          <p className="mt-2 text-[0.88rem] leading-relaxed text-stone-500">
            Sign in to load live outfit results and reveal pieces tailored to you.
          </p>
          <button
            type="button"
            onClick={onOpenLogin}
            className="mt-5 w-full border border-stone-900 bg-[var(--accent)] py-2.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#faf9f6] transition hover:opacity-90"
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecommendationExperience({
  primaryQuery,
  followUpQueries,
  explanationBlocks,
  sections,
  lockedPreview,
  lockedProducts,
  loading,
  isSignedIn,
  onOpenLogin,
  onHome,
  composerSlot,
}: {
  primaryQuery: string;
  followUpQueries: string[];
  explanationBlocks: string[];
  sections: ProductSection[];
  lockedPreview: boolean;
  lockedProducts: SearchItem[] | null;
  loading: boolean;
  isSignedIn: boolean;
  onOpenLogin: () => void;
  onHome: () => void;
  composerSlot: ReactNode;
}) {
  const showLocked = lockedPreview && lockedProducts && lockedProducts.length > 0 && !isSignedIn;
  const displaySections =
    isSignedIn && lockedProducts && lockedProducts.length > 0 && !showLocked
      ? splitProductsIntoSections(lockedProducts, "Curated for you")
      : sections;

  return (
    <div className="rec-surface-root flex min-h-0 flex-1 gap-3 pt-1 sm:gap-5 sm:pt-0">
      {/* Architectural sidebar — minimal weight */}
      <aside className="flex w-10 shrink-0 flex-col items-center gap-6 border-r border-[rgba(37,35,33,0.1)] pr-2 sm:w-12 sm:pr-2.5">
        <button
          type="button"
          onClick={onHome}
          className="flex h-9 w-9 items-center justify-center text-stone-400 transition hover:text-[var(--accent)]"
          aria-label="Back to home"
        >
          <IconHome className="h-4.5 w-4.5" />
        </button>
        <div className="h-16 w-px bg-[rgba(37,35,33,0.16)]" aria-hidden />
      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-[rgba(37,35,33,0.12)] bg-[#f1eee8]">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-8 sm:px-10 sm:py-11 md:px-12 md:py-14">
          <div className="rec-surface-enter mr-auto ml-0 max-w-[48rem] text-left">
            {/* 1. Query — strongest anchor */}
            {primaryQuery ? (
              <h1 className="font-editorial text-[2.15rem] leading-[0.96] tracking-[-0.04em] text-[#151515] sm:text-[2.9rem] md:text-[3.45rem]">
                {primaryQuery}
              </h1>
            ) : null}

            {followUpQueries.length > 0 ? (
              <ul className="mt-7 space-y-3 border-l border-[rgba(37,35,33,0.16)] pl-4.5">
                {followUpQueries.map((q) => (
                  <li key={q} className="text-[0.9rem] leading-relaxed text-stone-500">
                    <span className="text-[0.62rem] font-medium uppercase tracking-[0.26em] text-stone-400">Refinement</span>
                    <span className="mt-1 block text-stone-600">{q}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* 2. Explanation before commerce */}
            {explanationBlocks.length > 0 ? (
              <div className="mt-12 space-y-6 sm:mt-14">
                {explanationBlocks.map((block, i) => (
                  <p
                    key={`${i}-${block.slice(0, 24)}`}
                    className="max-w-2xl text-[0.98rem] leading-[1.9] text-stone-600 sm:text-[1rem]"
                  >
                    {block}
                  </p>
                ))}
              </div>
            ) : null}

            {loading ? (
              <p
                className="rec-surface-enter mt-10 max-w-xl text-[0.98rem] leading-relaxed text-stone-500 sm:mt-12"
                role="status"
                aria-live="polite"
              >
                Finding pieces that match your direction…
              </p>
            ) : null}

            {/* 3. Sections: title → subtitle → row */}
            {!loading && showLocked && lockedProducts ? (
              <div className="mt-12 sm:mt-14">
                <LockedRecommendationsGate products={lockedProducts} onOpenLogin={onOpenLogin} />
              </div>
            ) : null}

            {!loading && !showLocked && displaySections.length > 0 ? (
              <div className="mt-12 space-y-14 sm:mt-16 sm:space-y-18">
                {displaySections.map((section, sIdx) => (
                  <section
                    key={`${section.title}-${sIdx}`}
                    className="rec-section-enter border-t border-[rgba(37,35,33,0.12)] pt-10 first:border-t-0 first:pt-0 sm:pt-12 first:sm:pt-0"
                    style={{ animationDelay: `${80 + sIdx * 90}ms` }}
                  >
                    <h2 className="text-[0.64rem] font-semibold uppercase tracking-[0.3em] text-stone-500">
                      {section.title}
                    </h2>
                    <p className="mt-2 max-w-xl text-[0.88rem] leading-relaxed text-stone-500">{section.subtitle}</p>
                    <div className="mt-9 flex gap-5 overflow-x-auto overflow-y-visible pb-2 pt-1 [scrollbar-width:thin] sm:gap-7 sm:pb-3">
                      {section.products.map((item) => (
                        <SoftProductCard key={item.id} item={item} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Bottom composer — continuity inside same surface */}
        <div className="shrink-0 border-t border-[rgba(37,35,33,0.12)] bg-[#ebe7df]/94 px-5 py-5 backdrop-blur-[6px] sm:px-8 sm:py-6">
          {composerSlot}
        </div>
      </div>
    </div>
  );
}
