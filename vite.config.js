import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="))
    .reduce((acc, line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

const customEnvPath = path.resolve(process.cwd(), ".env", "workato-dev.env");
const customEnv = parseEnvFile(customEnvPath);

for (const [key, value] of Object.entries(customEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const localAgentProxyTarget = (
  process.env.VITE_LOCAL_CHAT_AGENT_PROXY_TARGET || "http://localhost:8787"
).trim();

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.WORKATO_WEBHOOK_URL": JSON.stringify(
      process.env.WORKATO_WEBHOOK_URL || "",
    ),
  },
  server: {
    proxy: {
      "/agent-api": {
        target: localAgentProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
