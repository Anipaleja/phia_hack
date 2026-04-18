import { supabaseClient } from "../config/supabase";
import { AnalyticsEvent, AnalyticsSummary } from "../types";
import logger from "../utils/logger";

const MAX_EVENTS = 5000;

class AnalyticsService {
  private readonly events: AnalyticsEvent[] = [];
  private readonly promptCounts = new Map<string, number>();
  private readonly vibeCounts = new Map<string, number>();
  private cacheHits = 0;
  private totalLatencyMs = 0;

  private detectVibe(prompt: string): string {
    const normalized = prompt.toLowerCase();
    if (normalized.includes("jfk") || normalized.includes("preppy") || normalized.includes("old money")) {
      return "old money";
    }
    if (normalized.includes("tech") || normalized.includes("founder") || normalized.includes("startup")) {
      return "tech bro";
    }
    if (normalized.includes("clean girl") || normalized.includes("soft") || normalized.includes("scandinavian")) {
      return "clean girl";
    }
    if (normalized.includes("street") || normalized.includes("y2k") || normalized.includes("urban")) {
      return "streetwear";
    }
    return "minimalist";
  }

  logEvent(event: AnalyticsEvent): void {
    // Non-blocking logging to avoid adding latency to user response path.
    setImmediate(() => {
      this.events.push(event);
      this.promptCounts.set(
        event.prompt,
        (this.promptCounts.get(event.prompt) || 0) + 1
      );
      const vibe = this.detectVibe(event.prompt);
      this.vibeCounts.set(vibe, (this.vibeCounts.get(vibe) || 0) + 1);
      this.totalLatencyMs += event.latencyMs;
      if (event.cacheHit) {
        this.cacheHits += 1;
      }

      if (this.events.length > MAX_EVENTS) {
        const removed = this.events.shift();
        if (removed) {
          this.promptCounts.set(
            removed.prompt,
            Math.max((this.promptCounts.get(removed.prompt) || 1) - 1, 0)
          );
          if ((this.promptCounts.get(removed.prompt) || 0) === 0) {
            this.promptCounts.delete(removed.prompt);
          }
          const removedVibe = this.detectVibe(removed.prompt);
          this.vibeCounts.set(
            removedVibe,
            Math.max((this.vibeCounts.get(removedVibe) || 1) - 1, 0)
          );
          if ((this.vibeCounts.get(removedVibe) || 0) === 0) {
            this.vibeCounts.delete(removedVibe);
          }
          this.totalLatencyMs = Math.max(this.totalLatencyMs - removed.latencyMs, 0);
          if (removed.cacheHit) {
            this.cacheHits = Math.max(this.cacheHits - 1, 0);
          }
        }
      }

      this.persistEvent(event).catch((error) => {
        logger.debug("Analytics event persistence skipped", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  private async persistEvent(event: AnalyticsEvent): Promise<void> {
    if (process.env.ANALYTICS_SUPABASE_ENABLED !== "true") {
      return;
    }

    try {
      await supabaseClient.from("analytics_events").insert({
        prompt: event.prompt,
        timestamp_ms: event.timestamp,
        latency_ms: event.latencyMs,
        cache_hit: event.cacheHit,
      });
    } catch (error) {
      throw error;
    }
  }

  getTopPrompts(limit: number = 5): string[] {
    return [...this.promptCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([prompt]) => prompt);
  }

  getTopVibes(limit: number = 5): string[] {
    return [...this.vibeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([vibe]) => vibe);
  }

  getPromptCount(prompt: string): number {
    return this.promptCounts.get(prompt) || 0;
  }

  getCacheHitRate(): number {
    if (this.events.length === 0) {
      return 0;
    }
    return Number(((this.cacheHits / this.events.length) * 100).toFixed(2));
  }

  getAverageLatency(): number {
    if (this.events.length === 0) {
      return 0;
    }
    return Number((this.totalLatencyMs / this.events.length).toFixed(2));
  }

  getSummary(): AnalyticsSummary {
    return {
      topPrompts: this.getTopPrompts(5),
      topVibes: this.getTopVibes(5),
      cacheHitRate: this.getCacheHitRate(),
      avgLatencyMs: this.getAverageLatency(),
      totalEvents: this.events.length,
    };
  }
}

export default new AnalyticsService();
