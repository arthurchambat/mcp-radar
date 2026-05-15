# LinkedIn Launch Post

I built MCP Radar: a local discovery layer for Model Context Protocol servers.

MCPs are becoming the way AI tools connect to the rest of your stack, but discovery is still messy. Servers launch across GitHub, directories, Discord, LinkedIn, and product docs. It is hard to answer basic questions:

- What MCPs came out this week?
- Which one fits my workflow?
- Does it require auth?
- Is it maintained?
- How do I install it in Claude or Codex?

MCP Radar tries to make that easier.

It syncs the official MCP Registry, builds a local searchable index, scores servers by quality/trust/install friction, generates Claude/Codex install recipes, and creates a weekly digest of new MCPs.

Example prompts:

- "Find an MCP for GitHub issue triage."
- "Recommend a low-friction MCP for Postgres."
- "What new MCPs launched this week?"
- "Compare these MCPs before I install one."

The goal is simple: make MCP discovery feel less like scrolling random repos and more like choosing infrastructure.

Open-source repo: [link]

Curious what MCP categories people care about most: devtools, GTM, data, support, or personal productivity?
