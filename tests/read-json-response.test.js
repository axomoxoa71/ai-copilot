import assert from "node:assert/strict";
import { test } from "node:test";

import { readJsonResponse } from "../agent-api/response-json.js";

test("readJsonResponse returns parsed JSON for valid bodies", async () => {
  const response = {
    async text() {
      return "{\"ok\":true,\"count\":3}";
    },
  };

  const result = await readJsonResponse(response);

  assert.equal(result.parsed, true);
  assert.equal(result.empty, false);
  assert.deepEqual(result.value, { ok: true, count: 3 });
});

test("readJsonResponse treats empty bodies as a fallback", async () => {
  const response = {
    async text() {
      return "";
    },
  };

  const result = await readJsonResponse(response);

  assert.equal(result.parsed, false);
  assert.equal(result.empty, true);
  assert.equal(result.value, null);
});

test("readJsonResponse treats invalid JSON as a fallback", async () => {
  const response = {
    async text() {
      return "{";
    },
  };

  const result = await readJsonResponse(response);

  assert.equal(result.parsed, false);
  assert.equal(result.empty, false);
  assert.equal(result.value, null);
  assert.ok(result.error instanceof Error);
});