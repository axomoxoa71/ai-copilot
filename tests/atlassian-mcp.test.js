import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAtlassianMcpQuery,
  buildMcpToolArguments,
  selectAtlassianMcpToolCandidate,
} from "../agent-api/atlassian-mcp.js";

test("selectAtlassianMcpToolCandidate prefers Jira-like tools for ticket queries", () => {
  const tools = [
    { name: "search_pages", description: "Search Confluence pages" },
    { name: "search_issues", description: "Search Jira issues and tickets" },
  ];

  const candidate = selectAtlassianMcpToolCandidate(tools, "Show me tickets assigned to me in FLI");

  assert.equal(candidate?.name, "search_issues");
});

test("buildAtlassianMcpQuery tailors the query for Jira requests", () => {
  const result = buildAtlassianMcpQuery(
    "Show me tickets assigned to me in FLI",
    { name: "search_issues", description: "Search Jira issues and tickets" },
  );

  assert.match(result, /Jira issues or tickets/);
});

test("buildMcpToolArguments maps query to jql when schema requires it", () => {
  const candidate = {
    name: "jira_search",
    description: "Search Jira issues",
    inputSchema: {
      type: "object",
      properties: {
        jql: { type: "string", description: "JQL query string" },
        maxResults: { type: "integer" },
      },
      required: ["jql"],
    },
  };

  const args = buildMcpToolArguments("Show me open tickets in FLI", candidate);

  assert.ok("jql" in args, "jql parameter should be present");
  assert.equal(typeof args.jql, "string");
  assert.ok(args.jql.length > 0);
});

test("buildMcpToolArguments falls back to first string param when no preferred match", () => {
  const candidate = {
    name: "some_tool",
    description: "Generic tool",
    inputSchema: {
      type: "object",
      properties: {
        searchText: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["searchText"],
    },
  };

  const args = buildMcpToolArguments("Find open FLI tickets", candidate);

  assert.ok("searchText" in args, "first string param should be populated");
  assert.equal(typeof args.searchText, "string");
});

test("buildMcpToolArguments returns plain query object when candidate has no schema", () => {
  const candidate = { name: "no_schema_tool", description: "No schema" };

  const args = buildMcpToolArguments("Show me tickets", candidate);

  assert.ok("query" in args);
  assert.equal(typeof args.query, "string");
});