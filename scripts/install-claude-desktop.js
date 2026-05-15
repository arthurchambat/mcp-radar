import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../src/server.js");
const configPath = path.join(os.homedir(), "Library/Application Support/Claude/claude_desktop_config.json");
const config = await readJson(configPath);
config.mcpServers = config.mcpServers || {};
config.mcpServers["mcp-radar"] = { command: "node", args: [serverPath] };
await fs.mkdir(path.dirname(configPath), { recursive: true });
await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Installed MCP Radar in Claude Desktop config: ${configPath}`);

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}
