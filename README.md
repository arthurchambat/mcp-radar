# MCP Radar

**Discover, compare, and install MCP servers before you trust them with your tools.**

MCP Radar is a local discovery layer for Model Context Protocol servers. It syncs the official MCP Registry, builds a searchable index, scores servers by fit/trust/install friction, generates install recipes, and creates a weekly digest of new MCPs.

It also includes a SQLite database mode that ingests:

- official MCP Registry servers
- GitHub MCP topic repositories
- npm MCP package candidates
- Hacker News mentions
- Reddit mentions

## What You Can Ask

- "What new MCPs came out this week?"
- "Find an MCP for Google Ads reporting."
- "Recommend a low-friction MCP for Postgres."
- "Compare these three MCPs before I install one."
- "Generate this week's MCP launch digest."
- "Give me the Claude Desktop and Codex install recipe for this MCP."

## Screenshots

Add screenshots under `docs/assets/` before publishing.

Recommended shots:

- Search results with scores visible
- Install recipes expanded on an MCP card
- Weekly digest panel
- Source list showing official registry and discovery hooks

## Why This Exists

MCP discovery is fragmented. Builders hear about servers on GitHub, LinkedIn, Discord, directories, and docs, but it is hard to know what exists, what is new, how it installs, and whether it needs credentials.

MCP Radar starts with the official MCP Registry and turns it into a practical local discovery layer.

## Quick Start

```bash
npm install
npm run sync
npm run ingest
npm run enrich:github
npm run ui
```

Open:

```text
http://127.0.0.1:8787
```

## Environment

```bash
cp .env.example .env
```

Supported variables:

- `GITHUB_TOKEN`: optional, raises GitHub API limits for enrichment and discovery.
- `PORT`: optional, changes the local UI port.
- `MCP_RADAR_REGISTRY_URL`: optional, overrides the registry endpoint.

## Install Into Claude Desktop

```bash
npm run install:claude
```

Restart Claude Desktop, then ask:

```text
Use MCP Radar to find an MCP for GitHub issue triage.
```

## Install Into Codex

```bash
npm run install:codex
```

Restart Codex, then ask:

```text
Use MCP Radar to show me the newest database-related MCPs.
```

## Manual MCP Config

```bash
npm run print-config
```

## MCP Tools

- `sync_mcp_registry` refreshes the local index from the official registry.
- `ingest_mcp_sources` fills the SQLite database from registry, GitHub, npm, Hacker News, and Reddit.
- `ingest_one_source` refreshes a single source.
- `enrich_mcp_github_metadata` adds stars, forks, open issues, license, and push recency where GitHub metadata is available.
- `search_mcps` searches by app, use case, category, install type, or auth friction.
- `search_mcp_database` searches the larger SQLite database.
- `get_trending_mcps` ranks servers by mentions, quality, GitHub signals, and recency.
- `get_unregistered_mcp_candidates` shows candidates found outside the official registry.
- `get_mcp_mentions` lists recent Reddit/Hacker News mentions.
- `get_mcp_database_stats` returns database counts.
- `find_latest_mcps` lists recently published MCPs.
- `recommend_mcp_for_task` turns a plain-language task into a shortlist.
- `generate_mcp_digest` creates a Markdown weekly digest with top picks and a LinkedIn draft.
- `discover_mcp_sources` lists discovery sources and can fetch fresh GitHub topic candidates.
- `get_mcp_details` returns install, auth, repo, and remote endpoint details.
- `list_mcp_categories` shows inferred categories with counts.
- `compare_mcps` compares multiple servers side by side.

## Scoring

Each indexed MCP gets:

- `fitScore`: fit for the current search or recommendation task.
- `qualityScore`: completeness, recency, install options, and registry status.
- `trustScore`: source links, registry status, and optional GitHub metadata.
- `installFriction`: `low`, `medium`, or `high`.

GitHub enrichment is capped by default because unauthenticated GitHub API calls are rate-limited.

## CLI

```bash
npm run sync
npm run ingest
npm run db:search -- "postgres"
npm run trending
npm run candidates
npm run mentions
npm run stats
npm run enrich:github
npm run search -- "ads reporting"
node src/cli.js latest
npm run digest
npm run discover:github
npm run demo
```

## Data Sources

MVP source:

```text
https://registry.modelcontextprotocol.io/v0/servers
```

Additional source hooks:

- GitHub topic search for `model-context-protocol`
- GitHub topic search for `mcp-server`
- npm registry search for installable package candidates
- Hacker News search for launch/technical discussion mentions
- Reddit search for builder demand signals
- Smithery, Glama, and PulseMCP listed as future directory integrations pending API and usage review

## Database Model

MCP Radar separates confirmed servers from noisy discovery signals:

- `mcp_servers`: normalized server records.
- `install_options`: npm, PyPI, stdio, and remote install paths.
- `mentions`: Reddit/Hacker News/social proof and demand signals.
- `raw_candidates`: possible MCPs found outside the official registry.
- `sources`: ingestion source metadata and sync timestamps.

## Example LinkedIn Post

```text
I built MCP Radar: a local discovery layer for Model Context Protocol servers.

MCPs are becoming the way AI tools connect to the rest of your stack, but discovery is still messy. Servers launch across GitHub, directories, Discord, LinkedIn, and product docs.

MCP Radar syncs the official MCP Registry, builds a searchable local index, scores servers by quality/trust/install friction, generates Claude/Codex install recipes, and creates a weekly digest of new MCPs.

The goal is simple: make MCP discovery feel less like scrolling random repos and more like choosing infrastructure.
```

## Product Direction

- saved shortlists for "tools to try"
- daily diff of new MCPs
- deeper quality signals from releases, README content, and last commit
- category pages for builders, GTM, support, data, local tools
- install recipes for Cursor, Windsurf, and other MCP clients
- alerts when new MCPs match a saved interest

## License

MIT
