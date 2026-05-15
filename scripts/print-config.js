import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../src/server.js");

console.log(JSON.stringify({ mcpServers: { "mcp-radar": { command: "node", args: [serverPath] } } }, null, 2));
