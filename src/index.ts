#!/usr/bin/env node
/**
 * Perplexity MCP Server.
 *
 * Connects Perplexity's Sonar API to any MCP client (Claude Code, Claude
 * Desktop, etc.), giving the model live, citation-backed web search, grounded
 * conversation, reasoning, and deep research.
 *
 * Transport:
 *   - stdio (default): for local clients that launch the server as a subprocess.
 *   - http: streamable HTTP on PORT (default 3000) at /mcp, for remote use.
 *
 * Configuration (environment variables):
 *   - PERPLEXITY_API_KEY (required): your Perplexity API key.
 *   - TRANSPORT (optional): "stdio" (default) or "http".
 *   - PORT (optional): port for the HTTP transport (default 3000).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { registerTools } from "./tools/search.js";

const SERVER_NAME = "perplexity-mcp-server";
const SERVER_VERSION = "1.0.0";

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerTools(server);
  return server;
}

function assertApiKey(): void {
  if (!process.env.PERPLEXITY_API_KEY) {
    console.error(
      "ERROR: PERPLEXITY_API_KEY environment variable is required. " +
        "Get a key at https://www.perplexity.ai/settings/api",
    );
    process.exit(1);
  }
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

async function runHttp(): Promise<void> {
  // express is only needed for the optional HTTP transport; import lazily so
  // stdio users don't need it installed.
  const { default: express } = await import("express");
  const app = express();
  app.use(express.json());

  // Optional shared-secret auth. When MCP_AUTH_TOKEN is set, every /mcp request
  // must present `Authorization: Bearer <token>`. The /mcp endpoint dispatches
  // tools that spend the owner's Perplexity key, so it must not be reachable by
  // anyone who can hit the port.
  const authToken = process.env.MCP_AUTH_TOKEN;

  // Bind to loopback by default so the server is not exposed on the network
  // unless the operator deliberately opts in via HOST. Public exposure should
  // go through an authenticated reverse proxy and/or MCP_AUTH_TOKEN.
  const host = process.env.HOST || "127.0.0.1";
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
  });

  app.post("/mcp", async (req, res) => {
    if (authToken) {
      const header = req.header("authorization") || "";
      const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (presented !== authToken) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized: missing or invalid bearer token" },
          id: null,
        });
        return;
      }
    }

    // Fresh server + transport per request keeps the HTTP transport stateless.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, host, () => {
    console.error(
      `${SERVER_NAME} v${SERVER_VERSION} running on http://${host}:${port}/mcp`,
    );
    if (!authToken) {
      if (isLoopback) {
        console.error(
          "Note: no MCP_AUTH_TOKEN set — /mcp is unauthenticated but bound to loopback only.",
        );
      } else {
        console.error(
          `WARNING: bound to ${host} (non-loopback) with no MCP_AUTH_TOKEN. The /mcp ` +
            "endpoint spends your Perplexity API key and is reachable by anyone who can " +
            "reach this port. Set MCP_AUTH_TOKEN and/or front it with an authenticated proxy.",
        );
      }
    }
  });
}

async function main(): Promise<void> {
  assertApiKey();
  const transport = (process.env.TRANSPORT || "stdio").toLowerCase();
  if (transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
