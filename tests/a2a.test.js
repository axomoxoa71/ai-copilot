/**
 * Tests for the A2A protocol handler (agent-api/a2a-handler.js).
 *
 * These tests exercise the handler logic directly without starting an HTTP
 * server. They cover:
 *   - Agent card building
 *   - JSON-RPC request dispatching (tasks/send, tasks/get, tasks/cancel)
 *   - Error handling for invalid requests
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAgentCard, handleA2ARequest } from "../agent-api/a2a-handler.js";

// ---------------------------------------------------------------------------
// Agent card tests
// ---------------------------------------------------------------------------

test("buildAgentCard produces a valid A2A agent card from config", () => {
  const agentConfig = {
    name: "test-agent",
    role: "specialist",
    description: "A test agent for unit testing",
    capabilities: ["search", "create"],
    domains: ["testing"],
  };

  const card = buildAgentCard(agentConfig, "http://localhost:8787");

  assert.equal(card.name, "test-agent");
  assert.equal(card.url, "http://localhost:8787/a2a/test-agent");
  assert.equal(typeof card.description, "string");
  assert.ok(card.description.length > 0);
  assert.equal(card.version, "1.0.0");
  assert.equal(card.capabilities.streaming, false);
  assert.equal(card.capabilities.pushNotifications, false);
  assert.ok(Array.isArray(card.skills));
  assert.ok(card.skills.length > 0);
  assert.ok(Array.isArray(card.defaultInputModes));
  assert.ok(Array.isArray(card.defaultOutputModes));
});

test("buildAgentCard derives skills from capabilities array", () => {
  const agentConfig = {
    name: "atlassian-agent",
    capabilities: ["jira-query", "issue-creation"],
  };

  const card = buildAgentCard(agentConfig, "http://localhost:8787");

  const skillIds = card.skills.map((s) => s.id);
  assert.ok(skillIds.includes("jira-query"), "should include jira-query skill");
  assert.ok(skillIds.includes("issue-creation"), "should include issue-creation skill");
});

test("buildAgentCard uses default chat skill when no capabilities defined", () => {
  const agentConfig = { name: "bare-agent" };

  const card = buildAgentCard(agentConfig, "http://localhost:8787");

  assert.equal(card.skills.length, 1);
  assert.equal(card.skills[0].id, "chat");
});

test("buildAgentCard encodes agent name in URL", () => {
  const agentConfig = { name: "my agent" };

  const card = buildAgentCard(agentConfig, "http://localhost:8787");

  assert.equal(card.url, "http://localhost:8787/a2a/my%20agent");
});

test("buildAgentCard derives delegate skills from delegation-rules", () => {
  const agentConfig = {
    name: "orchestrator-agent",
    role: "orchestrator",
    "delegation-rules": [
      { "target-agent": "atlassian-agent", keywords: ["jira"], category: "atlassian" },
    ],
  };

  const card = buildAgentCard(agentConfig, "http://localhost:8787");

  const delegateSkill = card.skills.find((s) => s.id === "delegate-to-atlassian-agent");
  assert.ok(delegateSkill, "should include delegation skill for atlassian-agent");
});

// ---------------------------------------------------------------------------
// JSON-RPC dispatch tests
// ---------------------------------------------------------------------------

test("handleA2ARequest returns parse error for non-object body", async () => {
  const response = await handleA2ARequest("not-an-object", "test-agent");

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.error);
  assert.equal(response.error.code, -32700);
});

test("handleA2ARequest returns invalid request for wrong jsonrpc version", async () => {
  const response = await handleA2ARequest(
    { jsonrpc: "1.0", id: "1", method: "tasks/send", params: {} },
    "test-agent",
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, "1");
  assert.ok(response.error);
  assert.equal(response.error.code, -32600);
});

test("handleA2ARequest returns method-not-found for unknown method", async () => {
  const response = await handleA2ARequest(
    { jsonrpc: "2.0", id: "2", method: "unknown/method", params: {} },
    "test-agent",
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, "2");
  assert.ok(response.error);
  assert.equal(response.error.code, -32601);
});

test("handleA2ARequest message/send returns invalid-params when message is missing", async () => {
  const response = await handleA2ARequest(
    {
      jsonrpc: "2.0",
      id: "3",
      method: "message/send",
      params: { id: "task-1" },
    },
    "test-agent",
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.error);
  assert.equal(response.error.code, -32602);
});

test("handleA2ARequest message/send returns invalid-params when parts is empty", async () => {
  const response = await handleA2ARequest(
    {
      jsonrpc: "2.0",
      id: "4",
      method: "message/send",
      params: {
        message: { messageId: "msg-4", role: "user", parts: [] },
      },
    },
    "test-agent",
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.error);
  assert.equal(response.error.code, -32602);
});

test("handleA2ARequest message/send returns invalid-params when text is blank", async () => {
  const response = await handleA2ARequest(
    {
      jsonrpc: "2.0",
      id: "5",
      method: "message/send",
      params: {
        message: { messageId: "msg-5", role: "user", parts: [{ type: "text", text: "   " }] },
      },
    },
    "test-agent",
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.error);
  assert.equal(response.error.code, -32602);
});

test("handleA2ARequest tasks/get returns task-not-found for unknown id", async () => {
  const response = await handleA2ARequest(
    {
      jsonrpc: "2.0",
      id: "6",
      method: "tasks/get",
      params: { id: "nonexistent-task-id" },
    },
    "test-agent",
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.error);
  assert.equal(response.error.code, -32001);
});

test("handleA2ARequest tasks/get returns invalid-params when id is missing", async () => {
  const response = await handleA2ARequest(
    {
      jsonrpc: "2.0",
      id: "7",
      method: "tasks/get",
      params: {},
    },
    "test-agent",
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.error);
  assert.equal(response.error.code, -32602);
});

test("handleA2ARequest tasks/cancel returns task-not-found for unknown id", async () => {
  const response = await handleA2ARequest(
    {
      jsonrpc: "2.0",
      id: "8",
      method: "tasks/cancel",
      params: { id: "nonexistent-task-id" },
    },
    "test-agent",
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.error);
  assert.equal(response.error.code, -32001);
});

test("handleA2ARequest preserves request id in response", async () => {
  const response = await handleA2ARequest(
    {
      jsonrpc: "2.0",
      id: 42,
      method: "tasks/get",
      params: { id: "no-such-task" },
    },
    "test-agent",
  );

  assert.equal(response.id, 42);
});

test("handleA2ARequest returns null id when request id is null", async () => {
  const response = await handleA2ARequest(
    {
      jsonrpc: "2.0",
      id: null,
      method: "tasks/get",
      params: { id: "no-such-task" },
    },
    "test-agent",
  );

  assert.equal(response.id, null);
});
