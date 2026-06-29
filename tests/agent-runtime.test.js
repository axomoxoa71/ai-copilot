import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildClientResponseLogOutput,
  makeInteractionLog,
} from "../agent-api/agent-runtime.js";

test("makeInteractionLog includes explicit agent metadata", () => {
  const log = makeInteractionLog(
    "agent",
    "LangGraph routing decision.",
    { selectedAgentName: "atlassian-agent", delegatedBy: "orchestrator-agent" },
    null,
    "orchestration",
    { agent: "orchestrator-agent", target: "atlassian-agent" },
  );

  assert.equal(log.actor, "agent");
  assert.equal(log.type, "orchestration");
  assert.equal(log.agent, "orchestrator-agent");
  assert.equal(log.target, "atlassian-agent");
});

test("makeInteractionLog omits blank agent metadata", () => {
  const log = makeInteractionLog(
    "agent",
    "Generated final response.",
    null,
    { response: "ok" },
    "interaction",
    { agent: "   " },
  );

  assert.equal(log.agent, undefined);
});

test("buildClientResponseLogOutput includes full response text and usage", () => {
  const output = buildClientResponseLogOutput("Streamed final answer", {
    prompt_tokens: 120,
    completion_tokens: 30,
    total_tokens: 150,
  });

  assert.deepEqual(output, {
    response: "Streamed final answer",
    responseLength: 21,
    totalTokens: 150,
  });
});

test("buildClientResponseLogOutput handles missing response and usage", () => {
  const output = buildClientResponseLogOutput(undefined, null);

  assert.deepEqual(output, {
    response: null,
    responseLength: 0,
    totalTokens: null,
  });
});
