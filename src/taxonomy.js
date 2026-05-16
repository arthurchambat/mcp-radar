export const CATEGORY_RULES = [
  ["devtools-code", ["github", "gitlab", "repo", "repository", "pull request", "pr", "issue", "code", "developer", "devtool", "debug", "ci", "deploy", "vercel", "logs", "terminal", "ide"]],
  ["database-storage", ["postgres", "postgresql", "mysql", "mariadb", "sqlite", "mongodb", "mongo", "redis", "database", "sql", "warehouse", "snowflake", "bigquery", "supabase", "neon", "vector db"]],
  ["browser-web", ["browser", "web", "crawl", "crawler", "scrape", "scraper", "playwright", "puppeteer", "website", "internet", "search engine", "serp"]],
  ["productivity-docs", ["notion", "docs", "document", "markdown", "pdf", "calendar", "gmail", "email", "slack", "teams", "linear", "jira", "workspace", "knowledge base", "obsidian"]],
  ["gtm-sales-marketing", ["ads", "advertising", "campaign", "marketing", "growth", "gtm", "seo", "keyword", "linkedin", "meta ads", "google ads", "crm", "salesforce", "hubspot", "outreach", "leads"]],
  ["data-analytics", ["analytics", "metrics", "dashboard", "report", "bi", "spreadsheet", "excel", "csv", "dataframe", "chart", "visualization", "notebook"]],
  ["security-compliance", ["security", "cve", "vulnerability", "exploit", "threat", "soc", "compliance", "audit", "risk", "iam", "auth0", "oauth", "secrets", "pentest"]],
  ["finance-commerce", ["stripe", "payment", "invoice", "billing", "subscription", "checkout", "commerce", "shopify", "stock", "trading", "crypto", "wallet", "banking"]],
  ["ai-models-media", ["image", "video", "audio", "speech", "voice", "llm", "model", "prompt", "embedding", "rag", "vector", "3d", "media", "generation"]],
  ["cloud-infra", ["aws", "gcp", "azure", "cloudflare", "kubernetes", "docker", "terraform", "infra", "serverless", "lambda", "container", "monitoring"]],
  ["local-system", ["filesystem", "file system", "file", "folder", "directory", "shell", "desktop", "local", "os", "macos", "windows", "linux", "clipboard"]],
  ["customer-support", ["support", "ticket", "intercom", "zendesk", "customer", "helpdesk", "chatwoot", "freshdesk"]],
  ["research-knowledge", ["research", "paper", "arxiv", "pubmed", "scholar", "citation", "academic", "library", "knowledge graph", "wiki"]],
  ["personal-life", ["travel", "fitness", "health", "food", "recipe", "shopping", "home", "personal", "habit"]]
];

export function inferCategoriesFromText(...parts) {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const matches = CATEGORY_RULES
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([category]) => category);
  return matches.length ? [...new Set(matches)] : ["general"];
}

export function categorySearchText(categories = []) {
  return categories.join(" ").replaceAll("-", " ");
}
