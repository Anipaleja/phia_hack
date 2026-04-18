const STYLE_GRAPH: Record<string, string[]> = {
  "jfk jr": ["old money", "preppy summer", "coastal grandfather", "ivy league"],
  "tech bro": ["minimalist", "quiet luxury", "founder fit", "normcore"],
  "clean girl": ["soft minimal", "Scandinavian", "Parisian", "capsule wardrobe"],
  "old money": ["preppy summer", "coastal grandfather", "quiet luxury", "country club"],
  streetwear: ["athleisure", "y2k", "skater", "techwear"],
  minimalist: ["quiet luxury", "capsule wardrobe", "Scandinavian", "modern classic"],
};

const CLUSTER_KEYWORDS: Array<{ key: string; tokens: string[] }> = [
  { key: "jfk jr", tokens: ["jfk", "preppy", "old money", "ivy"] },
  { key: "tech bro", tokens: ["tech", "founder", "startup", "silicon"] },
  { key: "clean girl", tokens: ["clean", "soft", "glow", "minimal"] },
  { key: "streetwear", tokens: ["street", "hype", "sneaker", "urban"] },
  { key: "minimalist", tokens: ["minimal", "simple", "neutral", "scandi"] },
];

class RecommendationService {
  private findClosestStyle(prompt: string): string {
    const normalizedPrompt = prompt.toLowerCase();

    for (const cluster of CLUSTER_KEYWORDS) {
      if (cluster.tokens.some((token) => normalizedPrompt.includes(token))) {
        return cluster.key;
      }
    }

    return "minimalist";
  }

  generateRecommendations(prompt: string): string[] {
    const styleKey = this.findClosestStyle(prompt);
    return STYLE_GRAPH[styleKey]?.slice(0, 5) || STYLE_GRAPH.minimalist.slice(0, 5);
  }
}

export default new RecommendationService();
