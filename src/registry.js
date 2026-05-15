import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTRY_API_URL = process.env.MCP_RADAR_REGISTRY_URL || "https://registry.modelcontextprotocol.io/v0/servers";
export const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_INDEX_PATH = path.resolve(__dirname, "../data/mcp-index.json");

const CATEGORY_RULES = [
  ["ads-growth", ["ads", "campaign", "marketing", "growth", "gtm", "seo", "keyword", "linkedin", "meta ads", "google ads"]],
  ["devtools-code", ["github", "gitlab", "repository", "code", "deploy", "vercel", "ci", "debug", "logs", "issue", "pull request"]],
  ["database-storage", ["postgres", "mysql", "database", "sql", "supabase", "redis", "mongodb", "storage", "warehouse"]],
  ["productivity-docs", ["notion", "docs", "document", "calendar", "email", "gmail", "slack", "linear", "jira", "workspace"]],
  ["browser-search", ["browser", "search", "crawl", "web", "scrape", "internet"]],
  ["data-analytics", ["analytics", "metrics", "dashboard", "report", "bi", "spreadsheet", "excel", "csv"]],
  ["finance-commerce", ["stripe", "payment", "invoice", "commerce", "shopify", "finance", "trading", "crypto"]],
  ["ai-media", ["image", "video", "audio", "llm", "model", "prompt", "3d", "media"]],
  ["customer-support", ["crm", "support", "ticket", "intercom", "zendesk", "customer", "salesforce"]],
  ["local-system", ["filesystem", "terminal", "shell", "desktop", "local", "os"]]
];

export const DISCOVERY_SOURCES = [
  { name: "Official MCP Registry", type: "registry", url: REGISTRY_API_URL, priority: "primary", note: "Canonical registry source used for the local index." },
  { name: "GitHub topic: model-context-protocol", type: "github-topic", url: "https://github.com/topics/model-context-protocol", apiQuery: "topic:model-context-protocol", priority: "secondary", note: "Finds open-source servers before they appear in directories." },
  { name: "GitHub topic: mcp-server", type: "github-topic", url: "https://github.com/topics/mcp-server", apiQuery: "topic:mcp-server", priority: "secondary", note: "Broad source with more noise but useful for early discovery." },
  { name: "Smithery", type: "directory", url: "https://smithery.ai/", priority: "future", note: "Future directory integration pending API and terms review." },
  { name: "Glama", type: "directory", url: "https://glama.ai/mcp/servers", priority: "future", note: "Future cross-check source for popularity and categories." },
  { name: "PulseMCP", type: "directory", url: "https://www.pulsemcp.com/", priority: "future", note: "Future source for launch/news discovery." }
];

export async function syncOfficialRegistry({ limit = 100, maxPages = 20, indexPath = DEFAULT_INDEX_PATH } = {}) {
  const rawEntries = [];
  let cursor;
  let pages = 0;
  do {
    const page = await fetchRegistryPage({ limit, cursor });
    rawEntries.push(...(page.servers || []));
    cursor = page.metadata?.nextCursor;
    pages += 1;
  } while (cursor && pages < maxPages);

  const seen = new Map();
  for (const entry of rawEntries) {
    const server = decorateServer(normalizeRegistryEntry(entry));
    const previous = seen.get(server.name);
    if (!previous || new Date(server.updatedAt || 0) > new Date(previous.updatedAt || 0)) seen.set(server.name, server);
  }

  const index = {
    source: REGISTRY_API_URL,
    syncedAt: new Date().toISOString(),
    total: seen.size,
    servers: [...seen.values()].sort(sortByUpdated)
  };
  await saveIndex(index, indexPath);
  return index;
}

