/**
 * TypeScript type definitions for the Perplexity API and this server's responses.
 */

/** A single chat message in the Perplexity (OpenAI-compatible) format. */
export interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Request body sent to the Perplexity chat completions endpoint. */
export interface PerplexityChatRequest {
  model: string;
  messages: PerplexityMessage[];
  max_tokens?: number;
  temperature?: number;
  search_mode?: "web" | "academic";
  search_recency_filter?: "month" | "week" | "day" | "hour";
  search_domain_filter?: string[];
  return_related_questions?: boolean;
}

/** A single search result / citation returned by Perplexity. */
export interface PerplexitySearchResult {
  title?: string;
  url?: string;
  date?: string;
  snippet?: string;
}

/** Token usage metadata returned by the API. */
export interface PerplexityUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Shape of a successful Perplexity chat completions response (fields we use). */
export interface PerplexityChatResponse {
  id?: string;
  model?: string;
  choices: Array<{
    index: number;
    finish_reason?: string;
    message: PerplexityMessage;
  }>;
  /** Legacy flat list of source URLs. */
  citations?: string[];
  /** Richer structured source list (newer responses). */
  search_results?: PerplexitySearchResult[];
  related_questions?: string[];
  usage?: PerplexityUsage;
}

/** Normalized answer this server hands back to the caller. */
export interface NormalizedAnswer {
  model: string;
  answer: string;
  citations: PerplexitySearchResult[];
  related_questions: string[];
  usage?: PerplexityUsage;
  /** True when the payload was trimmed to fit the response size budget. */
  truncated?: boolean;
  /** Human-readable explanation of what was trimmed, present only when truncated. */
  truncation_note?: string;
}
