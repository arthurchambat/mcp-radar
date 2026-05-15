const state = { categories: [], results: [], latest: [] };
const elements = {
  syncButton: document.querySelector("#syncButton"),
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
  syncedAt: document.querySelector("#syncedAt"),
  sourceName: document.querySelector("#sourceName"),
  resultCount: document.querySelector("#resultCount"),
  results: document.querySelector("#results"),
  latestList: document.querySelector("#latestList"),
  digestOutput: document.querySelector("#digestOutput"),
  sourcesList: document.querySelector("#sourcesList"),
  cardTemplate: document.querySelector("#cardTemplate")
};

elements.syncButton.addEventListener("click", syncRegistry);
elements.enrichButton.addEventListener("click", enrichGitHub);
elements.searchButton.addEventListener("click", runSearch);
elements.recommendButton.addEventListener("click", runRecommend);
elements.digestButton.addEventListener("click", generateDigest);
elements.sourcesButton.addEventListener("click", loadSources);
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
  elements.syncedAt.textContent = status.syncedAt ? new Date(status.syncedAt).toLocaleString() : "Never";
  elements.sourceName.textContent = status.source ? "Official Registry" : "Not synced";
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

async function enrichGitHub() {
  elements.enrichButton.disabled = true;
  elements.enrichButton.textContent = "Enriching...";
  try { await fetch("/api/enrich/github?maxRepos=40", { method: "POST" }).then(assertOk); await bootstrap(); }
  finally { elements.enrichButton.disabled = false; elements.enrichButton.textContent = "Enrich GitHub"; }
}

async function runSearch() {
  const params = new URLSearchParams({ query: elements.queryInput.value, category: elements.categoryFilter.value, installType: elements.installFilter.value, auth: elements.authFilter.value, limit: "40" });
  state.results = await getJson(`/api/search?${params}`);
  renderResults();
}

async function runRecommend() {
  const task = elements.queryInput.value.trim();
  if (!task) return runSearch();
  state.results = await getJson(`/api/recommend?${new URLSearchParams({ task })}`);
  renderResults();
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

function renderCard(server) {
  const node = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("h3").textContent = server.title;
  node.querySelector(".name").textContent = server.name;
  node.querySelector(".description").textContent = server.description || "No description available.";
  const auth = node.querySelector(".auth-pill");
  auth.textContent = server.authRequired ? "Auth required" : "Low friction";
  auth.classList.add(server.authRequired ? "required" : "open");
  const scoreGrid = node.querySelector(".score-grid");
  for (const [label, value] of [["Fit", server.scores?.fit ?? "-"], ["Quality", server.qualityScore ?? "-"], ["Trust", server.trustScore ?? "-"], ["Install", server.installFriction || "-"]]) {
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
