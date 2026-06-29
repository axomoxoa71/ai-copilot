import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildAllAgentCards } from "./a2a-handler.js";

function main() {
  const repoRoot = process.cwd();
  const port = Number(process.env.AGENT_API_PORT || 8787);
  const baseUrl = process.env.AGENT_API_BASE_URL || `http://localhost:${port}`;
  const outputDir = path.resolve(repoRoot, "documentation", "a2a", "cards");

  mkdirSync(outputDir, { recursive: true });

  const cards = buildAllAgentCards(baseUrl);
  const agentNames = [...cards.keys()].sort((a, b) => a.localeCompare(b));

  if (agentNames.length === 0) {
    throw new Error("No agents found in src/resources/agent-config.json.");
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "src/resources/agent-config.json",
    generator: "agent-api/generate-a2a-cards.js",
    baseUrl,
    agents: [],
  };

  for (const agentName of agentNames) {
    const card = cards.get(agentName);
    const fileName = `${agentName}.agent-card.json`;
    const filePath = path.join(outputDir, fileName);

    writeFileSync(filePath, `${JSON.stringify(card, null, 2)}\n`, "utf-8");
    manifest.agents.push({ name: agentName, file: fileName });
  }

  const manifestPath = path.join(outputDir, "index.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  // eslint-disable-next-line no-console
  console.log(`Generated ${agentNames.length} A2A agent cards in documentation/a2a/cards`);
}

main();
