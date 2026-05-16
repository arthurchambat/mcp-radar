import {
  decorateServer,
  loadIndex,
  REGISTRY_API_URL,
  syncOfficialRegistry
} from "./registry.js";
import {
  getStats,
  openDatabase,
  upsertMention,
  upsertRawCandidate,
  upsertServer,
  upsertSource
} from "./db.js";
import { inferCategoriesFromText } from "./taxonomy.js";

const MCP_QUERIES = [
  "mcp server",
  "model context protocol",
  "claude mcp",
  "cursor mcp",
  "mcp for"
];

const GITHUB_REPO_QUERIES = [
  "topic:model-context-protocol",
  "topic:mcp-server",
  "\"model context protocol\" in:name,description,readme",
  "\"mcp server\" in:name,description,readme",
  "\"mcp-server\" in:name,description,readme",
  "\"claude mcp\" in:name,description,readme",
  "\"cursor mcp\" in:name,description,readme",
  "\"anthropic mcp\" in:name,description,readme",
  "\"modelcontextprotocol\" in:name,description,readme",
  "mcp language:TypeScript in:name,description",
  "mcp language:Python in:name,description",
  "mcp language:Go in:name,description"
];

const REDDIT_SUBREDDITS = ["ClaudeAI", "LocalLLaMA", "mcp", "ChatGPTCoding", "AI_Agents", "selfhosted", "programming"];

export async function ingestAll({ dbPath, registryPages = 20, githubPerPage = 50, githubPages = 2, npmSize = 50, hnHits = 20, redditLimit = 20 } = {}) {
  const db = openDatabase(dbPath);
  const summary = {};
  summary.registry = await ingestOfficialRegistry(db, { maxPages: registryPages });
  summary.github = await ingestGitHub(db, { perPage: githubPerPage, pages: githubPages });
  summary.npm = await ingestNpm(db, { size: npmSize });
  summary.hn = await ingestHackerNews(db, { hitsPerQuery: hnHits });
  summary.reddit = await ingestReddit(db, { limit: redditLimit });
  summary.stats = getStats(db);
  return summary;
}

export async function ingestOfficialRegistry(db = openDatabase(), { maxPages = 20 } = {}) {
  const source = upsertSource(db, {
    slug: "official-registry",
    name: "Official MCP Registry",
    type: "registry",
    url: REGISTRY_API_URL,
    priority: "primary"
  });
  let index;
  try {
    index = await syncOfficialRegistry({ maxPages });
  } catch {
    index = await loadIndex();
  }
  if (!index.servers?.length) throw new Error("No registry data available. Run `npm run sync` when the registry is reachable.");
  const write = db.transaction((servers) => {
    for (const server of servers) upsertServer(db, { ...server, registryPresent: true });
  });
  write(index.servers);
  upsertSource(db, { ...source, slug: "official-registry", lastSyncedAt: new Date().toISOString() });
  return { source: "official-registry", servers: index.servers.length };
}

export async function ingestGitHub(db = openDatabase(), { perPage = 50, pages = 2, queries = GITHUB_REPO_QUERIES } = {}) {
  const source = {
    slug: "github-topics",
    name: "GitHub MCP Topics",
    type: "github",
    url: "https://github.com/topics/model-context-protocol",
    priority: "secondary"
  };
  upsertSource(db, source);
  const repos = await discoverGitHubRepositories({ perPage, pages, queries });
  const write = db.transaction((items) => {
    for (const repo of items) {
      const server = decorateServer({
        name: `github/${repo.name.toLowerCase()}`,
        title: repo.title,
        description: repo.description,
        version: null,
        status: "candidate",
        publishedAt: null,
        updatedAt: repo.updatedAt,
        repositoryUrl: repo.repositoryUrl,
        websiteUrl: null,
        installTypes: ["unknown"],
        categories: inferCategoriesFromText(repo.title, repo.description, repo.repositoryUrl, repo.language, repo.topics?.join(" ")),
        authRequired: false,
        registryPresent: false,
        github: {
          fullName: repo.name,
          stars: repo.stars,
          forks: repo.forks,
          openIssues: repo.openIssues,
          updatedAt: repo.updatedAt,
          pushedAt: repo.pushedAt
        },
        remotes: [],
        packages: [],
        metadata: repo
      });
      upsertServer(db, server);
      upsertRawCandidate(db, {
        source,
        url: repo.repositoryUrl,
        title: repo.title,
        text: repo.description,
        extractedName: server.name,
        confidence: 80,
        processedAt: new Date().toISOString(),
        metadata: repo
      });
    }
  });
  write(repos);
  return { source: "github-topics", candidates: repos.length, queries: queries.length, pages };
}

