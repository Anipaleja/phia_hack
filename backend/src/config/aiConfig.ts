import { OpenAI } from "openai";
import logger from "../utils/logger";

// Initialize OpenAI client - optional if API key not provided
let openaiClient: OpenAI | null = null;
if (process.env.OPENAI_API_KEY) {
  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
} else {
  logger.warn("OpenAI API key not configured. Will fallback to Ollama for AI features.");
}

export { openaiClient };

export const ollamaConfig = {
  baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  model: process.env.OLLAMA_MODEL || "mistral",
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

export const verifyOllamaConnection = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${ollamaConfig.baseUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      logger.info("Ollama connection verified");
      return true;
    }
  } catch (error) {
    logger.warn("Ollama connection unavailable - will fallback to OpenAI", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return false;
};
