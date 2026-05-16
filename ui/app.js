const state = { results: [] };

const elements = {
  searchForm: document.querySelector("#searchForm"),
  queryInput: document.querySelector("#queryInput"),
  searchButton: document.querySelector("#searchButton"),
  ingestButton: document.querySelector("#ingestButton"),
  syncButton: document.querySelector("#syncButton"),
  trendingButton: document.querySelector("#trendingButton"),
  candidatesButton: document.querySelector("#candidatesButton"),
  mentionsButton: document.querySelector("#mentionsButton"),
  totalCount: document.querySelector("#totalCount"),
  mentionCount: document.querySelector("#mentionCount"),
  candidateCount: document.querySelector("#candidateCount"),
  syncedAt: document.querySelector("#syncedAt"),
  libraryTitle: document.querySelector("#libraryTitle"),
  resultCount: document.querySelector("#resultCount"),
  results: document.querySelector("#results"),
  cardTemplate: document.querySelector("#cardTemplate"),
  mentionTemplate: document.querySelector("#mentionTemplate")
};

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});
elements.ingestButton.addEventListener("click", ingestAllSources);
elements.syncButton.addEventListener("click", syncRegistry);
elements.trendingButton.addEventListener("click", showTrending);
elements.candidatesButton.addEventListener("click", showCandidates);
elements.mentionsButton.addEventListener("click", showMentions);

for (const button of document.querySelectorAll(".hint")) {
  button.addEventListener("click", () => {
    elements.queryInput.value = button.dataset.query;
    runSearch();
  });
}

await bootstrap();

async function bootstrap() {
  await refreshStatus();
  elements.queryInput.value = "inspect postgres database safely";
  await runSearch();
}

async function refreshStatus() {
  const status = await getJson("/api/status");
  elements.totalCount.textContent = formatNumber(status.total || 0);
  elements.mentionCount.textContent = formatNumber(status.database?.mentions || 0);
  elements.candidateCount.textContent = formatNumber(status.database?.candidates || 0);
  elements.syncedAt.textContent = status.syncedAt ? compactDate(status.syncedAt) : "Never";
}

async function runSearch() {
  const query = elements.queryInput.value.trim();
  elements.libraryTitle.textContent = query ? "Best matches" : "Library";
  setBusy(elements.searchButton, "Searching...");
  try {
    const params = new URLSearchParams({ query, limit: "24" });
    state.results = await getJson(`/api/db/search?${params}`);
    renderCards(state.results, `${state.results.length} found`);
  } finally {
    setReady(elements.searchButton, "Search");
  }
}

async function showTrending() {
  elements.libraryTitle.textContent = "Trending now";
  state.results = await getJson("/api/db/trending?days=14&limit=24");
  renderCards(state.results, `${state.results.length} trending`);
}

async function showCandidates() {
  elements.libraryTitle.textContent = "Found outside the registry";
  const candidates = await getJson("/api/db/candidates?limit=36");
  renderMentions(candidates.map((item) => ({
    title: item.title || item.extracted_name || item.name || "Candidate",
    eyebrow: item.source_name || "candidate",
    text: item.description || item.text || item.extracted_name || "",
    url: item.repositoryUrl || item.websiteUrl || item.url,
    score: item.confidence || item.qualityScore || 0,
    created_at: item.updatedAt || item.discovered_at
  })), `${candidates.length} candidates`);
}

async function showMentions() {
  elements.libraryTitle.textContent = "Recent demand signals";
  const mentions = await getJson("/api/db/mentions?limit=36");
  renderMentions(mentions.map((item) => ({
    title: item.title || "Mention",
    eyebrow: item.source_name || "mention",
    text: item.text || "",
    url: item.url,
    score: item.score,
    created_at: item.created_at || item.discovered_at
  })), `${mentions.length} mentions`);
}

async function ingestAllSources() {
  setBusy(elements.ingestButton, "Ingesting...");
  try {
    await fetch("/api/ingest", { method: "POST" }).then(assertOk);
    await refreshStatus();
    await showTrending();
  } finally {
    setReady(elements.ingestButton, "Ingest all sources");
  }
}

async function syncRegistry() {
  setBusy(elements.syncButton, "Syncing...");
  try {
    await fetch("/api/ingest/registry", { method: "POST" }).then(assertOk);
    await refreshStatus();
    await runSearch();
  } finally {
    setReady(elements.syncButton, "Sync registry only");
  }
}

function renderCards(servers, countText) {
  elements.results.replaceChildren();
  elements.resultCount.textContent = countText;

  if (!servers.length) {
    renderEmpty("No MCPs found. Try a broader English search like “database”, “gmail”, or “github issues”.");
    return;
  }

  for (const server of servers) {
    elements.results.append(renderCard(server));
  }
}

