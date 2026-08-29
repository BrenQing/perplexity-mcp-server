# Perplexity MCP Server

Connect **Perplexity** to **Claude**. This is a [Model Context Protocol](https://modelcontextprotocol.io)
server that gives Claude (Claude Code, Claude Desktop, or any MCP client) live,
citation-backed web search and research powered by Perplexity's [Sonar](https://docs.perplexity.ai/getting-started/models) models.

Once connected, Claude can look things up on the open web, cite its sources, and
run deep research — without leaving your conversation.

## Tools

| Tool | Model | Use it for |
| --- | --- | --- |
| `perplexity_search` | `sonar` / `sonar-pro` | Fast, grounded answers to a single question, with citations. |
| `perplexity_ask` | `sonar` / `sonar-pro` | Multi-turn grounded conversation (pass a message history). |
| `perplexity_reason` | `sonar-reasoning-pro` | Complex questions needing analysis or step-by-step reasoning. |
| `perplexity_deep_research` | `sonar-deep-research` | Exhaustive, well-cited research reports (slow, thorough). |

Every tool supports:

- **`recency`** — restrict sources to the last `hour` / `day` / `week` / `month`.
- **`search_domain_filter`** — include or exclude domains (prefix with `-` to exclude).
- **`search_mode`** — `web` (default) or `academic`.
- **`response_format`** — `markdown` (human-readable) or `json` (structured: `answer`, `citations`, `related_questions`, `usage`).

## Prerequisites

- **Node.js 18 or newer** (`node --version`).
- **A Perplexity API key** — create one at <https://www.perplexity.ai/settings/api>.

## Install & build

```bash
npm install      # installs deps and builds (via the prepare script)
npm run build    # or build again manually
```

The compiled entry point is `dist/index.js`.

## Configuration

The server is configured entirely through environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PERPLEXITY_API_KEY` | ✅ | — | Your Perplexity API key. |
| `TRANSPORT` | | `stdio` | `stdio` for local clients, `http` for a remote server. |
| `PORT` | | `3000` | Port for the HTTP transport (only used when `TRANSPORT=http`). |

Copy `.env.example` to `.env` for local reference (the server reads real
environment variables — your MCP client is what sets them, see below).

## Connect it to Claude

### Claude Code (CLI)

From this project directory, register the server (adjust the path if you run it elsewhere):

```bash
claude mcp add perplexity \
  --env PERPLEXITY_API_KEY=pplx-your-key-here \
  -- node /absolute/path/to/expert-spork/dist/index.js
```

Then start Claude Code and ask it to search the web — it will call the Perplexity tools.
Check the connection with `/mcp` inside Claude Code.

### Claude Desktop

Edit your `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`;
Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and add:

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "node",
      "args": ["/absolute/path/to/expert-spork/dist/index.js"],
      "env": {
        "PERPLEXITY_API_KEY": "pplx-your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. The Perplexity tools appear under the tools (🔨) menu.

> A ready-to-copy version of this config is in [`examples/claude_desktop_config.json`](examples/claude_desktop_config.json).

## Launch

### Local (stdio) — recommended

You don't normally launch the server by hand: your MCP client (Claude Code /
Desktop) spawns it as a subprocess using the config above. To run it directly
for a smoke test:

```bash
PERPLEXITY_API_KEY=pplx-your-key-here node dist/index.js
# -> perplexity-mcp-server v1.0.0 running on stdio
```

During development you can auto-reload with:

```bash
PERPLEXITY_API_KEY=pplx-your-key-here npm run dev
```

### Remote (HTTP)

To serve over streamable HTTP (e.g. for a shared/remote deployment):

```bash
TRANSPORT=http PORT=3000 PERPLEXITY_API_KEY=pplx-your-key-here node dist/index.js
# -> perplexity-mcp-server v1.0.0 running on http://localhost:3000/mcp
```

- MCP endpoint: `POST http://localhost:3000/mcp`
- Health check: `GET http://localhost:3000/health`

## Verify

Inspect the server interactively with the MCP Inspector:

```bash
PERPLEXITY_API_KEY=pplx-your-key-here npm run inspect
```

Or do a quick scripted handshake to confirm the tools are exposed:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | PERPLEXITY_API_KEY=pplx-your-key-here node dist/index.js
```

You should see `perplexity_search`, `perplexity_ask`, `perplexity_reason`, and
`perplexity_deep_research` in the response.

## Troubleshooting

- **`Unauthorized (401)`** — `PERPLEXITY_API_KEY` is missing or wrong. Recreate it at <https://www.perplexity.ai/settings/api>.
- **`Rate limit exceeded (429)`** — you've hit your Perplexity usage tier; slow down or upgrade.
- **`Host not in allowlist: api.perplexity.ai`** — you're on a network (e.g. a sandboxed/egress-restricted environment) that blocks outbound traffic. Add `api.perplexity.ai` to the allowed egress hosts.
- **Deep research times out** — `perplexity_deep_research` can take minutes; the request timeout is 120s. Narrow the query or use `perplexity_search` for quick lookups.

## Project layout

```
src/
├── index.ts              # Entry point: transport selection + startup
├── constants.ts          # API base URL, model IDs, limits
├── types.ts              # Perplexity API + response types
├── schemas.ts            # Shared Zod input schemas
├── services/
│   └── perplexity.ts     # API client, error handling, response formatting
└── tools/
    └── search.ts         # The four tool registrations
```

## License

MIT
