"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  getProductTrend,
  type ProductTrendResponse,
  type SearchItem,
} from "@/lib/api";

function toPathPoints(values: number[], width: number, height: number, padding: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (value - min) / range) * (height - padding * 2);
    return { x, y };
  });
}

function toMovingAverage(values: number[], windowSize: number): number[] {
  if (values.length === 0) {
    return [];
  }

  const size = Math.max(1, windowSize);
  return values.map((_, index) => {
    const from = Math.max(0, index - size + 1);
    const window = values.slice(from, index + 1);
    const mean = window.reduce((total, value) => total + value, 0) / window.length;
    return Math.round(mean * 100) / 100;
  });
}

function formatMoney(value: number, currency: string): string {
  return `${currency} ${Math.round(value * 100) / 100}`;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatObservationLabel(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return "Obs";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(parsed));
}

function formatRetailerLabel(value: string): string {
  return value.replace(/^www\./, "").split(".")[0] || "shop";
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

function TrendChart({
  title,
  subtitle,
  values,
  labels,
  color,
  delay,
  id,
  windowLabel,
}: {
  title: string;
  subtitle: string;
  values: number[];
  labels: string[];
  color: string;
  delay: number;
  id: string;
  windowLabel: string;
}) {
  if (values.length === 0) {
    return (
      <div className="border border-[rgba(37,35,33,0.14)] bg-[#f7f4ee] p-3.5 sm:p-4">
        <p className="text-[0.82rem] text-stone-500">No observed points yet for this chart.</p>
      </div>
    );
  }

  const width = 620;
  const height = 220;
  const padding = 20;
  const points = toPathPoints(values, width, height, padding);

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const first = points[0];
  const last = points[points.length - 1];

  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${first.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;

  const gradientId = `${id}-fill`;
  const lineStyle = {
    "--trend-length": "1200",
    "--trend-duration": "1.35s",
    "--trend-delay": `${delay}s`,
  } as CSSProperties;

  const dotStyle = {
    "--trend-delay": `${Math.max(0, delay + 0.75)}s`,
  } as CSSProperties;

  return (
    <div className="border border-[rgba(37,35,33,0.14)] bg-[#f7f4ee] p-3.5 sm:p-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-stone-500">{title}</p>
          <p className="text-[0.8rem] text-stone-500">{subtitle}</p>
        </div>
        <p className="text-[0.78rem] text-stone-500">{windowLabel}</p>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-[10.5rem] w-full overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
          const y = padding + ratio * (height - padding * 2);
          return (
            <line
              key={ratio}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="rgba(37,35,33,0.1)"
              strokeWidth="1"
              strokeDasharray="4 7"
              className="trend-grid-fade"
            />
          );
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} className="trend-grid-fade" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="3" className="trend-line-draw" style={lineStyle} />
        <circle
          cx={last.x}
          cy={last.y}
          r="4.5"
          fill={color}
          stroke="#fdfaf5"
          strokeWidth="1.5"
          className="trend-dot-pop"
          style={dotStyle}
        />
      </svg>

      <div className="mt-2 flex items-center justify-between text-[0.74rem] text-stone-500">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

export function ProductTrendButton({
  item,
  buttonClassName,
}: {
  item: SearchItem;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [trendData, setTrendData] = useState<ProductTrendResponse | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  useEffect(() => {
    if (!open || !isMounted) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isMounted]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setTrendLoading(true);
    setTrendError(null);

    getProductTrend(item)
      .then((response) => {
        if (!cancelled) {
          setTrendData(response);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTrendError(error instanceof Error ? error.message : "Failed to load trend data");
          setTrendData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTrendLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, item.id, item.productUrl, item.price, item.currency, item.store, item.title]);

  const trend = useMemo(() => {
    const observations = [...(trendData?.observations || [])].sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    );
    const marketScan = trendData?.marketScan || [];

    const historyPrices = observations.map((point) => point.price);
    const historyLabels = observations.map((point) => formatObservationLabel(point.timestamp));

    const marketPrices = marketScan.map((point) => point.price);
    const marketLabels = marketScan.map((point) => formatRetailerLabel(point.retailer));

    const useMarketScanSeries =
      trendData?.seriesMode === "market_scan_fallback" && marketPrices.length >= 2;

    const prices = useMarketScanSeries ? marketPrices : historyPrices;
    const labels = useMarketScanSeries ? marketLabels : historyLabels;
    const smoothed = toMovingAverage(prices, 3);

    const firstPrice = prices[0] || 0;
    const lastPrice = prices[prices.length - 1] || 0;
    const priceChangePct =
      prices.length >= 2 && firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;

    const marketMedian = median(marketPrices);
    const marketRange =
      marketPrices.length >= 2 ? Math.max(...marketPrices) - Math.min(...marketPrices) : null;

    const mean = prices.reduce((acc, value) => acc + value, 0) / Math.max(1, prices.length);
    const variance =
      prices.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / Math.max(1, prices.length);
    const volatilityPct = prices.length >= 2 && mean > 0 ? (Math.sqrt(variance) / mean) * 100 : null;

    return {
      observations,
      prices,
      labels,
      smoothed,
      priceChangePct,
      volatilityPct,
      useMarketScanSeries,
      marketMedian,
      marketRange,
      marketScanCount: marketScan.length,
      latestObservation: observations[observations.length - 1] || null,
      firstObservation: observations[0] || null,
    };
  }, [trendData]);

  const sourceList = useMemo(() => {
    return (trendData?.sources || []).slice(0, 3);
  }, [trendData]);

  const toneClasses =
    buttonClassName ||
    "w-full border border-[rgba(37,35,33,0.22)] bg-[#ebe7df] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-stone-700 transition hover:border-[rgba(37,35,33,0.34)] hover:text-stone-900";

  const modal = open ? (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-stone-900/28 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
        aria-label="Close trend panel"
      />

      <section className="trend-panel-enter relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-y-auto border border-[rgba(37,35,33,0.2)] bg-[#f4f1ea] p-5 shadow-[0_26px_70px_rgba(17,15,12,0.25)] sm:max-h-[calc(100vh-3rem)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-stone-500">Product signals</p>
            <h3 className="mt-1 font-editorial text-[1.55rem] leading-[0.96] tracking-[-0.02em] text-stone-900 sm:text-[1.9rem]">
              {item.title}
            </h3>
            <p className="mt-2 text-[0.84rem] text-stone-500">{item.store}</p>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="shrink-0 border border-[rgba(37,35,33,0.2)] bg-[#ebe7df] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-stone-700 transition hover:border-[rgba(37,35,33,0.32)]"
          >
            Close
          </button>
        </div>

        {trendLoading ? (
          <div className="mt-6 border border-[rgba(37,35,33,0.14)] bg-[#f8f5ef] px-4 py-5 text-[0.84rem] text-stone-600">
            Pulling real listing observations and source data...
          </div>
        ) : trendError ? (
          <div className="mt-6 border border-[rgba(129,41,29,0.25)] bg-[#fbf0ed] px-4 py-5 text-[0.84rem] text-[#7f3528]">
            {trendError}
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
              <div className="border border-[rgba(37,35,33,0.14)] bg-[#f8f5ef] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">
                  {trend.useMarketScanSeries ? "Market median" : "Latest observed price"}
                </p>
                <p className="mt-1 font-editorial text-[1.42rem] leading-none text-stone-900">
                  {trend.useMarketScanSeries && trend.marketMedian != null
                    ? formatMoney(trend.marketMedian, item.currency)
                    : trend.latestObservation
                    ? formatMoney(trend.latestObservation.price, trend.latestObservation.currency)
                    : formatMoney(item.price, item.currency)}
                </p>
              </div>

              <div className="border border-[rgba(37,35,33,0.14)] bg-[#f8f5ef] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">
                  {trend.useMarketScanSeries ? "Market spread" : "Observed price move"}
                </p>
                <p className="mt-1 font-editorial text-[1.42rem] leading-none text-stone-900">
                  {trend.useMarketScanSeries && trend.marketRange != null ? (
                    formatMoney(trend.marketRange, item.currency)
                  ) : trend.priceChangePct == null ? (
                    "N/A"
                  ) : (
                    <>
                      {trend.priceChangePct >= 0 ? "+" : ""}
                      {trend.priceChangePct.toFixed(1)}%
                    </>
                  )}
                </p>
              </div>

              <div className="border border-[rgba(37,35,33,0.14)] bg-[#f8f5ef] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">
                  {trend.useMarketScanSeries ? "Comparable listings" : "Observation count"}
                </p>
                <p className="mt-1 font-editorial text-[1.42rem] leading-none text-stone-900">
                  {trend.useMarketScanSeries ? trend.marketScanCount : trend.observations.length}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <TrendChart
                title={trend.useMarketScanSeries ? "Live market spread" : "Price trend"}
                subtitle={
                  trend.useMarketScanSeries
                    ? "Comparable listing prices captured right now from live retailer pages"
                    : trend.priceChangePct == null
                    ? "Need 2+ captured points for directional movement"
                    : `${trend.priceChangePct >= 0 ? "Rising" : "Cooling"} from first to latest observation`
                }
                values={trend.prices}
                labels={trend.labels}
                color="#7b5d35"
                delay={0.05}
                id={`${safeId(item.id || item.title)}-price`}
                windowLabel={
                  trend.useMarketScanSeries
                    ? `${trend.marketScanCount} listings`
                    : `${trend.observations.length} real points`
                }
              />

              <TrendChart
                title={trend.useMarketScanSeries ? "Smoothed market curve" : "Smoothed trajectory"}
                subtitle={
                  trend.useMarketScanSeries
                    ? "3-point moving average over live comparable listing prices"
                    : "3-point moving average from captured listing prices"
                }
                values={trend.smoothed}
                labels={trend.labels}
                color="#346f80"
                delay={0.2}
                id={`${safeId(item.id || item.title)}-smoothed`}
                windowLabel="Real-data smoothing"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[0.78rem] text-stone-500">
              <p>
                Volatility index:{" "}
                {trend.volatilityPct == null ? "N/A" : `${trend.volatilityPct.toFixed(1)}%`}
              </p>
              {trend.useMarketScanSeries ? (
                <p>History currently flat, using live market scan fallback</p>
              ) : (
                <p>
                  First seen:{" "}
                  {trend.firstObservation ? formatObservationLabel(trend.firstObservation.timestamp) : "N/A"}
                </p>
              )}
            </div>

            <div className="mt-4 border border-[rgba(37,35,33,0.14)] bg-[#f8f5ef] p-3.5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">Data sources</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {sourceList.map((source) => (
                  <div key={source.key} className="border border-[rgba(37,35,33,0.14)] bg-[#f4f0e8] px-2.5 py-2">
                    <p className="text-[0.74rem] font-medium text-stone-800">{source.label}</p>
                    <p className="mt-1 text-[0.68rem] leading-[1.35] text-stone-500">{source.description}</p>
                    <p className="mt-1 text-[0.67rem] uppercase tracking-[0.12em] text-stone-600">
                      {source.used ? "Used in this trend" : "Available source"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-2 text-[0.74rem] leading-[1.45] text-stone-500">
              {trendData?.note || "Trend values are based on real captured listing prices only."}
            </p>
          </>
        )}
      </section>
    </div>
  ) : null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={toneClasses}>
        View trends
      </button>
      {isMounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
