const state = { categories: [], results: [], latest: [] };
const elements = {
  syncButton: document.querySelector("#syncButton"),
  ingestButton: document.querySelector("#ingestButton"),
  enrichButton: document.querySelector("#enrichButton"),
  searchButton: document.querySelector("#searchButton"),
  recommendButton: document.querySelector("#recommendButton"),
  digestButton: document.querySelector("#digestButton"),
  sourcesButton: document.querySelector("#sourcesButton"),
  queryInput: document.querySelector("#queryInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  installFilter: document.querySelector("#installFilter"),
  authFilter: document.querySelector("#authFilter"),
  totalCount: document.querySelector("#totalCount"),
  mentionCount: document.querySelector("#mentionCount"),
  candidateCount: document.querySelector("#candidateCount"),
  syncedAt: document.querySelector("#syncedAt"),
  resultCount: document.querySelector("#resultCount"),
  results: document.querySelector("#results"),
  databaseModeButton: document.querySelector("#databaseModeButton"),
  trendingButton: document.querySelector("#trendingButton"),
  candidatesButton: document.querySelector("#candidatesButton"),
  mentionsButton: document.querySelector("#mentionsButton"),
  latestList: document.querySelector("#latestList"),
  digestOutput: document.querySelector("#digestOutput"),
  sourcesList: document.querySelector("#sourcesList"),
  cardTemplate: document.querySelector("#cardTemplate"),
  mentionTemplate: document.querySelector("#mentionTemplate")
};

elements.syncButton.addEventListener("click", syncRegistry);
elements.ingestButton.addEventListener("click", ingestAllSources);
elements.enrichButton.addEventListener("click", enrichGitHub);
elements.searchButton.addEventListener("click", runSearch);
elements.recommendButton.addEventListener("click", runRecommend);
elements.digestButton.addEventListener("click", generateDigest);
elements.sourcesButton.addEventListener("click", loadSources);
elements.databaseModeButton.addEventListener("click", runSearch);
elements.trendingButton.addEventListener("click", showTrending);
elements.candidatesButton.addEventListener("click", showCandidates);
elements.mentionsButton.addEventListener("click", showMentions);
elements.queryInput.addEventListener("keydown", (event) => { if (event.key === "Enter") runSearch(); });
for (const filter of [elements.categoryFilter, elements.installFilter, elements.authFilter]) filter.addEventListener("change", runSearch);

await bootstrap();

async function bootstrap() {
  await refreshStatus();
  await refreshCategories();
  await Promise.all([runSearch(), refreshLatest()]);
}

async function refreshStatus() {
  const status = await getJson("/api/status");
  elements.totalCount.textContent = status.total || 0;
  elements.mentionCount.textContent = status.database?.mentions || 0;
  elements.candidateCount.textContent = status.database?.candidates || 0;
  elements.syncedAt.textContent = status.syncedAt ? new Date(status.syncedAt).toLocaleString() : "Never";
}

async function refreshCategories() {
  state.categories = await getJson("/api/categories");
  elements.categoryFilter.querySelectorAll("option:not([value='all'])").forEach((option) => option.remove());
  for (const category of state.categories) {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = `${category.name} (${category.count})`;
    elements.categoryFilter.append(option);
  }
}

async function syncRegistry() {
  elements.syncButton.disabled = true;
  elements.syncButton.textContent = "Syncing...";
  try { await fetch("/api/sync", { method: "POST" }).then(assertOk); await bootstrap(); }
  finally { elements.syncButton.disabled = false; elements.syncButton.textContent = "Sync Registry"; }
}

async function ingestAllSources() {
  elements.ingestButton.disabled = true;
  elements.ingestButton.textContent = "Ingesting...";
  try {
    await fetch("/api/ingest", { method: "POST" }).then(assertOk);
    await bootstrap();
  } finally {
    elements.ingestButton.disabled = false;
    elements.ingestButton.textContent = "Ingest All";
  }
}

async function enrichGitHub() {
  elements.enrichButton.disabled = true;
  elements.enrichButton.textContent = "Enriching...";
  try { await fetch("/api/enrich/github?maxRepos=40", { method: "POST" }).then(assertOk); await bootstrap(); }
  finally { elements.enrichButton.disabled = false; elements.enrichButton.textContent = "Enrich GitHub"; }
}

async function runSearch() {
  setMode(elements.databaseModeButton);
  const params = new URLSearchParams({ query: elements.queryInput.value, category: elements.categoryFilter.value, installType: elements.installFilter.value, auth: elements.authFilter.value, limit: "40" });
  state.results = await getJson(`/api/db/search?${params}`);
  renderResults();
}

async function runRecommend() {
  const task = elements.queryInput.value.trim();
  if (!task) return runSearch();
  state.results = await getJson(`/api/recommend?${new URLSearchParams({ task })}`);
  renderResults();
}

async function showTrending() {
  setMode(elements.trendingButton);
  state.results = await getJson("/api/db/trending?days=14&limit=40");
  renderResults();
}

async function showCandidates() {
  setMode(elements.candidatesButton);
  const candidates = await getJson("/api/db/candidates?limit=50");
  renderMentions(candidates.map((item) => ({
    title: item.title || item.extracted_name || "Candidate",
    text: item.text || item.extracted_name || "",
    source: item.source_name,
    url: item.url,
    score: item.confidence,
    created_at: item.discovered_at
  })), "candidates");
}

async function showMentions() {
  setMode(elements.mentionsButton);
  const mentions = await getJson("/api/db/mentions?limit=50");
  renderMentions(mentions.map((item) => ({
    title: item.title || "Mention",
    text: item.text || "",
    source: item.source_name,
    url: item.url,
    score: item.score,
    created_at: item.created_at || item.discovered_at
  })), "mentions");
}

async function refreshLatest() {
  state.latest = await getJson("/api/latest?days=30&limit=12");
  renderLatest();
}

async function generateDigest() {
  const digest = await getJson("/api/digest?days=7&limit=10");
  elements.digestOutput.textContent = digest.markdown;
}

async function loadSources() {
  const sources = await getJson("/api/sources");
  elements.sourcesList.replaceChildren();
  for (const source of sources) {
    const item = document.createElement("div");
    item.className = "source-item";
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = source.name;
    const meta = document.createElement("p");
    meta.textContent = `${source.priority} | ${source.note}`;
    item.append(link, meta);
    elements.sourcesList.append(item);
  }
}

function renderResults() {
  elements.results.replaceChildren();
  elements.resultCount.textContent = `${state.results.length} found`;
  if (!state.results.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No MCPs found. Sync the registry or try a broader query.";
    elements.results.append(empty);
    return;
  }
  for (const server of state.results) elements.results.append(renderCard(server));
}

function renderMentions(items, label) {
  elements.results.replaceChildren();
  elements.resultCount.textContent = `${items.length} ${label}`;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = `No ${label} found yet. Run Ingest All first.`;
    elements.results.append(empty);
    return;
  }
  for (const item of items) {
    const node = elements.mentionTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = item.title;
    node.querySelector(".description").textContent = stripHtml(item.text || "No text available.").slice(0, 450);
    node.querySelector(".meta-row").textContent = `${item.source || "source"} | score ${item.score || 0} | ${formatDate(item.created_at)}`;
    addLink(node.querySelector(".link-row"), item.url, "Open");
    elements.results.append(node);
  }
}

