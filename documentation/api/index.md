# Agent API Reference

This document provides complete API reference for the AI Copilot backend server.

## Table of Contents

1. [Overview](#overview)
2. [Base URL](#base-url)
3. [Authentication](#authentication)
4. [Error Handling](#error-handling)
5. [Endpoints](#endpoints)
6. [Request/Response Schemas](#requestresponse-schemas)
7. [Examples](#examples)
8. [Rate Limiting](#rate-limiting)
9. [CORS](#cors)
10. [A2A Agent Cards (Generated)](#a2a-agent-cards-generated)

## Overview

The Agent API is a RESTful service built with Express.js that orchestrates multi-agent conversations using LangGraph. It coordinates between user requests and specialized agents, with intelligent routing based on content analysis.

**Technology Stack**:
- Framework: Express.js
- Orchestration: LangGraph
- LLM: OpenAI/OpenRouter
- Observability: OpenTelemetry
- Validation: Zod schemas

## Base URL

```
http://localhost:8787
```

For development, the API server runs on port 8787 (configurable via `AGENT_API_PORT` environment variable).

## Authentication

Current implementation does **not** require API key authentication. 

**Production Recommendation**: Implement bearer token authentication or API key validation before deploying to production.

## Error Handling

### Error Response Format

All errors return a consistent JSON format:

```json
{
  "error": "Human-readable error message",
  "details": {
    "field_name": ["Error description for field"],
    "another_field": ["Validation error"]
  }
}
```

### HTTP Status Codes

| Status | Meaning | Cause |
|--------|---------|-------|
| 200 | OK | Request succeeded |
| 400 | Bad Request | Invalid payload or missing required fields |
| 500 | Internal Server Error | Unhandled server exception |

### Error Logging

All errors are logged with structured format including:
- Error message and stack trace
- HTTP status code
- Trace ID for correlation
- User data (sessionId, etc.) for debugging

## Endpoints

### 1. Health Check

**Endpoint**: `GET /agent-api/health`

**Purpose**: Verify API server is running and check configuration status.

**Request**:
```http
GET /agent-api/health HTTP/1.1
Host: localhost:8787
```

**Response** (200 OK):
```json
{
  "status": "ok",
  "hasOpenRouterApiKey": true,
  "uptimeSeconds": 3600
}
```

**Use Cases**:
- Kubernetes liveness/readiness probes
- Load balancer health checks
- Client-side connectivity verification
- Monitoring dashboards

---

### 3. A2A Agent Cards (Well-Known)

The API also exposes A2A Agent Cards for each configured agent:

- `GET /.well-known/agent.json`
- `GET /a2a/:agentName/.well-known/agent.json`

Static generated snapshots of these cards are committed in:

- `documentation/a2a/cards/`

Regenerate them with:

```bash
npm run generate:a2a-cards
```

Regenerate whenever `src/resources/agent-config.json` or A2A card generation logic changes.

---

### 2. Chat Completion

**Endpoint**: `POST /agent-api`

**Purpose**: Submit a user message and receive agent response with intelligent routing.

**Request Headers**:
```http
POST /agent-api HTTP/1.1
Host: localhost:8787
Content-Type: application/json
```

**Request Body**:
```json
{
  "sessionId": "unique-session-identifier",
  "userPrompt": "What are the open Jira tickets in the current sprint?"
}
```

**Response** (200 OK):
```json
{
  "agentResponse": "Based on the query, I've found the following open tickets...",
  "agentName": "atlassian-agent",
  "sessionId": "unique-session-identifier",
  "tokenUsage": {
    "prompt_tokens": 250,
    "completion_tokens": 150,
    "total_tokens": 400
  },
  "logs": [
    {
      "timestamp": "2026-06-19T10:30:45.123Z",
      "component": "delegationEngine",
      "message": "Routed to atlassian-agent based on keyword match",
      "level": "info"
    },
    {
      "timestamp": "2026-06-19T10:30:50.456Z",
      "component": "llmClient",
      "message": "Received chat completion response",
      "level": "info"
    }
  ],
  "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01"
}
```

**Error Response** (400 Bad Request):
```json
{
  "error": "Invalid request payload.",
  "details": {
    "sessionId": ["String must contain at least 1 character"],
    "userPrompt": ["String must contain at least 1 character"]
  }
}
```

**Query Parameters**: None

**Path Parameters**: None

---

## Request/Response Schemas

### Request Schema: Chat Completion

```typescript
{
  sessionId: string;           // Unique session identifier (min 1 character)
  userPrompt: string;          // User message (min 1 character, max implementation-dependent)
}
```

**Validation Rules**:
- `sessionId`: Required, non-empty string
- `userPrompt`: Required, non-empty string
- Request body must be valid JSON
- Maximum payload size: 1MB

### Response Schema: Chat Completion

```typescript
{
  agentResponse: string;       // The agent's response text
  agentName: string;          // Name of the agent that handled the request
  sessionId: string;          // Echo of the request session ID
  tokenUsage: {
    prompt_tokens: number;     // Tokens used in the input
    completion_tokens: number; // Tokens used in the response
    total_tokens: number;      // Total tokens (prompt + completion)
  };
  logs: Array<{
    timestamp: string;         // ISO 8601 timestamp
    component: string;         // Component that generated the log
    message: string;           // Log message
    level: "info" | "warning" | "error";
    metadata?: object;         // Optional structured data
  }>;
  traceparent: string;         // W3C Trace Context header for request correlation
}
```

### Error Response Schema

```typescript
{
  error: string;              // Human-readable error message
  details?: {                 // Optional: validation errors by field
    [fieldName: string]: string[];
  };
}
```

---

## Examples

### Example 1: Simple Chat Message

**Request**:
```bash
curl -X POST http://localhost:8787/agent-api \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "user-123-session-456",
    "userPrompt": "What is 2 + 2?"
  }'
```

**Response**:
```json
{
  "agentResponse": "2 + 2 = 4. This is a basic arithmetic operation where you add two units of two together to get four.",
  "agentName": "orchestrator-agent",
  "sessionId": "user-123-session-456",
  "tokenUsage": {
    "prompt_tokens": 45,
    "completion_tokens": 28,
    "total_tokens": 73
  },
  "logs": [
    {
      "timestamp": "2026-06-19T10:30:45.123Z",
      "component": "orchestrator",
      "message": "Processing general query with orchestrator-agent",
      "level": "info"
    }
  ],
  "traceparent": "00-abc123def456ghi789jkl012mno345pq-rst789uvwxyz012ab-01"
}
```

### Example 2: Jira-Routed Request

**Request**:
```bash
curl -X POST http://localhost:8787/agent-api \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "user-456-session-789",
    "userPrompt": "Show me all open Jira tickets assigned to me"
  }'
```

**Response**:
```json
{
  "agentResponse": "I found 5 open tickets assigned to you...",
  "agentName": "atlassian-agent",
  "sessionId": "user-456-session-789",
  "tokenUsage": {
    "prompt_tokens": 187,
    "completion_tokens": 452,
    "total_tokens": 639
  },
  "logs": [
    {
      "timestamp": "2026-06-19T10:31:00.100Z",
      "component": "delegationEngine",
      "message": "Matched keyword 'jira' in user prompt",
      "level": "info"
    },
    {
      "timestamp": "2026-06-19T10:31:00.150Z",
      "component": "delegationEngine",
      "message": "Routing to specialist agent: atlassian-agent",
      "level": "info"
    },
    {
      "timestamp": "2026-06-19T10:31:01.200Z",
      "component": "atlassian-agent",
      "message": "Connecting to Atlassian MCP server",
      "level": "info"
    }
  ],
  "traceparent": "00-xyz789abc123def456ghi789jkl012m-nop456qrstuvwxy012ab-01"
}
```

### Example 3: Validation Error

**Request** (missing userPrompt):
```bash
curl -X POST http://localhost:8787/agent-api \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "user-789-session-012"
  }'
```

**Response** (400 Bad Request):
```json
{
  "error": "Invalid request payload.",
  "details": {
    "userPrompt": ["Required"]
  }
}
```

### Example 4: JavaScript/TypeScript Client

```typescript
async function sendChatMessage(sessionId: string, userPrompt: string) {
  const response = await fetch('http://localhost:8787/agent-api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      userPrompt,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`API Error: ${error.error}`);
  }

  const data = await response.json();
  return data;
}

// Usage
const result = await sendChatMessage(
  'my-session-id',
  'What is the status of JIRA-123?'
);

console.log(result.agentResponse);
console.log(`Used ${result.tokenUsage.total_tokens} tokens`);
console.log(`Trace ID: ${result.traceparent}`);
```

### Example 5: Python Client

```python
import requests
import json

def send_chat_message(session_id: str, user_prompt: str) -> dict:
    url = 'http://localhost:8787/agent-api'
    payload = {
        'sessionId': session_id,
        'userPrompt': user_prompt,
    }
    
    response = requests.post(url, json=payload)
    response.raise_for_status()
    
    return response.json()

# Usage
result = send_chat_message(
    'my-session-id',
    'What are the recent changes in Confluence?'
)

print(result['agentResponse'])
print(f"Token usage: {result['tokenUsage']['total_tokens']}")
```

---

## Rate Limiting

**Current Status**: Not implemented.

**Recommended Implementation**:
- Per-sessionId limit: 10 requests/minute
- Per-IP limit: 100 requests/minute
- Global limit: 1000 requests/minute

Use Express middleware like `express-rate-limit` with Redis backend for distributed rate limiting.

---

## CORS

**Current Configuration**: All origins are allowed (`*`).

**Recommendation for Production**:
```javascript
const cors = require('cors');

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
}));
```

---

## Session Management

### Session Lifecycle

1. **Create**: First request with new `sessionId` creates session
2. **Use**: Subsequent requests with same `sessionId` continue conversation
3. **Expire**: Sessions persist until server restart (no TTL currently implemented)

**Production Consideration**: Implement session expiration and persistent storage (Redis/Database).

---

## Monitoring & Observability

### Health Check Interval

Recommended health check interval: **30 seconds**

### Metrics to Monitor

- Response time (p50, p95, p99)
- Error rate (4xx, 5xx)
- Token usage per request
- Active session count
- LLM API latency

### Trace Correlation

All responses include `traceparent` header following W3C Trace Context specification. Use this to correlate:
- Frontend logs
- Backend logs
- LLM provider logs
- External service calls

---

## Changelog

### v1.0.0 (Initial Release)

- Health check endpoint
- Chat completion endpoint
- LangGraph-based routing
- OTEL tracing integration
- Zod schema validation

### Future Enhancements

- Session persistence
- Rate limiting
- Authentication/Authorization
- Batch API endpoint
- WebSocket support for streaming responses
- API versioning

