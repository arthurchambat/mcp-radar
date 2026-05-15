import {
  decorateServer,
  discoverFromGitHubTopics,
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

const MCP_QUERIES = [
  "mcp server",
  "model context protocol",
  "claude mcp",
  "cursor mcp",
  "mcp for"
];

const REDDIT_SUBREDDITS = ["ClaudeAI", "LocalLLaMA", "mcp", "ChatGPTCoding", "AI_Agents", "selfhosted", "programming"];

export async function ingestAll({ dbPath, registryPages = 20, githubPerPage = 20, npmSize = 25, hnHits = 20, redditLimit = 20 } = {}) {
  const db = openDatabase(dbPath);
  const summary = {};
  summary.registry = await ingestOfficialRegistry(db, { maxPages: registryPages });
  summary.github = await ingestGitHub(db, { perPage: githubPerPage });
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

export async function ingestGitHub(db = openDatabase(), { perPage = 20 } = {}) {
  const source = {
    slug: "github-topics",
    name: "GitHub MCP Topics",
    type: "github",
    url: "https://github.com/topics/model-context-protocol",
    priority: "secondary"
  };
  upsertSource(db, source);
  const repos = await discoverFromGitHubTopics({ perPage });
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
        categories: inferCandidateCategories(repo.title, repo.description),
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
  return { source: "github-topics", candidates: repos.length };
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
        categories: inferCandidateCategories(pkg.name, pkg.description),
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

function inferCandidateCategories(...parts) {
  const text = parts.join(" ").toLowerCase();
  const categories = [];
  if (/github|repo|git|code|dev|deploy|ci|issue|pull/.test(text)) categories.push("devtools-code");
  if (/postgres|sql|database|redis|mysql|mongo|data/.test(text)) categories.push("database-storage");
  if (/ads|marketing|seo|campaign|growth|gtm/.test(text)) categories.push("ads-growth");
  if (/notion|docs|gmail|email|calendar|slack|jira|linear/.test(text)) categories.push("productivity-docs");
  if (/browser|search|crawl|scrape|web/.test(text)) categories.push("browser-search");
  if (/analytics|metrics|report|dashboard|csv|excel/.test(text)) categories.push("data-analytics");
  if (/stripe|payment|finance|shopify|commerce|trading/.test(text)) categories.push("finance-commerce");
  return categories.length ? categories : ["general"];
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
