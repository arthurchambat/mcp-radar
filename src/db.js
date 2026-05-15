import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = path.resolve(__dirname, "../data/mcp-radar.db");

export function openDatabase(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT,
      priority TEXT DEFAULT 'secondary',
      last_synced_at TEXT,
      metadata_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      website_url TEXT,
      repository_url TEXT,
      status TEXT DEFAULT 'unknown',
      version TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      published_at TEXT,
      updated_at TEXT,
      quality_score INTEGER DEFAULT 0,
      trust_score INTEGER DEFAULT 0,
      install_friction TEXT DEFAULT 'unknown',
      auth_required INTEGER DEFAULT 0,
      registry_present INTEGER DEFAULT 0,
      github_stars INTEGER DEFAULT 0,
      github_forks INTEGER DEFAULT 0,
      github_open_issues INTEGER DEFAULT 0,
      github_pushed_at TEXT,
      metadata_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS install_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      package_name TEXT,
      command TEXT,
      transport TEXT,
      url TEXT,
      auth_required INTEGER DEFAULT 0,
      metadata_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS server_categories (
      server_id INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (server_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES mcp_servers(id) ON DELETE SET NULL,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      external_id TEXT,
      url TEXT,
      title TEXT,
      text TEXT,
      author TEXT,
      score INTEGER DEFAULT 0,
      created_at TEXT,
      discovered_at TEXT NOT NULL,
      metadata_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS raw_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      url TEXT,
      title TEXT,
      text TEXT,
      extracted_name TEXT,
      confidence INTEGER DEFAULT 0,
      processed_at TEXT,
      discovered_at TEXT NOT NULL,
      metadata_json TEXT DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_servers_updated ON mcp_servers(updated_at);
    CREATE INDEX IF NOT EXISTS idx_servers_quality ON mcp_servers(quality_score);
    CREATE INDEX IF NOT EXISTS idx_mentions_created ON mentions(created_at);
    CREATE INDEX IF NOT EXISTS idx_mentions_score ON mentions(score);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_install_options_unique
      ON install_options(server_id, type, COALESCE(package_name, ''), COALESCE(url, ''), COALESCE(transport, ''));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mentions_unique
      ON mentions(source_id, COALESCE(external_id, ''), COALESCE(url, ''));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_candidates_unique
      ON raw_candidates(source_id, COALESCE(url, ''), COALESCE(title, ''));
  `);
}

export function upsertSource(db, source) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sources (slug, name, type, url, priority, last_synced_at, metadata_json)
    VALUES (@slug, @name, @type, @url, @priority, @lastSyncedAt, @metadataJson)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      url = excluded.url,
      priority = excluded.priority,
      last_synced_at = excluded.last_synced_at,
      metadata_json = excluded.metadata_json
  `).run({
    slug: source.slug,
    name: source.name,
    type: source.type,
    url: source.url || null,
    priority: source.priority || "secondary",
    lastSyncedAt: source.lastSyncedAt || now,
    metadataJson: JSON.stringify(source.metadata || {})
  });
  return db.prepare("SELECT * FROM sources WHERE slug = ?").get(source.slug);
}

export function upsertServer(db, server) {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT * FROM mcp_servers WHERE canonical_name = ?").get(server.name);
  db.prepare(`
    INSERT INTO mcp_servers (
      canonical_name, title, description, website_url, repository_url, status, version,
      first_seen_at, last_seen_at, published_at, updated_at, quality_score, trust_score,
      install_friction, auth_required, registry_present, github_stars, github_forks,
      github_open_issues, github_pushed_at, metadata_json
    )
    VALUES (
      @name, @title, @description, @websiteUrl, @repositoryUrl, @status, @version,
      @firstSeenAt, @lastSeenAt, @publishedAt, @updatedAt, @qualityScore, @trustScore,
      @installFriction, @authRequired, @registryPresent, @githubStars, @githubForks,
      @githubOpenIssues, @githubPushedAt, @metadataJson
    )
    ON CONFLICT(canonical_name) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      website_url = excluded.website_url,
      repository_url = excluded.repository_url,
      status = excluded.status,
      version = excluded.version,
      last_seen_at = excluded.last_seen_at,
      published_at = COALESCE(excluded.published_at, mcp_servers.published_at),
      updated_at = COALESCE(excluded.updated_at, mcp_servers.updated_at),
      quality_score = excluded.quality_score,
      trust_score = excluded.trust_score,
      install_friction = excluded.install_friction,
      auth_required = excluded.auth_required,
      registry_present = MAX(mcp_servers.registry_present, excluded.registry_present),
      github_stars = MAX(mcp_servers.github_stars, excluded.github_stars),
      github_forks = MAX(mcp_servers.github_forks, excluded.github_forks),
      github_open_issues = excluded.github_open_issues,
      github_pushed_at = COALESCE(excluded.github_pushed_at, mcp_servers.github_pushed_at),
      metadata_json = excluded.metadata_json
  `).run({
    name: server.name,
    title: server.title || server.name,
    description: server.description || "",
    websiteUrl: server.websiteUrl || null,
    repositoryUrl: server.repositoryUrl || null,
    status: server.status || "unknown",
    version: server.version || null,
    firstSeenAt: existing?.first_seen_at || now,
    lastSeenAt: now,
    publishedAt: server.publishedAt || null,
    updatedAt: server.updatedAt || server.github?.updatedAt || null,
    qualityScore: server.qualityScore || 0,
    trustScore: server.trustScore || 0,
    installFriction: server.installFriction || "unknown",
    authRequired: server.authRequired ? 1 : 0,
    registryPresent: server.registryPresent ? 1 : 0,
    githubStars: server.github?.stars || server.githubStars || 0,
    githubForks: server.github?.forks || server.githubForks || 0,
    githubOpenIssues: server.github?.openIssues || server.githubOpenIssues || 0,
    githubPushedAt: server.github?.pushedAt || server.githubPushedAt || null,
    metadataJson: JSON.stringify(server.metadata || server)
  });

  const row = db.prepare("SELECT * FROM mcp_servers WHERE canonical_name = ?").get(server.name);
  replaceCategories(db, row.id, server.categories || ["general"]);
  replaceInstallOptions(db, row.id, server);
  return row;
}

export function upsertMention(db, mention) {
  const source = upsertSource(db, mention.source);
  const serverId = mention.serverName ? db.prepare("SELECT id FROM mcp_servers WHERE canonical_name = ?").get(mention.serverName)?.id : null;
  db.prepare(`
    INSERT INTO mentions (server_id, source_id, source_type, external_id, url, title, text, author, score, created_at, discovered_at, metadata_json)
    VALUES (@serverId, @sourceId, @sourceType, @externalId, @url, @title, @text, @author, @score, @createdAt, @discoveredAt, @metadataJson)
    ON CONFLICT(source_id, COALESCE(external_id, ''), COALESCE(url, '')) DO UPDATE SET
      server_id = COALESCE(excluded.server_id, mentions.server_id),
      title = excluded.title,
      text = excluded.text,
      author = excluded.author,
      score = excluded.score,
      created_at = excluded.created_at,
      discovered_at = excluded.discovered_at,
      metadata_json = excluded.metadata_json
  `).run({
    serverId: serverId || null,
    sourceId: source.id,
    sourceType: mention.source.type,
    externalId: mention.externalId || null,
    url: mention.url || null,
    title: mention.title || "",
    text: mention.text || "",
    author: mention.author || null,
    score: mention.score || 0,
    createdAt: mention.createdAt || null,
    discoveredAt: new Date().toISOString(),
    metadataJson: JSON.stringify(mention.metadata || {})
  });
}

export function upsertRawCandidate(db, candidate) {
  const source = upsertSource(db, candidate.source);
  db.prepare(`
    INSERT INTO raw_candidates (source_id, url, title, text, extracted_name, confidence, processed_at, discovered_at, metadata_json)
    VALUES (@sourceId, @url, @title, @text, @extractedName, @confidence, @processedAt, @discoveredAt, @metadataJson)
    ON CONFLICT(source_id, COALESCE(url, ''), COALESCE(title, '')) DO UPDATE SET
      text = excluded.text,
      extracted_name = excluded.extracted_name,
      confidence = excluded.confidence,
      processed_at = excluded.processed_at,
      metadata_json = excluded.metadata_json
  `).run({
    sourceId: source.id,
    url: candidate.url || null,
    title: candidate.title || "",
    text: candidate.text || "",
    extractedName: candidate.extractedName || null,
    confidence: candidate.confidence || 0,
    processedAt: candidate.processedAt || null,
    discoveredAt: new Date().toISOString(),
    metadataJson: JSON.stringify(candidate.metadata || {})
  });
}

export function getStats(db) {
  return {
    servers: db.prepare("SELECT COUNT(*) AS count FROM mcp_servers").get().count,
    mentions: db.prepare("SELECT COUNT(*) AS count FROM mentions").get().count,
    candidates: db.prepare("SELECT COUNT(*) AS count FROM raw_candidates").get().count,
    sources: db.prepare("SELECT COUNT(*) AS count FROM sources").get().count,
    lastSyncedAt: db.prepare("SELECT MAX(last_synced_at) AS value FROM sources").get().value
  };
}

export function searchServers(db, { query = "", category = "all", installType = "all", auth = "any", limit = 30 } = {}) {
  const q = query.trim().toLowerCase();
  const rows = db.prepare(`
    SELECT s.*,
      GROUP_CONCAT(DISTINCT c.name) AS categories,
      GROUP_CONCAT(DISTINCT io.type) AS install_types,
      COUNT(DISTINCT m.id) AS mention_count,
      COALESCE(SUM(m.score), 0) AS mention_score
    FROM mcp_servers s
    LEFT JOIN server_categories sc ON sc.server_id = s.id
    LEFT JOIN categories c ON c.id = sc.category_id
    LEFT JOIN install_options io ON io.server_id = s.id
    LEFT JOIN mentions m ON m.server_id = s.id
    GROUP BY s.id
  `).all();

  return rows
    .map(hydrateServerRow)
    .filter((server) => category === "all" || server.categories.includes(category))
    .filter((server) => installType === "all" || server.installTypes.includes(installType))
    .filter((server) => auth !== "required" || server.authRequired)
    .filter((server) => auth !== "none" || !server.authRequired)
    .map((server) => ({ server, score: scoreSearch(server, q) }))
    .filter((result) => !q || result.score > 0)
    .sort((a, b) => b.score - a.score || b.server.qualityScore - a.server.qualityScore)
    .slice(0, Number(limit))
    .map(({ server, score }) => ({ ...server, fitScore: score }));
}

export function getTrendingServers(db, { days = 14, limit = 30 } = {}) {
  const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
  return db.prepare(`
    SELECT s.*,
      GROUP_CONCAT(DISTINCT c.name) AS categories,
      GROUP_CONCAT(DISTINCT io.type) AS install_types,
      COUNT(DISTINCT m.id) AS mention_count,
      COALESCE(SUM(m.score), 0) AS mention_score
    FROM mcp_servers s
    LEFT JOIN server_categories sc ON sc.server_id = s.id
    LEFT JOIN categories c ON c.id = sc.category_id
    LEFT JOIN install_options io ON io.server_id = s.id
    LEFT JOIN mentions m ON m.server_id = s.id AND COALESCE(m.created_at, m.discovered_at) >= ?
    GROUP BY s.id
    ORDER BY (COUNT(DISTINCT m.id) * 20 + COALESCE(SUM(m.score), 0) + s.quality_score + s.github_stars / 10) DESC
    LIMIT ?
  `).all(since, Number(limit)).map(hydrateServerRow);
}

export function getUnregisteredCandidates(db, { limit = 50 } = {}) {
  const serverCandidates = db.prepare(`
    SELECT srv.*, GROUP_CONCAT(DISTINCT c.name) AS categories, GROUP_CONCAT(DISTINCT io.type) AS install_types,
      0 AS mention_count, 0 AS mention_score
    FROM mcp_servers srv
    LEFT JOIN server_categories sc ON sc.server_id = srv.id
    LEFT JOIN categories c ON c.id = sc.category_id
    LEFT JOIN install_options io ON io.server_id = srv.id
    WHERE srv.registry_present = 0
    GROUP BY srv.id
    ORDER BY srv.quality_score DESC, srv.updated_at DESC
    LIMIT ?
  `).all(Number(limit)).map((row) => {
    const server = hydrateServerRow(row);
    delete server.metadata;
    return { ...server, source_name: "candidate-server", confidence: row.quality_score };
  });
  if (serverCandidates.length) return serverCandidates;
  return db.prepare(`
    SELECT rc.id, rc.url, rc.title, rc.text, rc.extracted_name, rc.confidence, rc.processed_at, rc.discovered_at,
      s.name AS source_name, s.type AS source_type
    FROM raw_candidates rc
    JOIN sources s ON s.id = rc.source_id
    ORDER BY rc.confidence DESC, rc.discovered_at DESC
    LIMIT ?
  `).all(Number(limit));
}

export function getRecentMentions(db, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT m.id, m.server_id, m.source_id, m.source_type, m.external_id, m.url, m.title, m.text, m.author, m.score,
      m.created_at, m.discovered_at, s.name AS source_name, srv.canonical_name AS server_name
    FROM mentions m
    JOIN sources s ON s.id = m.source_id
    LEFT JOIN mcp_servers srv ON srv.id = m.server_id
    ORDER BY COALESCE(m.created_at, m.discovered_at) DESC
    LIMIT ?
  `).all(Number(limit));
}

export function listDbCategories(db) {
  return db.prepare(`
    SELECT c.name, COUNT(sc.server_id) AS count
    FROM categories c
    JOIN server_categories sc ON sc.category_id = c.id
    GROUP BY c.id
    ORDER BY count DESC, c.name ASC
  `).all();
}

function replaceCategories(db, serverId, categories) {
  db.prepare("DELETE FROM server_categories WHERE server_id = ?").run(serverId);
  const insertCategory = db.prepare("INSERT INTO categories (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
  const getCategory = db.prepare("SELECT id FROM categories WHERE name = ?");
  const insertLink = db.prepare("INSERT OR IGNORE INTO server_categories (server_id, category_id) VALUES (?, ?)");
  for (const category of categories) {
    insertCategory.run(category);
    insertLink.run(serverId, getCategory.get(category).id);
  }
}

function replaceInstallOptions(db, serverId, server) {
  db.prepare("DELETE FROM install_options WHERE server_id = ?").run(serverId);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO install_options (server_id, type, package_name, command, transport, url, auth_required, metadata_json)
    VALUES (@serverId, @type, @packageName, @command, @transport, @url, @authRequired, @metadataJson)
  `);
  for (const pkg of server.packages || []) {
    insert.run({
      serverId,
      type: pkg.registryType || pkg.transport || "package",
      packageName: pkg.packageName || null,
      command: pkg.registryType === "npm" ? "npx" : pkg.registryType === "pypi" ? "uvx" : null,
      transport: pkg.transport || null,
      url: null,
      authRequired: pkg.authRequired ? 1 : 0,
      metadataJson: JSON.stringify(pkg)
    });
  }
  for (const remote of server.remotes || []) {
    insert.run({
      serverId,
      type: "remote",
      packageName: null,
      command: null,
      transport: remote.type || null,
      url: remote.url || null,
      authRequired: remote.authRequired ? 1 : 0,
      metadataJson: JSON.stringify(remote)
    });
  }
}

