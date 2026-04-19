import fs from "fs";
import path from "path";
import axios from "axios";
import { OutfitItem, PricePoint } from "../types";
import { geminiConfig, getOpenAIClient } from "../config/aiConfig";
import logger from "../utils/logger";

type CelebrityArticle = {
  name: string;
  style: string;
  color: string;
  material: string;
  productUrl: string;
  price: number;
  imageUrl: string;
};

type CelebrityProfile = {
  celebrity: string;
  aliases?: string[];
  article1: CelebrityArticle;
  article2: CelebrityArticle;
  article3: CelebrityArticle;
};

export type CelebrityStyleMatch = {
  celebrity: string;
  matchType: "exact" | "closest";
  outfitItems: OutfitItem[];
};

class CelebrityStyleService {
  private static dataDirectoryCache: string | null = null;

  private static resolveDataDirectory(): string | null {
    if (CelebrityStyleService.dataDirectoryCache) {
      return CelebrityStyleService.dataDirectoryCache;
    }

    const candidates = [
      path.resolve(process.cwd(), "src/data/hard"),
      path.resolve(process.cwd(), "backend/src/data/hard"),
      path.resolve(__dirname, "../data/hard"),
      path.resolve(__dirname, "../../src/data/hard"),
    ];

    const found = candidates.find((candidate) => fs.existsSync(candidate));
    CelebrityStyleService.dataDirectoryCache = found || null;

    if (!found) {
      logger.warn("Celebrity style data directory not found", { candidates });
    }

    return CelebrityStyleService.dataDirectoryCache;
  }

  private static isCompleteArticle(article: CelebrityArticle | undefined): article is CelebrityArticle {
    if (!article) {
      return false;
    }

    const hasHttpProductUrl = /^https?:\/\//i.test(article.productUrl || "");
    const hasHttpImageUrl = /^https?:\/\//i.test(article.imageUrl || "");

    return (
      typeof article.name === "string" &&
      typeof article.style === "string" &&
      typeof article.color === "string" &&
      typeof article.material === "string" &&
      Number.isFinite(article.price) &&
      article.price > 0 &&
      hasHttpProductUrl &&
      hasHttpImageUrl
    );
  }

  private static isValidProfile(input: unknown): input is CelebrityProfile {
    if (!input || typeof input !== "object") {
      return false;
    }

    const profile = input as Partial<CelebrityProfile>;
    return (
      typeof profile.celebrity === "string" &&
      CelebrityStyleService.isCompleteArticle(profile.article1) &&
      CelebrityStyleService.isCompleteArticle(profile.article2) &&
      CelebrityStyleService.isCompleteArticle(profile.article3)
    );
  }

