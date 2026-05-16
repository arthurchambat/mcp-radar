import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { categorySearchText, inferCategoriesFromText } from "./taxonomy.js";

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

    CREATE VIRTUAL TABLE IF NOT EXISTS mcp_server_fts USING fts5(
      server_id UNINDEXED,
      name,
      title,
      description,
      categories,
      install_types,
      repository_url,
      website_url,
      tokenize = 'porter unicode61'
    );
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
  refreshServerFts(db, row.id);
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
  const fallbackRows = () => db.prepare(`
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
  const ftsRows = q ? searchServersFts(db, q, { limit: Math.max(Number(limit) * 8, 120) }) : [];
  const rows = q && ftsRows.length ? ftsRows : fallbackRows();

  return rows
    .map(hydrateServerRow)
    .filter((server) => category === "all" || server.categories.includes(category))
    .filter((server) => installType === "all" || server.installTypes.includes(installType))
    .filter((server) => auth !== "required" || server.authRequired)
    .filter((server) => auth !== "none" || !server.authRequired)
    .map((server) => ({ server, score: (server.ftsScore || 0) + scoreSearch(server, q) }))
    .filter((result) => !q || result.score > 0)
    .sort((a, b) => b.score - a.score || b.server.qualityScore - a.server.qualityScore)
    .slice(0, Number(limit))
    .map(({ server, score }) => ({ ...server, fitScore: score }));
}

export function rebuildSearchIndex(db) {
  db.prepare("DELETE FROM mcp_server_fts").run();
  const rows = db.prepare("SELECT id FROM mcp_servers").all();
  const write = db.transaction((items) => {
    for (const row of items) refreshServerFts(db, row.id);
  });
  write(rows);
  return { indexed: rows.length };
}

export function reclassifyServers(db) {
  const rows = db.prepare(`
    SELECT s.id, s.canonical_name, s.title, s.description, s.repository_url, s.website_url,
      GROUP_CONCAT(DISTINCT io.type || ' ' || COALESCE(io.package_name, '') || ' ' || COALESCE(io.url, '')) AS install_text
    FROM mcp_servers s
    LEFT JOIN install_options io ON io.server_id = s.id
    GROUP BY s.id
  `).all();
  const write = db.transaction((items) => {
    for (const row of items) {
      replaceCategories(db, row.id, inferCategoriesFromText(
        row.canonical_name,
        row.title,
        row.description,
        row.repository_url,
        row.website_url,
        row.install_text
      ));
      refreshServerFts(db, row.id);
    }
  });
  write(rows);
  return { reclassified: rows.length };
}

export function getRiskReport(db, { name }) {
  const target = String(name || "").toLowerCase();
  const row = db.prepare(`
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
    WHERE LOWER(s.canonical_name) = ? OR LOWER(s.title) = ?
    GROUP BY s.id
  `).get(target, target);
  if (!row) return null;
  return buildRiskReport(hydrateServerRow(row), parseJson(row.metadata_json));
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

function refreshServerFts(db, serverId) {
  const row = db.prepare(`
    SELECT s.canonical_name, s.title, s.description, s.repository_url, s.website_url,
      GROUP_CONCAT(DISTINCT c.name) AS categories,
      GROUP_CONCAT(DISTINCT io.type || ' ' || COALESCE(io.package_name, '') || ' ' || COALESCE(io.transport, '')) AS install_types
    FROM mcp_servers s
    LEFT JOIN server_categories sc ON sc.server_id = s.id
    LEFT JOIN categories c ON c.id = sc.category_id
    LEFT JOIN install_options io ON io.server_id = s.id
    WHERE s.id = ?
    GROUP BY s.id
  `).get(serverId);
  if (!row) return;
  db.prepare("DELETE FROM mcp_server_fts WHERE server_id = ?").run(serverId);
  db.prepare(`
    INSERT INTO mcp_server_fts (server_id, name, title, description, categories, install_types, repository_url, website_url)
    VALUES (@serverId, @name, @title, @description, @categories, @installTypes, @repositoryUrl, @websiteUrl)
  `).run({
    serverId,
    name: row.canonical_name || "",
    title: row.title || "",
    description: row.description || "",
    categories: `${row.categories || ""} ${categorySearchText((row.categories || "").split(",").filter(Boolean))}`,
    installTypes: row.install_types || "",
    repositoryUrl: row.repository_url || "",
    websiteUrl: row.website_url || ""
  });
}

function searchServersFts(db, query, { limit = 200 } = {}) {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  try {
    return db.prepare(`
      SELECT s.*,
        GROUP_CONCAT(DISTINCT c.name) AS categories,
        GROUP_CONCAT(DISTINCT io.type) AS install_types,
        COUNT(DISTINCT m.id) AS mention_count,
        COALESCE(SUM(m.score), 0) AS mention_score,
        MAX(80 - (bm25(mcp_server_fts) * 10)) AS fts_score
      FROM mcp_server_fts
      JOIN mcp_servers s ON s.id = mcp_server_fts.server_id
      LEFT JOIN server_categories sc ON sc.server_id = s.id
      LEFT JOIN categories c ON c.id = sc.category_id
      LEFT JOIN install_options io ON io.server_id = s.id
      LEFT JOIN mentions m ON m.server_id = s.id
      WHERE mcp_server_fts MATCH ?
      GROUP BY s.id
      ORDER BY bm25(mcp_server_fts), s.quality_score DESC
      LIMIT ?
    `).all(ftsQuery, Number(limit));
  } catch {
    return [];
  }
}

function hydrateServerRow(row) {
  const metadata = parseJson(row.metadata_json);
  const server = {
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
    ftsScore: Math.max(0, Math.round(row.fts_score || 0)),
    categories: row.categories ? row.categories.split(",") : metadata.categories || ["general"],
    installTypes: row.install_types ? row.install_types.split(",") : metadata.installTypes || ["unknown"],
    installRecipes: metadata.installRecipes || []
  };
  return { ...server, riskReport: buildRiskReport(server, metadata) };
}

function buildRiskReport(server, metadata = {}) {
  const text = `${server.name} ${server.title} ${server.description} ${server.categories.join(" ")}`.toLowerCase();
  const flags = [];
  const access = [];
  let risk = 28;

  if (server.installTypes.includes("remote")) {
    risk += 15;
    access.push("remote endpoint");
    flags.push(flag("remote-endpoint", "Remote MCP endpoint", "The MCP runs behind a remote URL. Review provider trust, data handling, and auth flow before sending sensitive context.", "medium"));
  }

  if (server.installTypes.includes("npm") || server.installTypes.includes("pypi") || server.installTypes.includes("oci")) {
    risk += 8;
    access.push("local package execution");
    flags.push(flag("local-package", "Local package execution", "Installing this MCP may execute package code on the user's machine.", "medium"));
  }

  if (server.authRequired) {
    risk += 12;
    access.push("credentials required");
    flags.push(flag("credentials", "Requires credentials", "The MCP likely needs API keys or account tokens. Avoid production credentials until verified.", "medium"));
  }

  const capabilityRules = [
    ["filesystem", /file|filesystem|folder|directory|local disk|read files|write files/, "Can access files", "The description suggests local file or filesystem access.", "high"],
    ["shell", /shell|terminal|command|execute|subprocess|cli|process/, "May run commands", "The description suggests command execution or CLI control.", "high"],
    ["database", /postgres|mysql|sqlite|database|sql|warehouse|redis|mongo/, "Database access", "The MCP may access databases or query structured data.", "high"],
    ["email-send", /send email|gmail|smtp|mailbox|inbox|email/, "Email access", "The MCP may access or act on email data.", "medium"],
    ["payments", /stripe|payment|invoice|billing|checkout|subscription/, "Payment or billing access", "The MCP may touch financial or billing systems.", "high"],
    ["browser", /browser|crawl|scrape|web automation|puppeteer|playwright/, "Browser or web automation", "The MCP may browse, scrape, or automate web sessions.", "medium"],
    ["write-actions", /create|update|delete|edit|write|modify|send|publish|deploy/, "Write-capable workflow", "The MCP description includes verbs that suggest changing external state.", "medium"]
  ];

  for (const [id, pattern, title, description, severity] of capabilityRules) {
    if (pattern.test(text)) {
      risk += severity === "high" ? 14 : 8;
      access.push(title.toLowerCase());
      flags.push(flag(id, title, description, severity));
    }
  }

  if (!server.registryPresent) {
    risk += 12;
    flags.push(flag("not-in-registry", "Not in official registry", "This candidate was found from GitHub/npm or another source, not the official MCP Registry.", "medium"));
  }

  if (!server.repositoryUrl) {
    risk += 10;
    flags.push(flag("no-repository", "No repository link", "No source repository was detected, which makes auditing harder.", "medium"));
  }

  if (server.githubPushedAt) {
    const ageDays = (Date.now() - new Date(server.githubPushedAt).getTime()) / 86400000;
    if (ageDays > 365) {
      risk += 12;
      flags.push(flag("stale-repo", "Repository looks stale", "GitHub push activity is more than a year old.", "medium"));
    } else if (ageDays <= 45) {
      risk -= 8;
    }
  }

  if (server.githubStars >= 100) risk -= 8;
  if (server.githubStars >= 1000) risk -= 8;
  if (server.registryPresent) risk -= 8;
  if (server.trustScore >= 80) risk -= 10;
  if (server.qualityScore >= 85) risk -= 6;

  const riskScore = clamp(Math.round(risk), 0, 100);
  const level = riskScore >= 70 ? "high" : riskScore >= 42 ? "medium" : "low";
  const uniqueAccess = [...new Set(access)];
  const summary = buildRiskSummary(level, server);

  return {
    level,
    riskScore,
    summary,
    recommendation: buildRiskRecommendation(level, server),
    access: uniqueAccess.length ? uniqueAccess : ["no sensitive access detected from metadata"],
    flags: dedupeFlags(flags),
    evidence: {
      registryPresent: server.registryPresent,
      installTypes: server.installTypes,
      authRequired: server.authRequired,
      repositoryUrl: server.repositoryUrl,
      websiteUrl: server.websiteUrl,
      githubStars: server.githubStars,
      githubPushedAt: server.githubPushedAt,
      qualityScore: server.qualityScore,
      trustScore: server.trustScore,
      mentionCount: server.mentionCount
    }
  };
}

function buildRiskSummary(level, server) {
  if (level === "high") return `${server.title} has high-risk access signals. Inspect it carefully before connecting credentials, local files, databases, payments, or production systems.`;
  if (level === "medium") return `${server.title} has some trust or access tradeoffs. It may be fine for testing, but review credentials, remote endpoints, and write actions first.`;
  return `${server.title} looks relatively low-risk from available metadata, but it has not been sandbox-verified by MCP Radar yet.`;
}

function buildRiskRecommendation(level, server) {
  if (level === "high") return "Use a throwaway account or local sandbox first. Do not connect production credentials until the MCP is manually verified.";
  if (level === "medium") return "Good candidate for controlled testing. Prefer least-privilege API keys and read-only scopes where possible.";
  if (server.registryPresent) return "Reasonable to try in a non-production environment. Still review the install command and requested credentials.";
  return "Promising candidate, but verify source and package ownership before installing.";
}

function flag(id, title, description, severity) {
  return { id, title, description, severity };
}

function dedupeFlags(flags) {
  const seen = new Set();
  return flags.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function scoreSearch(server, query) {
  if (!query) return server.qualityScore + server.mentionCount * 5;
  const tokens = searchTokens(query);
  const searchable = `${server.title} ${server.name} ${server.categories.join(" ")} ${server.description} ${server.repositoryUrl || ""} ${server.websiteUrl || ""}`.toLowerCase();
  const strongMatches = tokens.filter((token) => searchable.includes(token)).length;
  const weighted = [
    [server.title, 14],
    [server.name, 12],
    [server.categories.join(" "), 5],
    [server.description, 4],
    [server.repositoryUrl || "", 2],
    [server.websiteUrl || "", 1]
  ];
  return tokens.reduce((score, token) => score + weighted.reduce((inner, [value, weight]) => inner + (String(value || "").toLowerCase().includes(token) ? weight : 0), 0), 0)
    + strongMatches * 8
    + Math.round(server.qualityScore / 10)
    + server.mentionCount * 2;
}

function toFtsQuery(query) {
  const tokens = searchTokens(query)
    .slice(0, 12);
  return tokens.map((token) => `${token.replace(/"/g, "")}*`).join(" OR ");
}

function searchTokens(query) {
  const stopWords = new Set(["a", "an", "and", "are", "as", "for", "find", "i", "in", "me", "need", "of", "or", "safe", "show", "the", "to", "up", "with"]);
  return query
    .toLowerCase()
    .replace(/[^a-z0-9@/_-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopWords.has(token))
    .slice(0, 12);
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
