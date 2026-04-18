import axios from "axios";
import { openaiClient, ollamaConfig, getStyleGenerationPrompt } from "../config/aiConfig";
import { StyleItem, AIProviderResponse } from "../types";
import { AppError } from "../utils/errorHandler";
import logger from "../utils/logger";

/**
 * AI Service: Generates fashion style recommendations
 * Uses Ollama for local inference, falls back to OpenAI for reliability
 */

export class AIService {
  /**
   * Generate styles using Ollama (local, free)
   * Returns parsed StyleItem array
   */
  private static async generateWithOllama(
    prompt: string
  ): Promise<StyleItem[]> {
    try {
      const response = await axios.post(
        `${ollamaConfig.baseUrl}/api/generate`,
        {
          model: ollamaConfig.model,
          prompt: getStyleGenerationPrompt(prompt),
          stream: false,
          temperature: 0.7,
        },
        { timeout: ollamaConfig.timeout }
      );

      const responseText = response.data.response || "";
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        throw new Error("No valid JSON found in Ollama response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error("Invalid response format from Ollama");
      }

      logger.info("Successfully generated styles with Ollama", {
        itemCount: parsed.length,
      });
      return parsed;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.warn("Ollama generation failed, falling back to OpenAI", {
        error: errorMsg,
      });
      throw error;
    }
  }

  /**
   * Generate styles using OpenAI (paid API, reliable fallback)
   * SECURITY: API key is server-side only, never exposed to client
   */
  private static async generateWithOpenAI(
    prompt: string
  ): Promise<StyleItem[]> {
    try {
      if (!openaiClient || !process.env.OPENAI_API_KEY) {
        throw new AppError(
          "OpenAI API key not configured",
          "OPENAI_NOT_CONFIGURED",
          500
        );
      }

      const message = await openaiClient.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "You are a fashion expert. Return ONLY valid JSON arrays with exact structure.",
          },
          {
            role: "user",
            content: getStyleGenerationPrompt(prompt),
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const responseText =
        message.choices[0]?.message?.content || "";
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        throw new Error("No valid JSON found in OpenAI response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error("Invalid response format from OpenAI");
      }

      logger.info("Successfully generated styles with OpenAI", {
        itemCount: parsed.length,
      });
      return parsed;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      logger.error("OpenAI generation failed", { error: errorMsg });
      throw new AppError(
        "Failed to generate styles",
        "STYLE_GENERATION_FAILED",
        500,
        { provider: "openai", originalError: errorMsg }
      );
    }
  }

  /**
   * Generate styles with automatic fallback
   * First tries Ollama (local, fast, free)
   * Falls back to OpenAI if Ollama unavailable
   */
  static async generateStyles(
    prompt: string,
    modelPreference?: "ollama" | "openai"
  ): Promise<AIProviderResponse> {
    // Validate prompt
    if (!prompt || prompt.trim().length === 0) {
      throw new AppError(
        "Prompt cannot be empty",
        "INVALID_PROMPT",
        400
      );
    }

    if (prompt.length > 500) {
      throw new AppError(
        "Prompt exceeds maximum length (500 characters)",
        "PROMPT_TOO_LONG",
        400
      );
    }

    let styles: StyleItem[];
    let provider: "ollama" | "openai" = "openai";

    try {
      // If user prefers Ollama, try it first
      if (modelPreference !== "openai") {
        styles = await AIService.generateWithOllama(prompt);
        provider = "ollama";
      } else {
        // Otherwise go straight to OpenAI
        styles = await AIService.generateWithOpenAI(prompt);
        provider = "openai";
      }
    } catch (error) {
      // Fallback to OpenAI if Ollama fails
      if (modelPreference !== "openai") {
        logger.info("Attempting fallback to OpenAI");
        styles = await AIService.generateWithOpenAI(prompt);
        provider = "openai";
      } else {
        throw error;
      }
    }

    return {
      styles,
      provider,
      timestamp: new Date().toISOString(),
    };
  }
}

export default AIService;
