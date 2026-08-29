/**
 * Tool registrations for the Perplexity MCP server.
 *
 * Every tool funnels through {@link runQuery}, which builds the request, calls
 * the API, normalizes the response and formats the output. This keeps the four
 * tools thin and consistent.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CHARACTER_LIMIT, SONAR_MODELS } from "../constants.js";
import {
  PerplexityApiError,
  callPerplexity,
  normalizeResponse,
  renderMarkdown,
} from "../services/perplexity.js";
import { ResponseFormat, MessageSchema, commonSearchFields } from "../schemas.js";
import type {
  PerplexityChatRequest,
  PerplexityMessage,
} from "../types.js";

/** Options shared across the tool handlers, gathered from the common schema. */
interface SharedOptions {
  recency?: "hour" | "day" | "week" | "month";
  search_domain_filter?: string[];
  search_mode: "web" | "academic";
  response_format: ResponseFormat;
  return_related_questions?: boolean;
  max_tokens?: number;
}

/**
 * Core execution path for every tool: assemble the request, call Perplexity,
 * normalize and format. Returns an MCP tool result (text + structuredContent).
 */
async function runQuery(
  model: string,
  messages: PerplexityMessage[],
  options: SharedOptions,
) {
  const request: PerplexityChatRequest = {
    model,
    messages,
    search_mode: options.search_mode,
    ...(options.recency ? { search_recency_filter: options.recency } : {}),
    ...(options.search_domain_filter?.length
      ? { search_domain_filter: options.search_domain_filter }
      : {}),
    ...(options.return_related_questions
      ? { return_related_questions: true }
      : {}),
    ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
  };

  try {
    const raw = await callPerplexity(request);
    const normalized = normalizeResponse(raw);

    let text =
      options.response_format === ResponseFormat.JSON
        ? JSON.stringify(normalized, null, 2)
        : renderMarkdown(normalized);

    if (text.length > CHARACTER_LIMIT) {
      text =
        text.slice(0, CHARACTER_LIMIT) +
        `\n\n_[Response truncated at ${CHARACTER_LIMIT} characters. ` +
        "Ask a more specific question or set max_tokens to reduce length.]_";
    }

    return {
      content: [{ type: "text" as const, text }],
      structuredContent: normalized as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const message =
      error instanceof PerplexityApiError
        ? `Error: ${error.message}`
        : `Error: Unexpected failure: ${
            error instanceof Error ? error.message : String(error)
          }`;
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** Register all Perplexity tools on the given server. */
export function registerTools(server: McpServer): void {
  // --- perplexity_search: fast grounded answer -----------------------------
  const SearchInputSchema = z
    .object({
      query: z
        .string()
        .min(1, "query must not be empty")
        .max(4000, "query must not exceed 4000 characters")
        .describe("The question or search query to answer with live web sources."),
      pro: z
        .boolean()
        .default(false)
        .describe(
          "Use the higher-quality 'sonar-pro' model (more sources, longer answers) instead of 'sonar'.",
        ),
      ...commonSearchFields,
      return_related_questions: z
        .boolean()
        .default(false)
        .describe("Also return a list of related follow-up questions."),
    })
    .strict();

  server.registerTool(
    "perplexity_search",
    {
      title: "Perplexity Search",
      description: `Answer a question using Perplexity's Sonar models with live web search and citations.

Use this for current events, facts that may have changed since training, product/pricing lookups, or anything needing up-to-date sources. Every answer comes with a list of source URLs.

Args:
  - query (string): The question to answer.
  - pro (boolean): Use 'sonar-pro' for deeper answers (default: false, uses 'sonar').
  - recency ('hour'|'day'|'week'|'month', optional): Only use sources from this window.
  - search_domain_filter (string[], optional): Restrict to / exclude domains (prefix '-' to exclude).
  - search_mode ('web'|'academic'): Source corpus (default: 'web').
  - return_related_questions (boolean): Include follow-up questions (default: false).
  - response_format ('markdown'|'json'): Output format (default: 'markdown').

Returns:
  Markdown: the answer followed by a numbered "Sources" list.
  JSON: { model, answer, citations: [{title?, url?, date?, snippet?}], related_questions, usage }

Examples:
  - "What is the latest stable version of Node.js?" -> query with that text.
  - "Recent papers on retrieval-augmented generation" -> search_mode='academic', recency='month'.

Errors:
  - "Error: Unauthorized (401)..." if PERPLEXITY_API_KEY is missing/invalid.
  - "Error: Rate limit exceeded (429)..." if you exceed your usage tier.`,
      inputSchema: SearchInputSchema.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      const model = params.pro ? SONAR_MODELS.SONAR_PRO : SONAR_MODELS.SONAR;
      return runQuery(model, [{ role: "user", content: params.query }], params);
    },
  );

  // --- perplexity_ask: multi-turn conversation -----------------------------
  const AskInputSchema = z
    .object({
      messages: z
        .array(MessageSchema)
        .min(1, "provide at least one message")
        .describe(
          "Conversation history in chronological order. Include prior turns for follow-up questions.",
        ),
      pro: z
        .boolean()
        .default(false)
        .describe("Use 'sonar-pro' instead of 'sonar' for higher quality."),
      ...commonSearchFields,
      return_related_questions: z
        .boolean()
        .default(false)
        .describe("Also return a list of related follow-up questions."),
    })
    .strict();

  server.registerTool(
    "perplexity_ask",
    {
      title: "Perplexity Ask (conversation)",
      description: `Hold a grounded, multi-turn conversation with Perplexity, preserving context across turns.

Like perplexity_search, but accepts a full message history so you can ask follow-up questions that build on earlier answers. Answers remain citation-backed.

Args:
  - messages (array): Chronological list of { role: 'system'|'user'|'assistant', content: string }.
  - pro (boolean): Use 'sonar-pro' (default: false).
  - recency, search_domain_filter, search_mode, return_related_questions, response_format: as in perplexity_search.

Returns: Same shape as perplexity_search.

Example:
  messages=[
    {"role":"user","content":"Who won the 2022 F1 championship?"},
    {"role":"assistant","content":"Max Verstappen."},
    {"role":"user","content":"How many races did he win that season?"}
  ]`,
      inputSchema: AskInputSchema.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      const model = params.pro ? SONAR_MODELS.SONAR_PRO : SONAR_MODELS.SONAR;
      return runQuery(model, params.messages, params);
    },
  );

  // --- perplexity_reason: reasoning model -----------------------------------
  const ReasonInputSchema = z
    .object({
      query: z
        .string()
        .min(1, "query must not be empty")
        .max(4000, "query must not exceed 4000 characters")
        .describe("A question requiring analysis, comparison, or step-by-step reasoning."),
      ...commonSearchFields,
    })
    .strict();

  server.registerTool(
    "perplexity_reason",
    {
      title: "Perplexity Reason",
      description: `Answer a complex question using Perplexity's reasoning model ('sonar-reasoning-pro') with live search.

Use this when the task needs multi-step thinking, trade-off analysis, or synthesis across sources — not just a quick fact. Slower than perplexity_search but more capable.

Args:
  - query (string): The question to reason about.
  - recency, search_domain_filter, search_mode, response_format: as in perplexity_search.

Returns: Same shape as perplexity_search. Note the answer may include the model's reasoning.

Example:
  "Compare the trade-offs of REST vs gRPC for a high-throughput internal microservice."`,
      inputSchema: ReasonInputSchema.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      return runQuery(
        SONAR_MODELS.SONAR_REASONING_PRO,
        [{ role: "user", content: params.query }],
        params,
      );
    },
  );

  // --- perplexity_deep_research: exhaustive research ------------------------
  const DeepResearchInputSchema = z
    .object({
      query: z
        .string()
        .min(1, "query must not be empty")
        .max(4000, "query must not exceed 4000 characters")
        .describe("A research topic to investigate exhaustively across many sources."),
      max_tokens: z
        .number()
        .int()
        .min(256)
        .max(8000)
        .optional()
        .describe("Cap the length of the generated report. Omit for the model default."),
      ...commonSearchFields,
    })
    .strict();

  server.registerTool(
    "perplexity_deep_research",
    {
      title: "Perplexity Deep Research",
      description: `Produce an exhaustive, well-cited research report using Perplexity's 'sonar-deep-research' model.

This model runs many searches and reads many sources to build a thorough report. It is significantly slower and more expensive than the other tools — use it for genuine research tasks, not quick lookups (use perplexity_search for those).

Args:
  - query (string): The research topic or question.
  - max_tokens (number, optional): Limit report length (256-8000).
  - recency, search_domain_filter, search_mode, response_format: as in perplexity_search.

Returns: Same shape as perplexity_search, typically with a long answer and many citations.

Note: This call can take 30 seconds to a few minutes to complete.

Example:
  "State of the art in solid-state battery commercialization as of this year, with key players and remaining technical barriers."`,
      inputSchema: DeepResearchInputSchema.shape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (params) => {
      return runQuery(
        SONAR_MODELS.SONAR_DEEP_RESEARCH,
        [{ role: "user", content: params.query }],
        params,
      );
    },
  );
}