function renderCard(server) {
  const node = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("h3").textContent = server.title;
  node.querySelector(".name").textContent = server.name;
  node.querySelector(".description").textContent = server.description || "No description available.";
  const auth = node.querySelector(".auth-pill");
  auth.textContent = server.authRequired ? "Auth required" : "Low friction";
  auth.classList.add(server.authRequired ? "required" : "open");
  const scoreGrid = node.querySelector(".score-grid");
  const risk = server.riskReport || {};
  for (const [label, value] of [["Risk", risk.level || "-"], ["Quality", server.qualityScore ?? "-"], ["Trust", server.trustScore ?? "-"], ["Install", server.installFriction || "-"]]) {
    const score = document.createElement("div");
    score.className = "score";
    score.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    scoreGrid.append(score);
  }
  const tagRow = node.querySelector(".tag-row");
  for (const value of [...server.categories, ...server.installTypes]) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = value;
    tagRow.append(tag);
  }
  node.querySelector(".meta-row").textContent = `Version ${server.version || "unknown"} | updated ${formatDate(server.updatedAt)} | published ${formatDate(server.publishedAt)}`;
  const linkRow = node.querySelector(".link-row");
  addLink(linkRow, server.repositoryUrl, "Repository");
  addLink(linkRow, server.websiteUrl, "Website");
  if (server.remotes?.[0]?.url) addLink(linkRow, server.remotes[0].url, "Remote endpoint");

  renderRiskReport(node.querySelector(".risk-report"), server);

  const recipes = node.querySelector(".recipes");
  if (!server.installRecipes?.length) {
    const empty = document.createElement("p");
    empty.className = "name";
    empty.textContent = "No install recipe detected yet.";
    recipes.append(empty);
  } else {
    for (const recipe of server.installRecipes.slice(0, 3)) {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="recipe-label"></div><pre class="recipe-code"></pre>`;
      wrap.querySelector(".recipe-label").textContent = `${recipe.client} | ${recipe.label}`;
      wrap.querySelector(".recipe-code").textContent = typeof recipe.config === "string" ? recipe.config : JSON.stringify(recipe.config, null, 2);
      recipes.append(wrap);
    }
  }
  return node;
}

function renderRiskReport(container, server) {
  const report = server.riskReport;
  if (!report) {
    container.textContent = "No risk report available yet. Run database ingestion first.";
    return;
  }

  const head = document.createElement("div");
  head.className = "risk-head";
  const level = document.createElement("span");
  level.className = `risk-level risk-${report.level}`;
  level.textContent = report.level;
  const score = document.createElement("span");
  score.className = "risk-score";
  score.textContent = `${report.riskScore}/100 risk`;
  head.append(level, score);

  const summary = document.createElement("p");
  summary.className = "risk-summary";
  summary.textContent = report.summary;

  const access = document.createElement("ul");
  access.className = "risk-list";
  for (const item of report.access || []) {
    const li = document.createElement("li");
    li.textContent = item;
    access.append(li);
  }

  const flags = document.createElement("ul");
  flags.className = "risk-list";
  for (const item of (report.flags || []).slice(0, 5)) {
    const li = document.createElement("li");
    li.className = "risk-flag";
    const strong = document.createElement("strong");
    strong.textContent = `${item.severity}: ${item.title}`;
    li.append(strong, document.createTextNode(` — ${item.description}`));
    flags.append(li);
  }

  const recommendation = document.createElement("p");
  recommendation.className = "risk-recommendation";
  recommendation.textContent = report.recommendation;

  container.append(head, summary, labelNode("Access hints"), access, labelNode("Flags"), flags, labelNode("Recommendation"), recommendation);
}

function labelNode(text) {
  const label = document.createElement("div");
  label.className = "recipe-label";
  label.textContent = text;
  return label;
}

function renderLatest() {
  elements.latestList.replaceChildren();
  if (!state.latest.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No recent MCPs found in the local index.";
    elements.latestList.append(empty);
    return;
  }
  for (const server of state.latest) {
    const item = document.createElement("div");
    item.className = "latest-item";
    const button = document.createElement("button");
    button.textContent = server.title;
    button.addEventListener("click", () => { elements.queryInput.value = server.name; runSearch(); });
    const meta = document.createElement("p");
    meta.textContent = `${server.categories.slice(0, 2).join(", ")} | ${formatDate(server.publishedAt || server.updatedAt)}`;
    item.append(button, meta);
    elements.latestList.append(item);
  }
}

function addLink(container, url, label) {
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  container.append(link);
}

function setMode(active) {
  for (const button of [elements.databaseModeButton, elements.trendingButton, elements.candidatesButton, elements.mentionsButton]) button.classList.remove("active-mode");
  active.classList.add("active-mode");
}

async function getJson(url) {
  const response = await fetch(url);
  await assertOk(response);
  return response.json();
}

async function assertOk(response) {
  if (!response.ok) throw new Error(await response.text() || response.statusText);
  return response;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "unknown";
}

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = value;
  return div.textContent || div.innerText || "";
}
