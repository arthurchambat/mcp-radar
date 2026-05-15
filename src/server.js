#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  compareMcps,
  discoverFromGitHubTopics,
  enrichIndexWithGitHub,
  generateWeeklyDigest,
  getDiscoverySources,
  getMcpDetails,
  latestMcps,
  listCategories,
  loadIndex,
  recommendForTask,
  searchMcps,
  syncOfficialRegistry
} from "./registry.js";

const server = new McpServer({ name: "mcp-radar", version: "0.1.0" });

server.tool("sync_mcp_registry", "Refresh the local MCP index from the official MCP Registry.", { limit: z.number().int().min(1).max(500).default(100), maxPages: z.number().int().min(1).max(100).default(20) }, async (args) => {
  const index = await syncOfficialRegistry(args);
  return textResult(`Synced ${index.total} MCP servers from ${index.source} at ${index.syncedAt}.`);
});

server.tool("enrich_mcp_github_metadata", "Enrich indexed MCPs with GitHub stars, forks, open issues, license, and push recency.", { maxRepos: z.number().int().min(1).max(60).default(30) }, async ({ maxRepos }) => {
  const result = await enrichIndexWithGitHub({ maxRepos });
  return textResult(`Enriched ${result.enriched} MCP servers with GitHub metadata.`);
});

server.tool("search_mcps", "Search MCP servers by app, workflow, category, install type, and auth friction.", { query: z.string().default(""), category: z.string().optional(), installType: z.enum(["all", "remote", "stdio", "npm", "pypi", "nuget", "oci", "unknown"]).default("all"), auth: z.enum(["any", "required", "none"]).default("any"), limit: z.number().int().min(1).max(50).default(10) }, async (args) => {
  const index = await loadIndex();
  return jsonResult(searchMcps(index, args));
});

server.tool("find_latest_mcps", "List recently published or updated MCP servers.", { days: z.number().int().min(1).max(365).default(14), category: z.string().optional(), limit: z.number().int().min(1).max(50).default(10) }, async (args) => {
  const index = await loadIndex();
  return jsonResult(latestMcps(index, args));
});

server.tool("recommend_mcp_for_task", "Recommend MCP servers for a concrete builder task.", { task: z.string().min(2), limit: z.number().int().min(1).max(10).default(5) }, async (args) => {
  const index = await loadIndex();
  return jsonResult(recommendForTask(index, args));
});

server.tool("generate_mcp_digest", "Generate a Markdown digest of new MCPs and top picks.", { days: z.number().int().min(1).max(90).default(7), category: z.string().optional(), limit: z.number().int().min(1).max(30).default(12) }, async (args) => {
  const index = await loadIndex();
  return jsonResult(generateWeeklyDigest(index, args));
});

server.tool("discover_mcp_sources", "List configured discovery sources and optionally fetch GitHub topic candidates.", { includeGitHubCandidates: z.boolean().default(false), perPage: z.number().int().min(1).max(30).default(10) }, async ({ includeGitHubCandidates, perPage }) => {
  return jsonResult({ sources: getDiscoverySources(), githubCandidates: includeGitHubCandidates ? await discoverFromGitHubTopics({ perPage }) : [] });
});

server.tool("get_mcp_details", "Get details and install recipes for one MCP server.", { name: z.string().min(1) }, async ({ name }) => {
  const index = await loadIndex();
  const details = getMcpDetails(index, name);
  return details ? jsonResult(details) : textResult(`No MCP found for "${name}".`);
});

server.tool("list_mcp_categories", "List inferred MCP categories with counts.", {}, async () => jsonResult(listCategories(await loadIndex())));

server.tool("compare_mcps", "Compare MCP servers by score, install type, auth friction, and source links.", { names: z.array(z.string()).min(2).max(8) }, async ({ names }) => jsonResult(compareMcps(await loadIndex(), names)));

server.prompt("find_the_right_mcp", "Turn a task into a practical MCP shortlist.", { task: z.string() }, ({ task }) => ({ messages: [{ role: "user", content: { type: "text", text: `Use MCP Radar to recommend MCP servers for this task: ${task}. Prioritize fit, trust, install friction, auth requirements, and maintenance.` } }] }));

await server.connect(new StdioServerTransport());

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}