  private static loadProfiles(): CelebrityProfile[] {
    const dataDirectory = CelebrityStyleService.resolveDataDirectory();
    if (!dataDirectory) {
      return [];
    }

    const files = fs
      .readdirSync(dataDirectory)
      .filter((name) => name.toLowerCase().endsWith(".json"));

    const profiles: CelebrityProfile[] = [];
    for (const fileName of files) {
      try {
        const filePath = path.join(dataDirectory, fileName);
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);

        if (!CelebrityStyleService.isValidProfile(parsed)) {
          logger.warn("Skipping invalid celebrity style profile", { fileName });
          continue;
        }

        profiles.push(parsed);
      } catch (error) {
        logger.warn("Failed to parse celebrity style profile", {
          fileName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Loaded celebrity style profiles", {
      profileCount: profiles.length,
      dataDirectory,
    });

    return profiles;
  }

  private static normalizeText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static aliasMatchesPrompt(prompt: string, alias: string): boolean {
    const normalizedPrompt = CelebrityStyleService.normalizeText(prompt);
    const normalizedAlias = CelebrityStyleService.normalizeText(alias);

    if (!normalizedPrompt || !normalizedAlias) {
      return false;
    }

    const pattern = new RegExp(
      `(^|\\b)${CelebrityStyleService.escapeRegex(normalizedAlias).replace(/\s+/g, "\\s+")}(\\b|$)`,
      "i"
    );

    return pattern.test(normalizedPrompt);
  }

  private static findExactCelebrity(prompt: string, profiles: CelebrityProfile[]): CelebrityProfile | null {
    for (const profile of profiles) {
      const aliases = [profile.celebrity, ...(profile.aliases || [])];
      if (aliases.some((alias) => CelebrityStyleService.aliasMatchesPrompt(prompt, alias))) {
        return profile;
      }
    }

    return null;
  }

  private static isLikelyCelebrityIntent(prompt: string): boolean {
    const normalized = CelebrityStyleService.normalizeText(prompt);

    const directCelebrityPhrases = [
      /\binspired by\b/i,
      /\bstyle of\b/i,
      /\bin the style of\b/i,
      /\bdress like\b/i,
      /\blooks? like\b/i,
      /\bsimilar to\b/i,
      /\bchannel\b/i,
      /\b[a-z]+(?:\s+[a-z]+){0,2}\'s\s+(style|look|outfit)\b/i,
    ];

    if (directCelebrityPhrases.some((pattern) => pattern.test(prompt))) {
      return true;
    }

    const stopWords = new Set([
      "black",
      "white",
      "casual",
      "formal",
      "smart",
      "minimalist",
      "wedding",
      "office",
      "date",
      "night",
      "street",
      "vintage",
      "summer",
      "winter",
      "spring",
      "fall",
      "outfit",
      "look",
      "style",
      "for",
      "with",
      "and",
      "tie",
      "men",
      "women",
      "male",
      "female",
      "the",
      "a",
      "an",
      "to",
    ]);

    const candidateMatch = normalized.match(/\b([a-z]+(?:\s+[a-z]+){0,2})\s+(style|outfit|look|vibe)\b/i);
    if (!candidateMatch) {
      return false;
    }

    const candidateTokens = candidateMatch[1]
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean);

    const uniquePersonLikeTokenCount = candidateTokens.filter((token) => !stopWords.has(token)).length;

    return uniquePersonLikeTokenCount >= 1;
  }

  private static buildClosestMatchPrompt(prompt: string, celebrityNames: string[]): string {
    return `You are mapping a user's fashion request to one celebrity in an approved list.\n\nApproved celebrities:\n${celebrityNames
      .map((name) => `- ${name}`)
      .join("\n")}\n\nRules:\n1. If the user clearly mentions or implies a person not in the list, choose the closest style match from the approved list.\n2. If no person is mentioned or implied, return NONE.\n3. Return JSON only with this exact schema:\n{"closestCelebrity":"<approved name or NONE>","confidence":0.0}\n\nUser request: "${prompt}"`;
  }

  private static parseClosestCelebrityResponse(
    rawText: string,
    allowedCelebrityNames: Set<string>
  ): string | null {
    const objectMatch = rawText.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }

