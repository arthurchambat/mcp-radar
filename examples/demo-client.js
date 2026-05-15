import { latestMcps, loadIndex, recommendForTask, searchMcps, syncOfficialRegistry } from "../src/registry.js";

let index = await loadIndex();
if (!index.total) index = await syncOfficialRegistry({ limit: 100, maxPages: 5 });

console.log(`Indexed MCPs: ${index.total}`);
console.log("\nSearch: github issues");
console.log(searchMcps(index, { query: "github issues", limit: 3 }).map(format));
console.log("\nRecommendations: ads reporting campaign analysis");
console.log(recommendForTask(index, { task: "ads reporting campaign analysis", limit: 3 }).map(format));
console.log("\nLatest MCPs");
console.log(latestMcps(index, { days: 30, limit: 5 }).map(format));

function format(server) {
  return { title: server.title, name: server.name, qualityScore: server.qualityScore, installFriction: server.installFriction, categories: server.categories, url: server.repositoryUrl || server.websiteUrl || server.remotes?.[0]?.url || null };
}