function renderCard(server) {
  const node = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  const report = server.riskReport || {};
  const riskLevel = report.level || "unknown";

  node.querySelector("h3").textContent = server.title;
  node.querySelector(".name").textContent = server.name;
  node.querySelector(".description").textContent = server.description || "No description available.";

  const pill = node.querySelector(".risk-pill");
  pill.textContent = riskLevel === "unknown" ? "unscored" : `${riskLevel} risk`;
  pill.classList.add(riskLevel);

  const signalRow = node.querySelector(".signal-row");
  const signals = [
    `${server.qualityScore ?? "-"} quality`,
    `${server.trustScore ?? "-"} trust`,
    server.installFriction ? `${server.installFriction} install` : null,
    server.authRequired ? "auth required" : "no auth detected",
    ...(server.installTypes || []).slice(0, 2),
    ...(server.categories || []).slice(0, 2)
  ].filter(Boolean);
  for (const signal of signals) signalRow.append(signalNode(signal));

  node.querySelector(".risk-summary").textContent = report.summary || "Risk report unavailable. Run database ingestion first.";
  renderRiskReport(node.querySelector(".risk-report"), report);
  renderInstallRecipes(node.querySelector(".recipes"), server.installRecipes || []);

  const linkRow = node.querySelector(".link-row");
  addLink(linkRow, server.repositoryUrl, "Repository");
  addLink(linkRow, server.websiteUrl, "Website");

  return node;
}

function renderRiskReport(container, report) {
  if (!report?.level) {
    container.textContent = "No risk report available yet.";
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

  const access = listNode(report.access || []);
  const flags = listNode((report.flags || []).slice(0, 5).map((flag) => `${flag.severity}: ${flag.title} — ${flag.description}`));
  const recommendation = document.createElement("p");
  recommendation.className = "risk-recommendation";
  recommendation.textContent = report.recommendation || "";

  container.append(head, labelNode("Access hints"), access, labelNode("Flags"), flags, labelNode("Recommendation"), recommendation);
}

function renderInstallRecipes(container, recipes) {
  if (!recipes.length) {
    container.textContent = "No install recipe detected yet.";
    return;
  }

  for (const recipe of recipes.slice(0, 2)) {
    const wrap = document.createElement("div");
    const label = labelNode(`${recipe.client} · ${recipe.label}`);
    const code = document.createElement("pre");
    code.className = "recipe-code";
    code.textContent = typeof recipe.config === "string" ? recipe.config : JSON.stringify(recipe.config, null, 2);
    wrap.append(label, code);
    container.append(wrap);
  }
}

function renderMentions(items, countText) {
  elements.results.replaceChildren();
  elements.resultCount.textContent = countText;

  if (!items.length) {
    renderEmpty("No signals found yet. Use “Update sources” to ingest more data.");
    return;
  }

  for (const item of items) {
    const node = elements.mentionTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = item.title;
    node.querySelector(".name").textContent = `${item.eyebrow} · score ${item.score || 0} · ${compactDate(item.created_at)}`;
    node.querySelector(".description").textContent = stripHtml(item.text || "No text available.").slice(0, 420);
    addLink(node.querySelector(".link-row"), item.url, "Open source");
    elements.results.append(node);
  }
}

function renderEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = message;
  elements.results.append(empty);
}

function signalNode(text) {
  const node = document.createElement("span");
  node.className = "signal";
  node.textContent = text;
  return node;
}

function labelNode(text) {
  const label = document.createElement("div");
  label.className = "recipe-label";
  label.textContent = text;
  return label;
}

function listNode(items) {
  const list = document.createElement("ul");
  list.className = "risk-list";
  for (const item of items.length ? items : ["No specific signal detected."]) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
  return list;
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

async function getJson(url) {
  const response = await fetch(url);
  await assertOk(response);
  return response.json();
}

async function assertOk(response) {
  if (!response.ok) throw new Error(await response.text() || response.statusText);
  return response;
}

function setBusy(button, text) {
  button.disabled = true;
  button.dataset.originalText = button.textContent;
  button.textContent = text;
}

function setReady(button, fallback) {
  button.disabled = false;
  button.textContent = button.dataset.originalText || fallback;
}

function compactDate(value) {
  if (!value) return "unknown";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatNumber(value) {
  return Intl.NumberFormat(undefined, { notation: value > 9999 ? "compact" : "standard" }).format(value);
}

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = value;
  return div.textContent || div.innerText || "";
}
