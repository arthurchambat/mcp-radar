import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../src/server.js");
const configPath = path.join(os.homedir(), ".codex/config.toml");
const block = `[mcp_servers.mcp-radar]\ncommand = "node"\nargs = ["${serverPath.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"]\n`;
let existing = "";
try { existing = await fs.readFile(configPath, "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const next = existing.includes("[mcp_servers.mcp-radar]") ? existing.replace(/\[mcp_servers\.mcp-radar\][\s\S]*?(?=\n\[|$)/, block.trim()) : `${existing.trim()}\n\n${block}`.trimStart();
await fs.mkdir(path.dirname(configPath), { recursive: true });
await fs.writeFile(configPath, `${next.trim()}\n`);
console.log(`Installed MCP Radar in Codex config: ${configPath}`);
