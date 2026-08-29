/**
 * Shared constants for the Perplexity MCP server.
 */

/** Base URL for the Perplexity API (OpenAI-compatible chat completions endpoint). */
export const PERPLEXITY_API_BASE_URL = "https://api.perplexity.ai";

/** Maximum size, in characters, of a tool's text response before truncation. */
export const CHARACTER_LIMIT = 50000;

/** Default request timeout in milliseconds. Deep research can be slow, so this is generous. */
export const REQUEST_TIMEOUT_MS = 120000;

/**
 * Perplexity Sonar models.
 *
 * See https://docs.perplexity.ai/getting-started/models for the current list.
 * Kept as a const map so tool schemas can expose a stable, documented set.
 */
export const SONAR_MODELS = {
  /** Fast, lightweight grounded search. Best default for quick factual lookups. */
  SONAR: "sonar",
  /** Higher-quality grounded search with more sources and longer answers. */
  SONAR_PRO: "sonar-pro",
  /** Chain-of-thought reasoning on top of grounded search. */
  SONAR_REASONING: "sonar-reasoning",
  /** Highest-quality reasoning with grounded search. */
  SONAR_REASONING_PRO: "sonar-reasoning-pro",
  /** Exhaustive, multi-step research across many sources. Slow but thorough. */
  SONAR_DEEP_RESEARCH: "sonar-deep-research",
} as const;

export type SonarModel = (typeof SONAR_MODELS)[keyof typeof SONAR_MODELS];
