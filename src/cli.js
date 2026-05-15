#!/usr/bin/env node
import { discoverFromGitHubTopics, enrichIndexWithGitHub, generateWeeklyDigest, latestMcps, loadIndex, searchMcps, syncOfficialRegistry } from "./registry.js";

const [command, ...args] = process.argv.slice(2);

if (command === "sync") {
  const index = await syncOfficialRegistry();
  console.log(`Synced ${index.total} MCP servers from the official registry.`);
} else if (command === "search") {
  printResults(searchMcps(await loadIndex(), { query: args.join(" "), limit: 10 }));
} else if (command === "latest") {
  printResults(latestMcps(await loadIndex(), { days: 30, limit: 10 }));
} else if (command === "digest") {
  console.log(generateWeeklyDigest(await loadIndex(), { days: 7, limit: 10 }).markdown);
} else if (command === "enrich-github") {
  const result = await enrichIndexWithGitHub({ maxRepos: Number(args[0] || 40) });
  console.log(`Enriched ${result.enriched} MCPs with GitHub metadata.`);
} else if (command === "discover-github") {
  console.log(JSON.stringify(await discoverFromGitHubTopics({ perPage: Number(args[0] || 10) }), null, 2));
} else {
  console.log("Usage: npm run sync | npm run search -- \"postgres\" | npm run digest | npm run enrich:github");
}

function printResults(results) {
  if (!results.length) {
    console.log("No MCPs found. Run `npm run sync` first or try a broader query.");
    return;
  }
  for (const server of results) {
    console.log(`\n${server.title}`);
    console.log(`  name: ${server.name}`);
    console.log(`  categories: ${server.categories.join(", ")}`);
    console.log(`  install: ${server.installTypes.join(", ")}${server.authRequired ? " | auth required" : ""}`);
    console.log(`  scores: fit ${server.scores?.fit ?? "-"} | quality ${server.qualityScore ?? "-"} | trust ${server.trustScore ?? "-"} | install ${server.installFriction ?? "-"}`);
    console.log(`  updated: ${server.updatedAt || "unknown"}`);
    if (server.repositoryUrl) console.log(`  repo: ${server.repositoryUrl}`);
    if (server.websiteUrl) console.log(`  web: ${server.websiteUrl}`);
    if (server.description) console.log(`  ${server.description}`);
  }
}
