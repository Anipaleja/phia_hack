import fs from "fs";
import path from "path";
import axios from "axios";
import { geminiConfig, getOpenAIClient } from "../config/aiConfig";
import { AppError } from "../utils/errorHandler";
import logger from "../utils/logger";

type ParsedImageData = {
  mimeType: string;
  base64Data: string;
  byteLength: number;
  dataUrl: string;
};

type ModelResult = {
  fullBodyVisible: boolean;
  closestCelebrity: string | null;
  confidence: number;
  topMatches: Array<{ celebrity: string; confidence: number }>;
  reason?: string;
};

export type LookalikeGender = "male" | "female";

export type CelebrityLookalikeResult = {
  closestCelebrity: string;
  confidence: number;
  topMatches: Array<{ celebrity: string; confidence: number }>;
  provider: "gemini" | "openai";
  note: string;
};

class CelebrityLookalikeService {
  private static readonly MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  private static readonly SUPPORTED_MIME_TYPES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ]);

  private static readonly MALE_CELEBRITIES = new Set([
    "asap rocky",
    "david beckham",
    "harry styles",
    "jacob elordi",
    "jfk jr",
    "kendrick lamar",
    "paul mescal",
    "pedro pascal",
    "timothee chalamet",
    "tyler the creator",
  ]);

  private static readonly FEMALE_CELEBRITIES = new Set([
    "alexa chung",
    "bella hadid",
    "carolyn bessette kennedy",
    "dua lipa",
    "hailey bieber",
    "kendall jenner",
    "rihanna",
    "sofia richie",
    "the row era mary kate olsen",
    "zendaya",
  ]);

  private static dataDirectoryCache: string | null = null;

  private static resolveDataDirectory(): string | null {
    if (CelebrityLookalikeService.dataDirectoryCache) {
      return CelebrityLookalikeService.dataDirectoryCache;
    }

    const candidates = [
      path.resolve(process.cwd(), "src/data/hard"),
      path.resolve(process.cwd(), "backend/src/data/hard"),
      path.resolve(__dirname, "../data/hard"),
      path.resolve(__dirname, "../../src/data/hard"),
    ];

    const found = candidates.find((candidate) => fs.existsSync(candidate));
    CelebrityLookalikeService.dataDirectoryCache = found || null;

    if (!found) {
      logger.warn("Celebrity lookalike data directory not found", { candidates });
    }

    return CelebrityLookalikeService.dataDirectoryCache;
  }

  private static normalizeCelebrityName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static titleCaseFromSlug(slug: string): string {
    return slug
      .split("_")
      .map((token) => {
        if (!token) {
          return token;
        }

        if (/^[a-z]{1,3}$/.test(token)) {
          return token.toUpperCase();
        }

        return `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`;
      })
      .join(" ")
      .trim();
  }

  private static getCelebrityGender(normalizedCelebrityName: string): LookalikeGender | null {
    if (CelebrityLookalikeService.MALE_CELEBRITIES.has(normalizedCelebrityName)) {
      return "male";
    }

    if (CelebrityLookalikeService.FEMALE_CELEBRITIES.has(normalizedCelebrityName)) {
      return "female";
    }

    return null;
  }

  private static loadCelebrityNames(gender: LookalikeGender): string[] {
    const dataDirectory = CelebrityLookalikeService.resolveDataDirectory();
    if (!dataDirectory) {
      return [];
    }

    const files = fs
      .readdirSync(dataDirectory)
      .filter((name) => name.toLowerCase().endsWith(".json"));

    const namesByNormalized = new Map<string, string>();

    for (const fileName of files) {
      const filePath = path.join(dataDirectory, fileName);
      const slugName = fileName.replace(/\.json$/i, "");
      let celebrityName = CelebrityLookalikeService.titleCaseFromSlug(slugName);

      try {
        const raw = fs.readFileSync(filePath, "utf8");

        // Use regex fallback so malformed JSON files can still provide a name.
        const fromRaw = raw.match(/"celebrity"\s*:\s*"([^"]+)"/i)?.[1]?.trim();
        if (fromRaw) {
          celebrityName = fromRaw;
        }
      } catch {
        // Ignore malformed files and keep slug-derived fallback name.
      }

      const normalized = CelebrityLookalikeService.normalizeCelebrityName(celebrityName);
      if (!normalized) {
        continue;
      }

      const celebrityGender = CelebrityLookalikeService.getCelebrityGender(normalized);
      if (celebrityGender !== gender) {
        continue;
      }

      namesByNormalized.set(normalized, celebrityName);
    }

    return [...namesByNormalized.values()].sort((a, b) => a.localeCompare(b));
  }

  private static clampConfidence(value: unknown): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return 0.5;
    }

    const normalized = value > 1 && value <= 100 ? value / 100 : value;
    if (normalized < 0) {
      return 0;
    }
    if (normalized > 1) {
      return 1;
    }
    return Math.round(normalized * 1000) / 1000;
  }

  private static parseDataUrl(imageDataUrl: string): ParsedImageData {
    const trimmed = imageDataUrl.trim();
    const match = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/i);

    if (!match) {
      throw new AppError(
        "Image must be a valid base64 data URL (jpeg, png, or webp)",
        "INVALID_IMAGE_FORMAT",
        400
      );
    }

    const mimeType = match[1].toLowerCase();
    const base64Data = match[2].replace(/\s+/g, "");

    if (!CelebrityLookalikeService.SUPPORTED_MIME_TYPES.has(mimeType)) {
      throw new AppError(
        "Only JPEG, PNG, and WEBP images are supported",
        "UNSUPPORTED_IMAGE_TYPE",
        415
      );
    }

    const paddingLength = base64Data.endsWith("==") ? 2 : base64Data.endsWith("=") ? 1 : 0;
    const byteLength = Math.floor((base64Data.length * 3) / 4) - paddingLength;

    if (byteLength <= 0) {
      throw new AppError("Image content is empty", "EMPTY_IMAGE", 400);
    }

    if (byteLength > CelebrityLookalikeService.MAX_IMAGE_BYTES) {
      throw new AppError(
        "Image must be 5MB or smaller",
        "IMAGE_TOO_LARGE",
        413,
        { maxBytes: CelebrityLookalikeService.MAX_IMAGE_BYTES }
      );
    }

    return {
      mimeType,
      base64Data,
      byteLength,
      dataUrl: `data:${mimeType};base64,${base64Data}`,
    };
  }

  private static buildPrompt(celebrityNames: string[], gender: LookalikeGender): string {
    return `You are matching a person's selfie to the closest celebrity from an approved list.

Selected gender: ${gender}

Approved celebrities:
${celebrityNames.map((name) => `- ${name}`).join("\n")}

Rules:
1. Pick ONLY from the approved list.
2. Return strict JSON only (no markdown).
3. Confidence must be 0.0 to 1.0.
4. Include exactly 3 entries in topMatches, sorted by confidence descending.
5. FULL-BODY CHECK FIRST: If the photo does not clearly show full body proportions (preferably head-to-toe, minimum shoulders to below knees), set fullBodyVisible=false and do NOT guess a match.
6. For matching, prioritize body type, proportions, height cues, shoulder/waist/hip relation, posture, and silhouette. Use face only as a minor tiebreaker.
7. This is for fun style resemblance only, not identity verification.

Return exactly:
{
  "fullBodyVisible": true,
  "closestCelebrity": "<approved name or NONE>",
  "confidence": 0.0,
  "topMatches": [
    { "celebrity": "<approved name>", "confidence": 0.0 },
    { "celebrity": "<approved name>", "confidence": 0.0 },
    { "celebrity": "<approved name>", "confidence": 0.0 }
  ],
  "reason": "<short reason or FULL_BODY_NOT_VISIBLE>"
}`;
  }

  private static parseModelResponse(rawText: string, celebrityNames: string[]): ModelResult | null {
    const objectMatch = rawText.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }

    let parsed: {
      fullBodyVisible?: unknown;
      closestCelebrity?: unknown;
      confidence?: unknown;
      topMatches?: Array<{ celebrity?: unknown; confidence?: unknown }>;
      reason?: unknown;
    };

    try {
      parsed = JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }

    const allowedByNormalized = new Map<string, string>();
    for (const name of celebrityNames) {
      allowedByNormalized.set(CelebrityLookalikeService.normalizeCelebrityName(name), name);
    }

    const normalizeToAllowed = (value: unknown): string | null => {
      if (typeof value !== "string") {
        return null;
      }

      const normalized = CelebrityLookalikeService.normalizeCelebrityName(value);
      if (!normalized) {
        return null;
      }

      return allowedByNormalized.get(normalized) || null;
    };

    const fullBodyVisible = parsed.fullBodyVisible === false ? false : true;

    if (!fullBodyVisible) {
      return {
        fullBodyVisible: false,
        closestCelebrity: null,
        confidence: 0,
        topMatches: [],
        reason:
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : "FULL_BODY_NOT_VISIBLE",
      };
    }

    const closestCelebrity = normalizeToAllowed(parsed.closestCelebrity);
    if (!closestCelebrity) {
      return null;
    }

    const topMatches: Array<{ celebrity: string; confidence: number }> = [];

    if (Array.isArray(parsed.topMatches)) {
      for (const match of parsed.topMatches) {
        const celebrity = normalizeToAllowed(match?.celebrity);
        if (!celebrity) {
          continue;
        }

        topMatches.push({
          celebrity,
          confidence: CelebrityLookalikeService.clampConfidence(match?.confidence),
        });
      }
    }

    const uniqueMatches = new Map<string, { celebrity: string; confidence: number }>();

    uniqueMatches.set(closestCelebrity, {
      celebrity: closestCelebrity,
      confidence: CelebrityLookalikeService.clampConfidence(parsed.confidence),
    });

    for (const match of topMatches) {
      if (!uniqueMatches.has(match.celebrity)) {
        uniqueMatches.set(match.celebrity, match);
      }
    }

    const normalizedTopMatches = [...uniqueMatches.values()]
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 3);

    return {
      fullBodyVisible: true,
      closestCelebrity,
      confidence: CelebrityLookalikeService.clampConfidence(parsed.confidence),
      topMatches: normalizedTopMatches,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : undefined,
    };
  }

  private static async chooseWithGemini(
    prompt: string,
    image: ParsedImageData,
    celebrityNames: string[]
  ): Promise<ModelResult | null> {
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
                { text: prompt },
                {
                  inline_data: {
                    mime_type: image.mimeType,
                    data: image.base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 260,
          },
        },
        { timeout: geminiConfig.timeout }
      );

      const rawText =
        response.data?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text || "")
          .join(" ") || "";

      return CelebrityLookalikeService.parseModelResponse(rawText, celebrityNames);
    } catch (error) {
      logger.warn("Gemini lookalike inference failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private static async chooseWithOpenAI(
    prompt: string,
    image: ParsedImageData,
    celebrityNames: string[]
  ): Promise<ModelResult | null> {
    const openaiClient = getOpenAIClient();
    if (!openaiClient || !process.env.OPENAI_API_KEY) {
      return null;
    }

    try {
      const response = await openaiClient.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 260,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: image.dataUrl },
              },
            ] as any,
          },
        ],
      });

      const rawText = response.choices[0]?.message?.content || "";
      return CelebrityLookalikeService.parseModelResponse(rawText, celebrityNames);
    } catch (error) {
      logger.warn("OpenAI lookalike inference failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  static async findClosestCelebrity(
    imageDataUrl: string,
    gender: LookalikeGender
  ): Promise<CelebrityLookalikeResult> {
    const image = CelebrityLookalikeService.parseDataUrl(imageDataUrl);
    const celebrityNames = CelebrityLookalikeService.loadCelebrityNames(gender);

    if (celebrityNames.length === 0) {
      throw new AppError(
        "No celebrity reference data available for selected gender",
        "NO_CELEBRITY_DATA",
        500
      );
    }

    const prompt = CelebrityLookalikeService.buildPrompt(celebrityNames, gender);

    logger.info("Starting celebrity lookalike inference", {
      gender,
      candidateCount: celebrityNames.length,
      imageBytes: image.byteLength,
    });

    const geminiResult = await CelebrityLookalikeService.chooseWithGemini(
      prompt,
      image,
      celebrityNames
    );

    if (geminiResult) {
      if (!geminiResult.fullBodyVisible) {
        throw new AppError(
          "Please upload a full-body photo (head-to-toe, or at least shoulders to below knees) so body type can be assessed.",
          "FULL_BODY_REQUIRED",
          422,
          { reason: geminiResult.reason || "FULL_BODY_NOT_VISIBLE" }
        );
      }

      if (!geminiResult.closestCelebrity) {
        throw new AppError(
          "Could not determine a reliable lookalike match from this image.",
          "LOOKALIKE_AMBIGUOUS",
          422
        );
      }

      const closestCelebrity = geminiResult.closestCelebrity;

      return {
        closestCelebrity,
        confidence: geminiResult.confidence,
        topMatches: geminiResult.topMatches,
        provider: "gemini",
        note: "For fun only: resemblance is based primarily on full-body proportions/silhouette and is not identity verification.",
      };
    }

    const openaiResult = await CelebrityLookalikeService.chooseWithOpenAI(
      prompt,
      image,
      celebrityNames
    );

    if (openaiResult) {
      if (!openaiResult.fullBodyVisible) {
        throw new AppError(
          "Please upload a full-body photo (head-to-toe, or at least shoulders to below knees) so body type can be assessed.",
          "FULL_BODY_REQUIRED",
          422,
          { reason: openaiResult.reason || "FULL_BODY_NOT_VISIBLE" }
        );
      }

      if (!openaiResult.closestCelebrity) {
        throw new AppError(
          "Could not determine a reliable lookalike match from this image.",
          "LOOKALIKE_AMBIGUOUS",
          422
        );
      }

      const closestCelebrity = openaiResult.closestCelebrity;

      return {
        closestCelebrity,
        confidence: openaiResult.confidence,
        topMatches: openaiResult.topMatches,
        provider: "openai",
        note: "For fun only: resemblance is based primarily on full-body proportions/silhouette and is not identity verification.",
      };
    }

    throw new AppError(
      "Lookalike matching is currently unavailable. Try again shortly.",
      "LOOKALIKE_UNAVAILABLE",
      503
    );
  }
}

export default CelebrityLookalikeService;
