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
import { getRecentMentions, getRiskReport, getStats, getTrendingServers, getUnregisteredCandidates, listDbCategories, openDatabase, rebuildSearchIndex, reclassifyServers, searchServers } from "./db.js";
import { ingestAll, ingestGitHub, ingestHackerNews, ingestNpm, ingestOfficialRegistry, ingestReddit } from "./ingest.js";

const server = new McpServer({ name: "mcp-radar", version: "0.1.0" });

server.tool("sync_mcp_registry", "Refresh the local MCP index from the official MCP Registry.", { limit: z.number().int().min(1).max(500).default(100), maxPages: z.number().int().min(1).max(100).default(20) }, async (args) => {
  const index = await syncOfficialRegistry(args);
  return textResult(`Synced ${index.total} MCP servers from ${index.source} at ${index.syncedAt}.`);
});

server.tool("ingest_mcp_sources", "Ingest official registry, GitHub, npm, Hacker News, and Reddit into the SQLite database.", {
  registryPages: z.number().int().min(1).max(100).default(20),
  githubPerPage: z.number().int().min(1).max(50).default(20),
  githubPages: z.number().int().min(1).max(10).default(2),
  npmSize: z.number().int().min(1).max(100).default(25),
  hnHits: z.number().int().min(1).max(100).default(20),
  redditLimit: z.number().int().min(1).max(100).default(20)
}, async (args) => jsonResult(await ingestAll(args)));

server.tool("ingest_one_source", "Ingest one source into the SQLite database.", {
  source: z.enum(["registry", "github", "npm", "hacker-news", "reddit"])
}, async ({ source }) => {
  const db = openDatabase();
  if (source === "registry") return jsonResult(await ingestOfficialRegistry(db));
  if (source === "github") return jsonResult(await ingestGitHub(db));
  if (source === "npm") return jsonResult(await ingestNpm(db));
  if (source === "hacker-news") return jsonResult(await ingestHackerNews(db));
  return jsonResult(await ingestReddit(db));
});

server.tool("enrich_mcp_github_metadata", "Enrich indexed MCPs with GitHub stars, forks, open issues, license, and push recency.", { maxRepos: z.number().int().min(1).max(60).default(30) }, async ({ maxRepos }) => {
  const result = await enrichIndexWithGitHub({ maxRepos });
  return textResult(`Enriched ${result.enriched} MCP servers with GitHub metadata.`);
});

server.tool("search_mcps", "Search MCP servers by app, workflow, category, install type, and auth friction.", { query: z.string().default(""), category: z.string().optional(), installType: z.enum(["all", "remote", "stdio", "npm", "pypi", "nuget", "oci", "unknown"]).default("all"), auth: z.enum(["any", "required", "none"]).default("any"), limit: z.number().int().min(1).max(50).default(10) }, async (args) => {
  const index = await loadIndex();
  return jsonResult(searchMcps(index, args));
});

server.tool("search_mcp_database", "Search the SQLite MCP database across registry, GitHub, npm, and mention-enriched sources.", {
  query: z.string().default(""),
  category: z.string().default("all"),
  installType: z.string().default("all"),
  auth: z.enum(["any", "required", "none"]).default("any"),
  limit: z.number().int().min(1).max(50).default(10)
}, async (args) => jsonResult(searchServers(openDatabase(), args)));

server.tool("get_trending_mcps", "List trending MCPs based on mentions, quality, GitHub signals, and recency.", {
  days: z.number().int().min(1).max(365).default(14),
  limit: z.number().int().min(1).max(50).default(10)
}, async (args) => jsonResult(getTrendingServers(openDatabase(), args)));

server.tool("get_unregistered_mcp_candidates", "List MCP candidates found outside the official registry.", {
  limit: z.number().int().min(1).max(100).default(25)
}, async (args) => jsonResult(getUnregisteredCandidates(openDatabase(), args)));

server.tool("get_mcp_mentions", "List recent Reddit/Hacker News/social mentions captured by MCP Radar.", {
  limit: z.number().int().min(1).max(100).default(25)
}, async (args) => jsonResult(getRecentMentions(openDatabase(), args)));

server.tool("get_mcp_risk_report", "Inspect one MCP and return a plain-English trust and access risk report before installing it.", {
  name: z.string().min(1)
}, async ({ name }) => {
  const report = getRiskReport(openDatabase(), { name });
  return report ? jsonResult(report) : textResult(`No MCP found for "${name}".`);
});

server.tool("get_mcp_database_stats", "Return SQLite database counts for servers, mentions, raw candidates, and sources.", {}, async () => jsonResult(getStats(openDatabase())));

server.tool("reindex_mcp_search", "Rebuild the SQLite full-text search index for MCP servers.", {}, async () => jsonResult(rebuildSearchIndex(openDatabase())));

server.tool("reclassify_mcp_database", "Re-run MCP Radar taxonomy inference across every server in the SQLite database.", {}, async () => jsonResult(reclassifyServers(openDatabase())));

server.tool("list_mcp_database_categories", "List inferred category counts from the SQLite MCP database.", {}, async () => jsonResult(listDbCategories(openDatabase())));

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