export async function fetchRegistryPage({ limit = 100, cursor } = {}) {
  const url = new URL(REGISTRY_API_URL);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, { headers: apiHeaders() });
  if (!response.ok) throw new Error(`Registry request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

export function normalizeRegistryEntry(entry) {
  const server = entry.server || entry;
  const official = server._meta?.["io.modelcontextprotocol.registry/official"] || entry._meta?.["io.modelcontextprotocol.registry/official"] || {};
  const remotes = Array.isArray(server.remotes) ? server.remotes : [];
  const packages = Array.isArray(server.packages) ? server.packages : [];
  const text = [server.name, server.title, server.description, server.repository?.url, server.websiteUrl, packages.map((pkg) => [pkg.registryType, pkg.identifier, pkg.packageName].join(" ")).join(" ")].join(" ").toLowerCase();
  const base = {
    name: server.name,
    title: server.title || server.name,
    description: server.description || "",
    version: server.version || "unknown",
    status: official.status || "unknown",
    publishedAt: official.publishedAt || null,
    updatedAt: official.updatedAt || official.statusChangedAt || null,
    isLatest: official.isLatest ?? true,
    repositoryUrl: server.repository?.url || null,
    websiteUrl: server.websiteUrl || null,
    installTypes: inferInstallTypes(remotes, packages),
    categories: inferCategories(text),
    authRequired: hasRequiredAuth(remotes, packages),
    github: null,
    remotes: remotes.map(cleanRemote),
    packages: packages.map(cleanPackage),
    discoveredVia: ["official-registry"]
  };
  return base;
}

export function decorateServer(server, query = "") {
  const scores = calculateScores(server, query);
  return { ...server, scores, qualityScore: scores.quality, trustScore: scores.trust, installFriction: scores.installFrictionLabel, installRecipes: buildInstallRecipes(server) };
}

export async function loadIndex(indexPath = DEFAULT_INDEX_PATH) {
  try {
    return JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { source: REGISTRY_API_URL, syncedAt: null, total: 0, servers: [] };
    throw error;
  }
}

export async function saveIndex(index, indexPath = DEFAULT_INDEX_PATH) {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

export function searchMcps(index, { query = "", category, installType, auth, limit = 20 } = {}) {
  const q = query.trim().toLowerCase();
  return (index.servers || [])
    .filter((server) => !category || category === "all" || server.categories.includes(category))
    .filter((server) => !installType || installType === "all" || server.installTypes.includes(installType))
    .filter((server) => auth !== "required" || server.authRequired)
    .filter((server) => auth !== "none" || !server.authRequired)
    .map((server) => {
      const decorated = decorateServer(server, q);
      return { server: decorated, rawScore: decorated.scores.rawSearchScore };
    })
    .filter((result) => !q || result.rawScore > 0)
    .sort((a, b) => b.server.scores.fit - a.server.scores.fit || sortByUpdated(a.server, b.server))
    .slice(0, Number(limit))
    .map(({ server }) => server);
}

export function latestMcps(index, { days = 14, category, limit = 20 } = {}) {
  const threshold = Date.now() - Number(days) * 86400000;
  return (index.servers || [])
    .filter((server) => !category || category === "all" || server.categories.includes(category))
    .filter((server) => new Date(server.publishedAt || server.updatedAt || 0).getTime() >= threshold)
    .sort((a, b) => new Date(b.publishedAt || b.updatedAt || 0) - new Date(a.publishedAt || a.updatedAt || 0))
    .slice(0, Number(limit))
    .map((server) => decorateServer(server));
}

export function recommendForTask(index, { task, limit = 5 } = {}) {
  return searchMcps(index, { query: task, limit }).map((server) => ({ ...server, why: buildRecommendationReason(server, task) }));
}

export function getMcpDetails(index, name) {
  const target = String(name || "").toLowerCase();
  const server = (index.servers || []).find((item) => item.name.toLowerCase() === target || item.title.toLowerCase() === target);
  return server ? decorateServer(server) : null;
}

export function compareMcps(index, names = []) {
  return names.map((name) => getMcpDetails(index, name)).filter(Boolean).map((server) => ({
    name: server.name,
    title: server.title,
    qualityScore: server.qualityScore,
    trustScore: server.trustScore,
    installFriction: server.installFriction,
    categories: server.categories,
    installTypes: server.installTypes,
    authRequired: server.authRequired,
    repositoryUrl: server.repositoryUrl,
    websiteUrl: server.websiteUrl,
    updatedAt: server.updatedAt,
    summary: server.description
  }));
}

export function listCategories(index) {
  const counts = new Map();
  for (const server of index.servers || []) for (const category of server.categories) counts.set(category, (counts.get(category) || 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function generateWeeklyDigest(index, { days = 7, category, limit = 12 } = {}) {
  const latest = latestMcps(index, { days, category, limit: 100 });
  const top = [...latest].sort((a, b) => b.qualityScore - a.qualityScore || b.scores.recency - a.scores.recency).slice(0, Number(limit));
  const categoryCounts = new Map();
  for (const server of latest) for (const item of server.categories) categoryCounts.set(item, (categoryCounts.get(item) || 0) + 1);
  const lines = [
    "# MCP Radar Digest",
    "",
    `Window: last ${days} days`,
    `New or updated MCPs: ${latest.length}`,
    "",
    "## Top Picks",
    ...top.map((server, index) => `${index + 1}. **${server.title}** (${server.qualityScore}/100 quality) - ${server.description || "No description."} ${server.repositoryUrl || server.websiteUrl || ""}`.trim()),
    "",
    "## Category Movement",
    ...[...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `- ${name}: ${count}`),
    "",
    "## LinkedIn Draft",
    `I tracked ${latest.length} MCP servers that appeared or changed in the last ${days} days.`,
    `The most interesting ones for builders: ${top.slice(0, 5).map((server) => server.title).join(", ")}.`,
    "The pattern: MCP discovery is moving from random GitHub repos into installable, task-specific infrastructure."
  ];
  return { days, count: latest.length, top, categories: [...categoryCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), markdown: lines.join("\n") };
}

export async function enrichIndexWithGitHub({ indexPath = DEFAULT_INDEX_PATH, maxRepos = 40 } = {}) {
  const index = await loadIndex(indexPath);
  let enriched = 0;
  const servers = [];
  for (const server of index.servers || []) {
    if (enriched >= maxRepos || server.github) {
      servers.push(server);
      continue;
    }
    const repo = parseGitHubRepo(server.repositoryUrl);
    if (!repo) {
      servers.push(server);
      continue;
    }
    try {
      const github = await fetchGitHubRepo(repo);
      servers.push(decorateServer({ ...server, github }));
      enriched += 1;
    } catch {
      servers.push(server);
    }
  }
  const next = { ...index, enrichedAt: new Date().toISOString(), servers };
  await saveIndex(next, indexPath);
  return { ...next, enriched };
}

export async function discoverFromGitHubTopics({ perPage = 10 } = {}) {
  const queries = DISCOVERY_SOURCES.filter((source) => source.type === "github-topic").map((source) => source.apiQuery);
  const seen = new Map();
  for (const query of queries) {
    const url = new URL(GITHUB_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(perPage));
    const response = await fetch(url, { headers: apiHeaders() });
    if (!response.ok) continue;
    const data = await response.json();
    for (const repo of data.items || []) seen.set(repo.full_name, { name: repo.full_name, title: repo.name, description: repo.description || "", repositoryUrl: repo.html_url, stars: repo.stargazers_count || 0, forks: repo.forks_count || 0, openIssues: repo.open_issues_count || 0, updatedAt: repo.updated_at, pushedAt: repo.pushed_at, source: "github-topic" });
  }
  return [...seen.values()].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export function getDiscoverySources() {
  return DISCOVERY_SOURCES;
}

function inferCategories(text) {
  const matches = CATEGORY_RULES.filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword))).map(([category]) => category);
  return matches.length ? matches : ["general"];
}

function inferInstallTypes(remotes, packages) {
  const types = new Set();
  if (remotes.length) types.add("remote");
  for (const pkg of packages) {
    if (pkg.registryType) types.add(pkg.registryType);
    if (pkg.transport?.type) types.add(pkg.transport.type);
  }
  if (!types.size) types.add("unknown");
  return [...types].sort();
}

function hasRequiredAuth(remotes, packages) {
  return remotes.some((remote) => (remote.headers || []).some((header) => header.isRequired || header.isSecret)) || packages.some((pkg) => (pkg.environmentVariables || []).some((env) => env.isRequired || env.isSecret));
}

function cleanRemote(remote) {
  return { type: remote.type || "unknown", url: remote.url || null, authRequired: (remote.headers || []).some((header) => header.isRequired || header.isSecret) };
}

function cleanPackage(pkg) {
  return { registryType: pkg.registryType || null, packageName: pkg.identifier || pkg.packageName || null, version: pkg.version || null, transport: pkg.transport?.type || null, authRequired: (pkg.environmentVariables || []).some((env) => env.isRequired || env.isSecret) };
}

function calculateScores(server, query = "") {
  const raw = scoreSearch(server, query);
  const match = query ? clamp(Math.round((raw / Math.max(query.split(/\s+/).length * 18, 1)) * 100), 0, 100) : 50;
  const recency = scoreRecency(server.updatedAt || server.publishedAt || server.github?.pushedAt);
  const installFriction = scoreInstallFriction(server);
  const trust = scoreTrust(server, recency);
  const quality = clamp(Math.round(trust * 0.34 + recency * 0.18 + installFriction * 0.18 + scoreCompleteness(server) * 0.2 + (server.status === "active" ? 10 : 4)), 0, 100);
  return { fit: query ? clamp(Math.round(match * 0.6 + quality * 0.4), 0, 100) : quality, quality, trust, recency, installFriction, installFrictionLabel: installFriction >= 80 ? "low" : installFriction >= 55 ? "medium" : "high", rawSearchScore: raw };
}

function scoreSearch(server, query) {
  if (!query) return 1;
  const weighted = [[server.title, 6], [server.name, 5], [server.categories.join(" "), 4], [server.description, 3], [server.repositoryUrl || "", 2], [server.websiteUrl || "", 1]];
  return query.split(/\s+/).filter(Boolean).reduce((score, token) => score + weighted.reduce((inner, [value, weight]) => inner + (String(value || "").toLowerCase().includes(token) ? weight : 0), 0), 0);
}

function scoreRecency(value) {
  if (!value) return 30;
  const ageDays = (Date.now() - new Date(value).getTime()) / 86400000;
  if (ageDays <= 14) return 100;
  if (ageDays <= 45) return 85;
  if (ageDays <= 120) return 70;
  if (ageDays <= 365) return 50;
  return 25;
}

function scoreInstallFriction(server) {
  let score = 55;
  if (server.installTypes?.includes("remote")) score += 25;
  if (server.installTypes?.includes("npm")) score += 15;
  if (server.installTypes?.includes("stdio")) score += 8;
  if (server.authRequired) score -= 25;
  if (server.installTypes?.includes("unknown")) score -= 20;
  return clamp(score, 0, 100);
}

function scoreTrust(server, recency) {
  let score = 35;
  if (server.status === "active") score += 15;
  if (server.repositoryUrl) score += 10;
  if (server.websiteUrl) score += 5;
  if (server.github) {
    score += Math.min(20, Math.log10((server.github.stars || 0) + 1) * 10);
    score += Math.min(8, Math.log10((server.github.forks || 0) + 1) * 4);
    score += scoreRecency(server.github.pushedAt) * 0.12;
  } else {
    score += recency * 0.08;
  }
  return clamp(Math.round(score), 0, 100);
}

function scoreCompleteness(server) {
  let score = 0;
  if (server.title && server.title !== server.name) score += 15;
  if (server.description && server.description.length > 40) score += 25;
  if (server.repositoryUrl) score += 20;
  if (server.websiteUrl) score += 10;
  if ((server.remotes || []).length) score += 15;
  if ((server.packages || []).length) score += 15;
  return clamp(score, 0, 100);
}

function buildInstallRecipes(server) {
  const slug = server.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  const recipes = [];
  for (const pkg of server.packages || []) {
    if (pkg.registryType === "npm" && pkg.packageName) {
      recipes.push({ client: "Claude Desktop / stdio", type: "json", label: `npm package: ${pkg.packageName}`, config: { mcpServers: { [slug]: { command: "npx", args: ["-y", pkg.packageName] } } } });
      recipes.push({ client: "Codex / stdio", type: "toml", label: `npm package: ${pkg.packageName}`, config: `[mcp_servers.${slug}]\ncommand = "npx"\nargs = ["-y", "${pkg.packageName}"]` });
    }
    if (pkg.registryType === "pypi" && pkg.packageName) recipes.push({ client: "Claude Desktop / stdio", type: "json", label: `PyPI package: ${pkg.packageName}`, config: { mcpServers: { [slug]: { command: "uvx", args: [pkg.packageName] } } } });
  }
  for (const remote of server.remotes || []) if (remote.url) recipes.push({ client: "Remote MCP clients", type: "remote", label: remote.type, config: { name: slug, transport: remote.type, url: remote.url } });
  return recipes;
}

function buildRecommendationReason(server, task) {
  const install = server.installTypes.includes("remote") ? "remote install available" : `${server.installTypes[0]} package install`;
  const auth = server.authRequired ? "requires credentials" : "no required auth detected";
  return `Matches "${task}" through ${server.categories.slice(0, 2).join(", ")}; ${install}; ${auth}.`;
}

function parseGitHubRepo(url) {
  const match = String(url || "").match(/github\.com[:/]+([^/\s]+)\/([^/#?\s]+)/i);
  return match ? `${match[1]}/${match[2].replace(/\.git$/, "")}` : null;
}

async function fetchGitHubRepo(repo) {
  const response = await fetch(`https://api.github.com/repos/${repo}`, { headers: apiHeaders() });
  if (!response.ok) throw new Error(`GitHub request failed for ${repo}`);
  const data = await response.json();
  return { fullName: data.full_name, stars: data.stargazers_count || 0, forks: data.forks_count || 0, openIssues: data.open_issues_count || 0, pushedAt: data.pushed_at || null, updatedAt: data.updated_at || null, license: data.license?.spdx_id || null, archived: Boolean(data.archived) };
}

function apiHeaders() {
  const headers = { accept: "application/json", "user-agent": "mcp-radar/0.1.0" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function sortByUpdated(a, b) {
  return new Date(b.updatedAt || b.publishedAt || 0) - new Date(a.updatedAt || a.publishedAt || 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
