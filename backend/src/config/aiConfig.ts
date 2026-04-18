import { OpenAI } from "openai";
import logger from "../utils/logger";

let openaiClient: OpenAI | null = null;

export const getOpenAIClient = (): OpenAI | null => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return openaiClient;
};

export const geminiConfig = {
  apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  timeout: 30000,
};

export const getStyleGenerationPrompt = (userPrompt: string): string => {
  return `You are a fashion expert. Based on the following request, generate 5 specific clothing items and styles.
  
User request: "${userPrompt}"

Return ONLY a valid JSON array with this exact structure, no other text:
[
  {
    "item": "clothing piece name",
    "style": "style category",
    "color": "color or pattern",
    "material": "material type"
  }
]

Example:
[
  {
    "item": "blazer",
    "style": "preppy",
    "color": "navy blue",
    "material": "wool"
  },
  {
    "item": "dress shirt",
    "style": "classic",
    "color": "white",
    "material": "cotton"
  }
]

Now generate the outfit:`;
};

export const verifyGeminiConnection = async (): Promise<boolean> => {
  if (!process.env.GEMINI_API_KEY) {
    logger.warn("Gemini API key not configured. Will fallback to OpenAI for AI features.");
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `${geminiConfig.apiBaseUrl}/models/${geminiConfig.model}?key=${process.env.GEMINI_API_KEY}`,
      {
      signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (response.ok) {
      logger.info("Gemini connection verified");
      return true;
    }
  } catch (error) {
    logger.warn("Gemini connection unavailable - will fallback to OpenAI", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return false;
};
