#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverFromGitHubTopics, enrichIndexWithGitHub, generateWeeklyDigest, getDiscoverySources, getMcpDetails, latestMcps, listCategories, loadIndex, recommendForTask, searchMcps, syncOfficialRegistry } from "./registry.js";
import { getRecentMentions, getRiskReport, getStats, getTrendingServers, getUnregisteredCandidates, openDatabase, searchServers } from "./db.js";
import { ingestAll, ingestGitHub, ingestHackerNews, ingestNpm, ingestOfficialRegistry, ingestReddit } from "./ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(__dirname, "../ui");
const port = Number(process.env.PORT || 8787);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/status") {
      const index = await loadIndex();
      const stats = getStats(openDatabase());
      return sendJson(response, { syncedAt: index.syncedAt || stats.lastSyncedAt, total: stats.servers || index.total, source: index.source, categories: listCategories(index).slice(0, 8), database: stats });
    }
    if (url.pathname === "/api/sync" && request.method === "POST") return sendJson(response, await syncOfficialRegistry());
    if (url.pathname === "/api/ingest" && request.method === "POST") return sendJson(response, await ingestAll());
    if (url.pathname === "/api/ingest/registry" && request.method === "POST") return sendJson(response, await ingestOfficialRegistry(openDatabase()));
    if (url.pathname === "/api/ingest/github" && request.method === "POST") return sendJson(response, await ingestGitHub(openDatabase()));
    if (url.pathname === "/api/ingest/npm" && request.method === "POST") return sendJson(response, await ingestNpm(openDatabase()));
    if (url.pathname === "/api/ingest/hn" && request.method === "POST") return sendJson(response, await ingestHackerNews(openDatabase()));
    if (url.pathname === "/api/ingest/reddit" && request.method === "POST") return sendJson(response, await ingestReddit(openDatabase()));
    if (url.pathname === "/api/enrich/github" && request.method === "POST") return sendJson(response, await enrichIndexWithGitHub({ maxRepos: Number(url.searchParams.get("maxRepos") || 30) }));
    if (url.pathname === "/api/search") return sendJson(response, searchMcps(await loadIndex(), { query: url.searchParams.get("query") || "", category: url.searchParams.get("category") || "all", installType: url.searchParams.get("installType") || "all", auth: url.searchParams.get("auth") || "any", limit: Number(url.searchParams.get("limit") || 30) }));
    if (url.pathname === "/api/db/search") return sendJson(response, searchServers(openDatabase(), { query: url.searchParams.get("query") || "", category: url.searchParams.get("category") || "all", installType: url.searchParams.get("installType") || "all", auth: url.searchParams.get("auth") || "any", limit: Number(url.searchParams.get("limit") || 30) }));
    if (url.pathname === "/api/db/trending") return sendJson(response, getTrendingServers(openDatabase(), { days: Number(url.searchParams.get("days") || 14), limit: Number(url.searchParams.get("limit") || 30) }));
    if (url.pathname === "/api/db/candidates") return sendJson(response, getUnregisteredCandidates(openDatabase(), { limit: Number(url.searchParams.get("limit") || 50) }));
    if (url.pathname === "/api/db/mentions") return sendJson(response, getRecentMentions(openDatabase(), { limit: Number(url.searchParams.get("limit") || 50) }));
    if (url.pathname === "/api/db/risk") {
      const report = getRiskReport(openDatabase(), { name: url.searchParams.get("name") || "" });
      return report ? sendJson(response, report) : sendJson(response, { error: "Not found" }, 404);
    }
    if (url.pathname === "/api/db/stats") return sendJson(response, getStats(openDatabase()));
    if (url.pathname === "/api/latest") return sendJson(response, latestMcps(await loadIndex(), { days: Number(url.searchParams.get("days") || 30), category: url.searchParams.get("category") || "all", limit: Number(url.searchParams.get("limit") || 30) }));
    if (url.pathname === "/api/recommend") return sendJson(response, recommendForTask(await loadIndex(), { task: url.searchParams.get("task") || "", limit: 8 }));
    if (url.pathname === "/api/digest") return sendJson(response, generateWeeklyDigest(await loadIndex(), { days: Number(url.searchParams.get("days") || 7), category: url.searchParams.get("category") || "all", limit: Number(url.searchParams.get("limit") || 12) }));
    if (url.pathname === "/api/sources") return sendJson(response, getDiscoverySources());
    if (url.pathname === "/api/discover/github") return sendJson(response, await discoverFromGitHubTopics({ perPage: Number(url.searchParams.get("perPage") || 10) }));
    if (url.pathname === "/api/details") {
      const details = getMcpDetails(await loadIndex(), url.searchParams.get("name") || "");
      return details ? sendJson(response, details) : sendJson(response, { error: "Not found" }, 404);
    }
    if (url.pathname === "/api/categories") return sendJson(response, listCategories(await loadIndex()));
    return serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, { error: error.message }, 500);
  }
});

server.listen(port, () => console.log(`MCP Radar UI: http://127.0.0.1:${port}`));

async function serveStatic(response, pathname) {
  const fullPath = path.join(uiDir, pathname === "/" ? "/index.html" : pathname);
  if (!fullPath.startsWith(uiDir)) return sendText(response, "Forbidden", 403);
  try {
    const content = await fs.readFile(fullPath);
    const type = fullPath.endsWith(".css") ? "text/css" : fullPath.endsWith(".js") ? "text/javascript" : "text/html";
    response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    response.end(content);
  } catch {
    sendText(response, "Not found", 404);
  }
}

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendText(response, value, status = 200) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(value);
}