function hydrateServerRow(row) {
  const metadata = parseJson(row.metadata_json);
  return {
    id: row.id,
    name: row.canonical_name,
    title: row.title,
    description: row.description || "",
    websiteUrl: row.website_url,
    repositoryUrl: row.repository_url,
    status: row.status,
    version: row.version,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    qualityScore: row.quality_score,
    trustScore: row.trust_score,
    installFriction: row.install_friction,
    scores: { fit: row.quality_score, quality: row.quality_score, trust: row.trust_score },
    authRequired: Boolean(row.auth_required),
    registryPresent: Boolean(row.registry_present),
    githubStars: row.github_stars,
    githubForks: row.github_forks,
    githubOpenIssues: row.github_open_issues,
    githubPushedAt: row.github_pushed_at,
    mentionCount: row.mention_count || 0,
    mentionScore: row.mention_score || 0,
    categories: row.categories ? row.categories.split(",") : metadata.categories || ["general"],
    installTypes: row.install_types ? row.install_types.split(",") : metadata.installTypes || ["unknown"],
    installRecipes: metadata.installRecipes || []
  };
}

function scoreSearch(server, query) {
  if (!query) return server.qualityScore + server.mentionCount * 5;
  const tokens = query.split(/\s+/).filter(Boolean);
  const weighted = [
    [server.title, 8],
    [server.name, 7],
    [server.categories.join(" "), 5],
    [server.description, 4],
    [server.repositoryUrl || "", 2],
    [server.websiteUrl || "", 1]
  ];
  return tokens.reduce((score, token) => score + weighted.reduce((inner, [value, weight]) => inner + (String(value || "").toLowerCase().includes(token) ? weight : 0), 0), 0) + Math.round(server.qualityScore / 10) + server.mentionCount * 2;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
