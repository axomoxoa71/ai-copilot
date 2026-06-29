#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const agentName = "orchestrator-agent";
const baseUrl = "http://localhost:8787";

const payload = {
  jsonrpc: "2.0",
  id: randomUUID(),
  method: "message/send",
  params: {
    message: {
      messageId: randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "show me tickets in FLICA assigned to me" }],
    },
  },
};

console.log("Sending A2A request to:", `${baseUrl}/a2a/${agentName}`);
console.log("Payload:", JSON.stringify(payload, null, 2));
console.log("\n---\n");

try {
  const response = await fetch(`${baseUrl}/a2a/${agentName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  console.log("Response status:", response.status);
  console.log("Response body:", JSON.stringify(data, null, 2));
} catch (err) {
  console.error("Error:", err.message);
}
