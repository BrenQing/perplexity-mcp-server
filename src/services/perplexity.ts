/**
 * Perplexity API client and response helpers.
 *
 * Uses the global `fetch` (available in Node 18+) so the server has no runtime
 * HTTP dependency. All tools go through `callPerplexity` for consistent auth,
 * timeouts and error handling.
 */

import {
  CHARACTER_LIMIT,
  PERPLEXITY_API_BASE_URL,
  REQUEST_TIMEOUT_MS,
} from "../constants.js";
import type {
  NormalizedAnswer,
  PerplexityChatRequest,
  PerplexityChatResponse,
  PerplexitySearchResult,
} from "../types.js";

/** Raised when the Perplexity API returns a non-2xx response. */
export class PerplexityApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PerplexityApiError";
  }
}

/** Read the API key at call time so the process can start before it is checked. */
function getApiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) {
    throw new PerplexityApiError(
      "PERPLEXITY_API_KEY environment variable is not set. Obtain a key at " +
        "https://www.perplexity.ai/settings/api and provide it to the server.",
    );
  }
  return key;
}

/**
 * Call the Perplexity chat completions endpoint.
 *
 * Handles authentication, request timeouts and error normalization. Callers
 * receive a parsed {@link PerplexityChatResponse} or a thrown
 * {@link PerplexityApiError} with an actionable message.
 */
export async function callPerplexity(
  body: PerplexityChatRequest,
): Promise<PerplexityChatResponse> {
  const apiKey = getApiKey();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${PERPLEXITY_API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // `fetch` resolves once headers arrive, so the body reads below must stay
    // inside the timed region: a server that sends headers then stalls the body
    // would otherwise hang past the deadline. The timer is cleared only in the
    // finally, after the body has been fully read (or the attempt has thrown).
    if (!response.ok) {
      const detail = await safeReadError(response);
      throw new PerplexityApiError(
        mapStatusToMessage(response.status, detail),
        response.status,
      );
    }

    return (await response.json()) as PerplexityChatResponse;
  } catch (error) {
    // Preserve HTTP-status errors raised above rather than masking them.
    if (error instanceof PerplexityApiError) {
      throw error;
    }
    // An abort during either the header wait or a stalled body read surfaces as
    // AbortError; report both as a timeout.
    if (error instanceof Error && error.name === "AbortError") {
      throw new PerplexityApiError(
        `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s (including response body). ` +
          "Try a lighter model (e.g. 'sonar') or a narrower query.",
      );
    }
    throw new PerplexityApiError(
      `Network error contacting Perplexity: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Turn an HTTP status into an actionable error message. */
function mapStatusToMessage(status: number, detail: string): string {
  const suffix = detail ? ` Details: ${detail}` : "";
  switch (status) {
    case 400:
      return `Bad request (400): the model or parameters were rejected.${suffix}`;
    case 401:
      return `Unauthorized (401): PERPLEXITY_API_KEY is missing or invalid. Check the key at https://www.perplexity.ai/settings/api.${suffix}`;
    case 403:
      return `Forbidden (403): this key cannot access the requested model or feature.${suffix}`;
    case 429:
      return `Rate limit exceeded (429): slow down or check your Perplexity usage tier.${suffix}`;
    case 500:
    case 502:
    case 503:
      return `Perplexity service error (${status}): the API is temporarily unavailable. Retry shortly.${suffix}`;
    default:
      return `Perplexity API request failed with status ${status}.${suffix}`;
  }
}

/** Best-effort extraction of an error message from a failed response body. */
async function safeReadError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string } | string;
      };
      if (typeof parsed.error === "string") return parsed.error;
      if (parsed.error?.message) return parsed.error.message;
    } catch {
      // Not JSON; fall through to raw text.
    }
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * Normalize a raw Perplexity response into a stable shape, merging the legacy
 * `citations` string list and the newer `search_results` objects into one list.
 */
export function normalizeResponse(
  raw: PerplexityChatResponse,
): NormalizedAnswer {
  const answer = raw.choices?.[0]?.message?.content?.trim() ?? "";

  const citations: PerplexitySearchResult[] = [];
  const seen = new Set<string>();

  for (const result of raw.search_results ?? []) {
    const url = result.url ?? "";
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    citations.push(result);
  }

  for (const url of raw.citations ?? []) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({ url });
  }

  return {
    model: raw.model ?? "",
    answer,
    citations,
    related_questions: raw.related_questions ?? [],
    usage: raw.usage,
  };
}

/**
 * Render a {@link NormalizedAnswer} as Markdown suitable for showing an agent
 * or a human: the answer followed by a numbered source list.
 */
export function renderMarkdown(result: NormalizedAnswer): string {
  const lines: string[] = [result.answer || "_(No answer text returned.)_"];

  if (result.citations.length) {
    lines.push("", "## Sources");
    result.citations.forEach((source, index) => {
      const label = source.title?.trim() || source.url || `Source ${index + 1}`;
      const url = source.url ? ` — ${source.url}` : "";
      const date = source.date ? ` (${source.date})` : "";
      lines.push(`${index + 1}. ${label}${url}${date}`);
    });
  }

  if (result.related_questions.length) {
    lines.push("", "## Related questions");
    for (const question of result.related_questions) {
      lines.push(`- ${question}`);
    }
  }

  if (result.truncation_note) {
    lines.push("", `_${result.truncation_note}_`);
  }

  return lines.join("\n");
}

/**
 * Bound a {@link NormalizedAnswer} so its serialized form stays within `limit`
 * characters, trimming as data (not by slicing the rendered string) so both the
 * JSON and Markdown renderings remain valid. The answer text is capped first,
 * then citations are kept only while the whole payload fits; what was dropped is
 * recorded in `truncated` / `truncation_note`.
 */
export function boundAnswer(
  result: NormalizedAnswer,
  limit = CHARACTER_LIMIT,
): NormalizedAnswer {
  // Fast path: already within budget in both renderings.
  if (
    JSON.stringify(result, null, 2).length <= limit &&
    renderMarkdown(result).length <= limit
  ) {
    return result;
  }

  // Cap the answer to roughly half the budget; reserve the rest for sources,
  // related questions, structure and the truncation note.
  const answerBudget = Math.max(500, Math.floor(limit * 0.5));
  let answer = result.answer;
  if (answer.length > answerBudget) {
    answer =
      answer.slice(0, answerBudget).trimEnd() +
      "\n\n[… answer truncated to fit the response size limit …]";
  }

  // Keep citations from the front while the serialized payload stays under the
  // limit, leaving headroom for the truncation note added below.
  const noteReserve = 400;
  const keptCitations: PerplexitySearchResult[] = [];
  for (const citation of result.citations) {
    const candidate: NormalizedAnswer = {
      ...result,
      answer,
      citations: [...keptCitations, citation],
      truncated: true,
    };
    if (JSON.stringify(candidate, null, 2).length > limit - noteReserve) break;
    keptCitations.push(citation);
  }

  const droppedCitations = result.citations.length - keptCitations.length;
  const answerCapped = answer !== result.answer;
  const parts: string[] = [];
  if (answerCapped) parts.push("the answer was capped");
  if (droppedCitations > 0) {
    parts.push(
      `${droppedCitations} of ${result.citations.length} sources were dropped`,
    );
  }

  return {
    ...result,
    answer,
    citations: keptCitations,
    truncated: true,
    truncation_note:
      `Response exceeded the ${limit}-character budget: ${parts.join(" and ")}. ` +
      "Narrow the query or set max_tokens to get the full result.",
  };
}
