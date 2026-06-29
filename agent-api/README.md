# agent-api

Local chatbot interaction endpoint powered by OpenRouter via LangChain.

The agent now performs an automatic web lookup only when a prompt appears to need current or externally verifiable information, then injects those findings into the model context before generating a response.

When automatic lookup is used, the response is forced to include source URLs when available; if no web evidence is found, the response states that verification from current web sources was not possible.

## Endpoint

`POST /agent-api`

Request body:

```json
{
  "sessionId": "abc-session",
  "userPrompt": "What happened in AI news today?"
}
```

Response body:

```json
{
  "agentResponse": "...",
  "tokenUsage": {
    "prompt_tokens": 123,
    "completion_tokens": 45,
    "total_tokens": 168
  }
}
```

`GET /agent-api/health`

Response body:

```json
{
  "status": "ok",
  "hasOpenRouterApiKey": true,
  "uptimeSeconds": 42
}
```

## A2A Protocol Support

The agent API implements the **A2A Protocol v1.0** (https://a2a-protocol.org/). Each agent is exposed as an A2A endpoint:

- **Agent Card**: `GET /a2a/:agentName/.well-known/agent.json`
- **Message endpoint**: `POST /a2a/:agentName`

Supported JSON-RPC methods:
- `message/send` — Send a message to the agent and receive a task or message response
- `tasks/get` — Retrieve a previously submitted task by ID
- `tasks/cancel` — Cancel a pending or working task

Example `message/send` request:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "message/send",
  "params": {
    "message": {
      "messageId": "msg-abc",
      "role": "user",
      "parts": [{ "type": "text", "text": "What is your name?" }]
    }
  }
}
```

Response will contain a task object (synchronous completion) or a message object depending on agent configuration.

## Environment variables

- `OPENROUTER_API_KEY` (required)
- `OPENROUTER_BASE_URL` (optional, used by `llm-config.base-url` when referenced)
- `OPENROUTER_HTTP_REFERER` (optional, used by `llm-config.http-referer` when referenced)
- `OPENROUTER_X_TITLE` (optional, used by `llm-config.x-title` when referenced)
- `AGENT_API_PORT` (optional, default: `8787`)
- `AGENT_API_BASE_URL` (optional, default: `http://localhost:<port>`) — Override the base URL embedded in A2A agent cards. Set to `http://host.docker.internal:18787` when running in Docker so external tools (e.g. A2A Inspector) can reach the backend.

Model/provider runtime settings are loaded from `src/resources/agent-config.json` using `llm-config` inside each agent definition.

Example:

```json
{
  "agents": [
    {
      "name": "orchestrator-agent",
      "llm-config": {
        "model": "openai/gpt-4o-mini",
        "base-url": "$OPENROUTER_BASE_URL",
        "temperature": 0.2,
        "http-referer": "$OPENROUTER_HTTP_REFERER",
        "x-title": "$OPENROUTER_X_TITLE"
      }
    }
  ]
}
```

Values beginning with `$` resolve from environment variables.

## Run

```sh
npm run agent-api
```

## Observability (OTEL)

The service uses OpenTelemetry tracing and structured JSON logs.

### Response logs

Each response is logged with these fields:

- `status` (`INFO`, `WARNING`, `ERROR`)
- `timestamp`
- `endpoint`
- `message`

Additionally, logs include `traceId`, `spanId`, and `httpStatusCode` when available.

When running in a TTY terminal (for example VS Code terminal), the log line prefix is colorized for fast scanning:

- `ERROR` in red
- `WARNING` in orange/yellow
- `INFO` in green

### Tracing and `traceparent`

- Every incoming request creates a new server span (new trace id).
- The response includes a `traceparent` header.
- Every outbound HTTP request creates a client span and automatically injects `traceparent`.
- This applies to both web search calls and model provider calls made over HTTP.

### Exporter mode (config-driven)

- `OTEL_TRACES_EXPORTER=console` (default): traces/logs are visible in terminal console.
- `OTEL_TRACES_EXPORTER=otlp`: enables OTLP HTTP exporter.
- `OTEL_TRACES_EXPORTER=none`: disables trace export.

For OTLP mode, configure one of:

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_ENDPOINT`

Optional OTLP headers:

- `OTEL_EXPORTER_OTLP_HEADERS` (example: `Authorization=Bearer token`)