export async function ingestNpm(db = openDatabase(), { size = 25 } = {}) {
  const source = {
    slug: "npm-search",
    name: "npm package search",
    type: "package-registry",
    url: "https://registry.npmjs.org/-/v1/search",
    priority: "secondary"
  };
  upsertSource(db, source);
  const seen = new Map();
  for (const query of ["mcp server", "mcp-server", "model-context-protocol"]) {
    const url = new URL(source.url);
    url.searchParams.set("text", query);
    url.searchParams.set("size", String(size));
    const response = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(12000) });
    if (!response.ok) continue;
    const data = await response.json();
    for (const item of data.objects || []) seen.set(item.package.name, item);
  }
  const packages = [...seen.values()];
  const write = db.transaction((items) => {
    for (const item of items) {
      const pkg = item.package;
      const server = decorateServer({
        name: `npm/${pkg.name}`,
        title: pkg.name,
        description: pkg.description || "",
        version: pkg.version || null,
        status: "candidate",
        publishedAt: pkg.date || null,
        updatedAt: pkg.date || null,
        repositoryUrl: normalizeRepoUrl(pkg.links?.repository),
        websiteUrl: pkg.links?.homepage || pkg.links?.npm || null,
        installTypes: ["npm", "stdio"],
        categories: inferCategoriesFromText(pkg.name, pkg.description, pkg.links?.repository, pkg.keywords?.join(" ")),
        authRequired: false,
        registryPresent: false,
        github: null,
        remotes: [],
        packages: [{ registryType: "npm", packageName: pkg.name, version: pkg.version, transport: "stdio", authRequired: false }],
        metadata: { npm: item }
      });
      upsertServer(db, server);
      upsertRawCandidate(db, {
        source,
        url: pkg.links?.npm,
        title: pkg.name,
        text: pkg.description,
        extractedName: server.name,
        confidence: 75,
        processedAt: new Date().toISOString(),
        metadata: item
      });
    }
  });
  write(packages);
  return { source: "npm-search", candidates: packages.length };
}

export async function ingestHackerNews(db = openDatabase(), { hitsPerQuery = 20 } = {}) {
  const source = {
    slug: "hacker-news",
    name: "Hacker News",
    type: "social",
    url: "https://hn.algolia.com/api/v1/search_by_date",
    priority: "secondary"
  };
  upsertSource(db, source);
  const mentions = [];
  for (const query of MCP_QUERIES.slice(0, 3)) {
    const url = new URL(source.url);
    url.searchParams.set("query", query);
    url.searchParams.set("tags", "story,comment");
    url.searchParams.set("hitsPerPage", String(hitsPerQuery));
    const response = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(12000) });
    if (!response.ok) continue;
    const data = await response.json();
    for (const hit of data.hits || []) {
      mentions.push({
        source,
        externalId: String(hit.objectID),
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        title: hit.title || hit.story_title || "Hacker News mention",
        text: hit.comment_text || hit.story_text || hit.title || "",
        author: hit.author,
        score: hit.points || 1,
        createdAt: hit.created_at,
        metadata: hit
      });
    }
  }
  const write = db.transaction((items) => items.forEach((mention) => upsertMention(db, mention)));
  write(mentions);
  return { source: "hacker-news", mentions: mentions.length };
}

export async function ingestReddit(db = openDatabase(), { limit = 20 } = {}) {
  const source = {
    slug: "reddit-search",
    name: "Reddit search",
    type: "social",
    url: "https://www.reddit.com/search.json",
    priority: "secondary"
  };
  upsertSource(db, source);
  const mentions = [];
  for (const subreddit of REDDIT_SUBREDDITS) {
    for (const query of MCP_QUERIES.slice(0, 2)) {
      const url = new URL(`https://www.reddit.com/r/${subreddit}/search.json`);
      url.searchParams.set("q", query);
      url.searchParams.set("restrict_sr", "1");
      url.searchParams.set("sort", "new");
      url.searchParams.set("limit", String(limit));
      const response = await fetch(url, { headers: apiHeaders("application/json"), signal: AbortSignal.timeout(12000) });
      if (!response.ok) continue;
      const data = await response.json();
      for (const child of data.data?.children || []) {
        const post = child.data;
        mentions.push({
          source,
          externalId: post.id,
          url: `https://www.reddit.com${post.permalink}`,
          title: post.title,
          text: post.selftext || "",
          author: post.author,
          score: post.score || 0,
          createdAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
          metadata: { subreddit, post }
        });
      }
    }
  }
  const write = db.transaction((items) => items.forEach((mention) => upsertMention(db, mention)));
  write(mentions);
  return { source: "reddit-search", mentions: mentions.length };
}

export async function discoverGitHubRepositories({ perPage = 50, pages = 2, queries = GITHUB_REPO_QUERIES } = {}) {
  const seen = new Map();
  const cappedPerPage = Math.min(Number(perPage), 100);
  for (const query of queries) {
    for (let page = 1; page <= Number(pages); page += 1) {
      const url = new URL("https://api.github.com/search/repositories");
      url.searchParams.set("q", query);
      url.searchParams.set("sort", "updated");
      url.searchParams.set("order", "desc");
      url.searchParams.set("per_page", String(cappedPerPage));
      url.searchParams.set("page", String(page));
      const response = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(15000) });
      if (!response.ok) break;
      const data = await response.json();
      for (const repo of data.items || []) {
        const haystack = `${repo.full_name} ${repo.name} ${repo.description || ""} ${(repo.topics || []).join(" ")}`.toLowerCase();
        if (!/(mcp|model context protocol|modelcontextprotocol)/.test(haystack)) continue;
        seen.set(repo.full_name, {
          name: repo.full_name,
          title: repo.name,
          description: repo.description || "",
          repositoryUrl: repo.html_url,
          stars: repo.stargazers_count || 0,
          forks: repo.forks_count || 0,
          openIssues: repo.open_issues_count || 0,
          updatedAt: repo.updated_at,
          pushedAt: repo.pushed_at,
          language: repo.language,
          topics: repo.topics || [],
          source: "github-search",
          matchedQuery: query
        });
      }
      if ((data.items || []).length < cappedPerPage) break;
    }
  }
  return [...seen.values()].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function normalizeRepoUrl(value) {
  if (!value) return null;
  return value.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "");
}

function apiHeaders(accept = "application/json") {
  const headers = { accept, "user-agent": "mcp-radar/0.2.0" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}
