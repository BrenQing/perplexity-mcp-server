/**
 * Shared Zod schemas and enums for tool inputs.
 */

import { z } from "zod";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** Search options common to every tool, expressed as reusable schema fields. */
export const commonSearchFields = {
  recency: z
    .enum(["hour", "day", "week", "month"])
    .optional()
    .describe(
      "Restrict sources to those published within this window. Omit for no time restriction.",
    ),
  search_domain_filter: z
    .array(z.string())
    .max(10)
    .optional()
    .describe(
      "Limit or exclude sources by domain, e.g. ['nature.com', 'arxiv.org']. " +
        "Prefix a domain with '-' to exclude it. Up to 10 entries.",
    ),
  search_mode: z
    .enum(["web", "academic"])
    .default("web")
    .describe(
      "Corpus to search: 'web' for the open internet, 'academic' to prioritize scholarly sources.",
    ),
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe(
      "Output format: 'markdown' for a human-readable answer with a source list, " +
        "or 'json' for structured data (answer, citations, related_questions, usage).",
    ),
};

/** A single conversational message accepted by perplexity_ask. */
export const MessageSchema = z
  .object({
    role: z
      .enum(["system", "user", "assistant"])
      .describe("Who authored this message."),
    content: z.string().min(1).describe("The message text."),
  })
  .strict();
