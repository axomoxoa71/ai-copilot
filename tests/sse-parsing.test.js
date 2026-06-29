/**
 * Test the SSE chunk parsing logic to ensure multi-line JSON payloads
 * are properly handled when streaming agent responses.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

function parseSSEChunk(chunk) {
  const lines = chunk.split(/\r?\n/);
  let eventName = "message";
  const dataLines = [];
  let captureData = false;

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      captureData = false;
      continue;
    }

    if (line.startsWith("data:")) {
      captureData = true;
      dataLines.push(line.slice(5).trimStart());
      continue;
    }

    // Continue capturing multi-line data until empty line or next event
    if (captureData && line.trim().length > 0 && !line.startsWith("event:")) {
      dataLines.push(line);
    }
  }

  const dataText = dataLines.join("\n");
  let payload = null;
  try {
    payload = dataText.length > 0 ? JSON.parse(dataText) : null;
  } catch (e) {
    payload = { message: dataText, error: e.message };
  }

  return { eventName, payload };
}

test("parseSSEChunk: single-line events", () => {
  const chunk = 'event: progress\ndata: {"message":"Working..."}';
  const result = parseSSEChunk(chunk);
  assert.equal(result.eventName, "progress");
  assert.deepEqual(result.payload, { message: "Working..." });
});

test("parseSSEChunk: multi-line JSON payloads", () => {
  const chunk = `event: final
data: {
  "agentResponse": "This is the response",
  "tokenUsage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  }
}`;
  const result = parseSSEChunk(chunk);
  assert.equal(result.eventName, "final");
  assert.deepEqual(result.payload, {
    agentResponse: "This is the response",
    tokenUsage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  });
});

test("parseSSEChunk: complex nested JSON with logs array", () => {
  const chunk = `event: final
data: {
  "agentResponse": "Found the issue",
  "logs": [
    {
      "actor": "agent",
      "message": "Executed tool",
      "type": "tool"
    },
    {
      "actor": "tool",
      "message": "Tool completed",
      "type": "result"
    }
  ],
  "costs": {
    "tokenUsage": {"total_tokens": 200},
    "totalCostUsd": 0.001
  }
}`;
  const result = parseSSEChunk(chunk);
  assert.equal(result.eventName, "final");
  assert.equal(result.payload.agentResponse, "Found the issue");
  assert.equal(result.payload.logs.length, 2);
  assert.equal(result.payload.costs.totalCostUsd, 0.001);
});

test("parseSSEChunk: events with no data payload", () => {
  const chunk = "event: done\ndata:";
  const result = parseSSEChunk(chunk);
  assert.equal(result.eventName, "done");
  assert.equal(result.payload, null);
});

test("parseSSEChunk: error events", () => {
  const chunk = `event: error
data: {
  "error": "Connection failed"
}`;
  const result = parseSSEChunk(chunk);
  assert.equal(result.eventName, "error");
  assert.equal(result.payload.error, "Connection failed");
});
