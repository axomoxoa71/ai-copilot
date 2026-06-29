# A2A Protocol

This document describes how the agents in this repository are exposed via the [Google Agent-to-Agent (A2A) protocol](https://google.github.io/A2A/).

## Table of Contents

- [A2A Protocol](#a2a-protocol)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Agents Exposed](#agents-exposed)
  - [Endpoint Reference](#endpoint-reference)
    - [Default Agent Card](#default-agent-card)
    - [Per-Agent Card](#per-agent-card)
    - [Per-Agent Task Endpoint](#per-agent-task-endpoint)
  - [JSON-RPC Methods](#json-rpc-methods)
    - [tasks/send](#taskssend)
    - [tasks/get](#tasksget)
    - [tasks/cancel](#taskscancel)
  - [Task Lifecycle](#task-lifecycle)
  - [Agent Cards](#agent-cards)
    - [orchestrator-agent](#orchestrator-agent)
    - [atlassian-agent](#atlassian-agent)
    - [workato-dev](#workato-dev)
  - [Error Codes](#error-codes)
  - [Using with A2A Inspector](#using-with-a2a-inspector)
  - [Examples](#examples)
    - [Discover an Agent Card](#discover-an-agent-card)
    - [Send a Task](#send-a-task)
    - [Retrieve a Task](#retrieve-a-task)
    - [Cancel a Task](#cancel-a-task)
  - [Implementation Notes](#implementation-notes)

## Overview

The A2A protocol defines a standard, interoperable way for AI agents to:

- Advertise their capabilities via an **Agent Card** (`/.well-known/agent.json`)
- Accept and execute **tasks** submitted via a JSON-RPC 2.0 endpoint
- Return structured **artifacts** (text, data) as task results

Each agent in this project is independently accessible under `/a2a/{agentName}`.

```
Base URL: http://localhost:8787
```

## Agents Exposed

| Agent Name | Role | A2A Base URL |
|---|---|---|
| `orchestrator-agent` | Orchestrator — routes tasks to specialists | `http://localhost:8787/a2a/orchestrator-agent` |
| `atlassian-agent` | Jira / Confluence specialist | `http://localhost:8787/a2a/atlassian-agent` |
| `workato-dev` | Automation / integration specialist | `http://localhost:8787/a2a/workato-dev` |

## Endpoint Reference

All endpoints are served by `agent-api/server.js` on the configured port (default `8787`).

### Default Agent Card

Returns the Agent Card for the primary (orchestrator) agent.

```
GET /.well-known/agent.json
```

### Per-Agent Card

Returns the Agent Card for any registered agent.

```
GET /a2a/{agentName}/.well-known/agent.json
```

**Path parameters**

| Parameter | Description |
|---|---|
| `agentName` | Agent name as declared in `src/resources/agent-config.json` |

**Response**: `200 OK` with an Agent Card JSON object, or `404` if the agent is not found.

### Per-Agent Task Endpoint

Submit tasks and retrieve results for a specific agent.

```
POST /a2a/{agentName}
Content-Type: application/json
```

**Path parameters**

| Parameter | Description |
|---|---|
| `agentName` | Target agent name |

**Body**: JSON-RPC 2.0 request object (see [JSON-RPC Methods](#json-rpc-methods)).

**Response**: `200 OK` with a JSON-RPC 2.0 response object.

> Note: All A2A task endpoints internally use the routing engine. Even when calling a specialist agent directly, the routing engine may delegate to another agent based on prompt content.

## JSON-RPC Methods

All requests use JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "id": "<string | number | null>",
  "method": "<method-name>",
  "params": { ... }
}
```

### tasks/send

Submit a new task to the agent. Executes synchronously and returns the completed task.

**Request params**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | No | Client-supplied task ID. A UUID is generated if omitted. |
| `sessionId` | string | No | Session ID for conversation continuity. A UUID is generated if omitted. |
| `message` | object | Yes | A2A message with `role` and `parts[]`. |
| `message.role` | string | Yes | Always `"user"` for incoming messages. |
| `message.parts` | array | Yes | Array of message parts. Each part must have `type` and `text`. |

**Example request**

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "tasks/send",
  "params": {
    "id": "task-abc-123",
    "sessionId": "session-xyz-456",
    "message": {
      "role": "user",
      "parts": [
        { "type": "text", "text": "Show me all open Jira tickets in the FLI project" }
      ]
    }
  }
}
```

**Example response**

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "id": "task-abc-123",
    "sessionId": "session-xyz-456",
    "status": {
      "state": "completed",
      "timestamp": "2026-06-24T10:00:00.000Z"
    },
    "history": [
      {
        "role": "user",
        "parts": [{ "type": "text", "text": "Show me all open Jira tickets in the FLI project" }]
      }
    ],
    "artifacts": [
      {
        "index": 0,
        "parts": [{ "type": "text", "text": "Here are the open tickets in FLI: ..." }]
      }
    ]
  }
}
```

### tasks/get

Retrieve a previously submitted task by its ID.

**Request params**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | The task ID returned by `tasks/send`. |

**Example request**

```json
{
  "jsonrpc": "2.0",
  "id": "req-002",
  "method": "tasks/get",
  "params": { "id": "task-abc-123" }
}
```

**Example response**: Same task object as in `tasks/send` result.

### tasks/cancel

Cancel a task that is in `submitted`, `working`, or `input-required` state.

**Request params**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | The task ID to cancel. |

**Example request**

```json
{
  "jsonrpc": "2.0",
  "id": "req-003",
  "method": "tasks/cancel",
  "params": { "id": "task-abc-123" }
}
```

**Example response**: The updated task object with `status.state` set to `"canceled"`.

## Task Lifecycle

```mermaid
stateDiagram-v2
    [*] --> submitted: tasks/send received
    submitted --> working: Agent execution starts
    working --> completed: Agent responds successfully
    working --> failed: Agent throws error
    submitted --> canceled: tasks/cancel called
    working --> canceled: tasks/cancel called
    input-required --> canceled: tasks/cancel called
    completed --> [*]
    failed --> [*]
    canceled --> [*]
```

| State | Description |
|---|---|
| `submitted` | Task accepted, queued for execution |
| `working` | Agent is actively processing the task |
| `completed` | Task finished; artifacts contain the response |
| `failed` | Task encountered an unrecoverable error |
| `canceled` | Task was explicitly canceled |
| `input-required` | Agent needs additional input before continuing |

## Agent Cards

Agent Cards are static JSON documents describing an agent's identity and capabilities. They follow the [A2A Agent Card schema](https://google.github.io/A2A/#/documentation?id=agent-card).

### orchestrator-agent

```
GET http://localhost:8787/a2a/orchestrator-agent/.well-known/agent.json
```

**Capabilities**: Task planning, complexity analysis, dialog management, delegation to specialist agents (atlassian-agent, workato-dev, code-agent, doc-agent).

### atlassian-agent

```
GET http://localhost:8787/a2a/atlassian-agent/.well-known/agent.json
```

**Capabilities**: `jira-query`, `issue-creation`, `issue-update`, `confluence-search`, `workflow-management`, `jql-parsing`.

**Domains**: `atlassian`, `jira`, `confluence`.

### workato-dev

```
GET http://localhost:8787/a2a/workato-dev/.well-known/agent.json
```

**Capabilities**: `workflow-creation`, `integration-setup`, `trigger-configuration`, `action-setup`, `error-handling`, `notification-routing`.

**Domains**: `workato`, `automation`, `integration`.

## Error Codes

| Code | Name | Description |
|---|---|---|
| `-32700` | Parse error | Request body is not valid JSON |
| `-32600` | Invalid request | `jsonrpc` is not `"2.0"` |
| `-32601` | Method not found | Unknown JSON-RPC method |
| `-32602` | Invalid params | Missing or invalid parameters |
| `-32603` | Internal error | Agent execution error |
| `-32001` | Task not found | No task with the given ID exists |
| `-32002` | Task not cancelable | Task is in a terminal or non-cancelable state |

## Using with A2A Inspector

The [A2A Inspector](https://github.com/a2aproject/a2a-inspector) is included via Docker Compose. It provides a visual UI to explore agent cards and send test tasks.

| Attribute | Value |
|---|---|
| Inspector URL | `http://localhost:8090` |
| Start command | `npm run run:a2a-inspector` |
| Deploy command | `npm run deploy:a2a-inspector` |
| Stop command | `npm run stop:a2a-inspector` |

Point the Inspector at any agent base URL, for example:

```
http://localhost:8787/a2a/orchestrator-agent
```

The Inspector will:
1. Fetch the Agent Card from `/.well-known/agent.json`
2. Display the agent's name, description, and skills
3. Allow you to send `tasks/send` requests interactively

> Ensure `agent-api` is running (`npm run dev:api` or `npm run dev`) before using the Inspector.

## Examples

### Discover an Agent Card

```bash
curl http://localhost:8787/a2a/orchestrator-agent/.well-known/agent.json
```

```bash
curl http://localhost:8787/a2a/atlassian-agent/.well-known/agent.json
```

### Send a Task

```bash
curl -X POST http://localhost:8787/a2a/orchestrator-agent \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tasks/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "What can you help me with?" }]
      }
    }
  }'
```

### Retrieve a Task

```bash
curl -X POST http://localhost:8787/a2a/orchestrator-agent \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tasks/get",
    "params": { "id": "<task-id-from-send>" }
  }'
```

### Cancel a Task

```bash
curl -X POST http://localhost:8787/a2a/orchestrator-agent \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "tasks/cancel",
    "params": { "id": "<task-id>" }
  }'
```

## Implementation Notes

- **Task store**: Tasks are held in an in-memory `Map` scoped to the server process. Tasks are not persisted across server restarts.
- **Routing**: All A2A task submissions flow through the existing LangGraph routing engine. The agent named in the URL is used for logging and Agent Card resolution; actual agent selection is still determined by prompt content routing rules.
- **Session continuity**: Supply a consistent `sessionId` across multiple `tasks/send` calls to maintain conversation history within a session.
- **Streaming**: Not supported. All tasks are synchronous — `tasks/send` blocks until the agent produces a response.
- **Authentication**: Not currently enforced on A2A endpoints. Protect with a reverse proxy or API gateway in production.
- **Implementation**: `agent-api/a2a-handler.js`