    try {
      const parsed = JSON.parse(objectMatch[0]) as {
        closestCelebrity?: string;
        confidence?: number;
      };

      const candidate = (parsed.closestCelebrity || "").trim();
      if (!candidate || candidate.toUpperCase() === "NONE") {
        return null;
      }

      if (!allowedCelebrityNames.has(candidate)) {
        return null;
      }

      if (typeof parsed.confidence === "number" && parsed.confidence < 0.25) {
        return null;
      }

      return candidate;
    } catch {
      return null;
    }
  }

  private static async chooseClosestCelebrityWithGemini(
    prompt: string,
    celebrityNames: string[]
  ): Promise<string | null> {
    if (!process.env.GEMINI_API_KEY) {
      return null;
    }

    try {
      const response = await axios.post(
        `${geminiConfig.apiBaseUrl}/models/${geminiConfig.model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [
                {
                  text: CelebrityStyleService.buildClosestMatchPrompt(prompt, celebrityNames),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 180,
          },
        },
        { timeout: geminiConfig.timeout }
      );

      const rawText =
        response.data?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text || "")
          .join(" ") || "";

      return CelebrityStyleService.parseClosestCelebrityResponse(
        rawText,
        new Set(celebrityNames)
      );
    } catch (error) {
      logger.warn("Gemini celebrity closest-match failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private static async chooseClosestCelebrityWithOpenAI(
    prompt: string,
    celebrityNames: string[]
  ): Promise<string | null> {
    const openaiClient = getOpenAIClient();
    if (!openaiClient || !process.env.OPENAI_API_KEY) {
      return null;
    }

    try {
      const completion = await openaiClient.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You select the closest celebrity style match from an approved list and return strict JSON.",
          },
          {
            role: "user",
            content: CelebrityStyleService.buildClosestMatchPrompt(prompt, celebrityNames),
          },
        ],
        temperature: 0.1,
        max_tokens: 180,
      });

      const rawText = completion.choices[0]?.message?.content || "";

      return CelebrityStyleService.parseClosestCelebrityResponse(
        rawText,
        new Set(celebrityNames)
      );
    } catch (error) {
      logger.warn("OpenAI celebrity closest-match failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private static async findClosestCelebrity(
    prompt: string,
    profiles: CelebrityProfile[]
  ): Promise<CelebrityProfile | null> {
    const celebrityNames = profiles.map((profile) => profile.celebrity);

    const geminiChoice = await CelebrityStyleService.chooseClosestCelebrityWithGemini(
      prompt,
      celebrityNames
    );
    if (geminiChoice) {
      return profiles.find((profile) => profile.celebrity === geminiChoice) || null;
    }

    const openaiChoice = await CelebrityStyleService.chooseClosestCelebrityWithOpenAI(
      prompt,
      celebrityNames
    );
    if (openaiChoice) {
      return profiles.find((profile) => profile.celebrity === openaiChoice) || null;
    }

    return null;
  }

  private static toPricePoint(article: CelebrityArticle): PricePoint {
    let retailer = "shop";
    try {
      retailer = new URL(article.productUrl).hostname.replace(/^www\./, "");
    } catch {
      retailer = "shop";
    }

    return {
      productName: article.name,
      price: article.price,
      currency: "USD",
      retailer,
      productUrl: article.productUrl,
      imageUrl: article.imageUrl,
    };
  }

  private static toOutfitItems(profile: CelebrityProfile): OutfitItem[] {
    const articles = [profile.article1, profile.article2, profile.article3];

    return articles.map((article) => {
      const pricePoint = CelebrityStyleService.toPricePoint(article);

      return {
        item: article.name,
        style: article.style,
        color: article.color,
        material: article.material,
        images: [
          {
            url: article.imageUrl,
            source: "hardcoded-celebrity",
            alt: `${profile.celebrity} ${article.name}`,
          },
        ],
        prices: {
          cheap: pricePoint,
          mid: pricePoint,
          expensive: pricePoint,
        },
      };
    });
  }

  static async resolvePrompt(prompt: string): Promise<CelebrityStyleMatch | null> {
    const profiles = CelebrityStyleService.loadProfiles();
    if (profiles.length === 0) {
      return null;
    }

    const exact = CelebrityStyleService.findExactCelebrity(prompt, profiles);
    if (exact) {
      return {
        celebrity: exact.celebrity,
        matchType: "exact",
        outfitItems: CelebrityStyleService.toOutfitItems(exact),
      };
    }

    if (!CelebrityStyleService.isLikelyCelebrityIntent(prompt)) {
      return null;
    }

    const closest = await CelebrityStyleService.findClosestCelebrity(prompt, profiles);
    if (!closest) {
      return null;
    }

    return {
      celebrity: closest.celebrity,
      matchType: "closest",
      outfitItems: CelebrityStyleService.toOutfitItems(closest),
    };
  }
}

export default CelebrityStyleService;
