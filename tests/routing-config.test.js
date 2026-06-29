import assert from "node:assert/strict";
import { test } from "node:test";

import { loadRoutingConfig } from "../agent-api/routing-config.js";

test("loadRoutingConfig exposes tool execution retry count", () => {
  const config = loadRoutingConfig();

  assert.equal(config.toolExecutionRetries, 1);
});