# ai-copilot

An AI copilot which supports multi-agent conversations with intelligent task routing and delegation.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Key Capabilities](#key-capabilities)
4. [Agent Configuration](#agent-configuration)
5. [Project Structure](#project-structure)
6. [Documentation](#documentation)
7. [Development](#development)

## Overview

AI Copilot is a multi-agent conversational system that uses LangGraph for intelligent orchestration and routing. It supports specialized agents for different domains (e.g., Jira/Confluence) while maintaining a unified user interface.

## Quick Start

```bash
# Install dependencies
npm install

# Start development environment (UI + API)
npm run dev

# Open http://localhost:5173 in your browser
```

## Key Capabilities

- **Multi-Agent Orchestration**: Intelligent routing between specialized agents based on keywords, regex patterns, and semantic analysis
- **Task Delegation**: Automatic delegation of Jira/Confluence queries to specialist agents for real-time data
- **Web Search**: Orchestrator agent performs web searches for current information beyond training data
- **Clear User Communication**: Informs users of actions ("Checking your Jira workspace...", "Searching the web...", etc.)
- **OTEL Tracing**: Structured logging and distributed tracing support with trace correlation
- **Session Management**: Per-session conversation history with delegation trail
- **OpenAI Integration**: Chat completions via OpenAI/OpenRouter API with LangChain abstraction
- **MCP Support**: Model Context Protocol integration for agent extensions (e.g., Atlassian API access)

## Orchestrator Agent Behavior

The Orchestrator Agent handles requests and makes intelligent decisions when it cannot resolve them directly:

### Decision Logic

When the Orchestrator Agent receives a request, it follows this decision path:

1. **Check delegation rules** - Does the request match Atlassian domain (Jira/Confluence)?
   - **YES** → Delegate to Atlassian Agent for real-time data queries
   - **NO** → Continue to next step

2. **Determine information type** - Does the request need current information?
   - **YES** → Use web search to find latest data
   - **NO** → Continue to next step

3. **Answer from training data** - Respond directly with general knowledge

### User Communication

The system clearly informs users of each action:

| Action | User Message |
|--------|--------------|
| Delegating to Atlassian | "Let me check your Jira workspace..." / "Searching Confluence..." |
| Performing web search | "Searching the web for current information..." |
| Direct response | Immediate answer with source attribution |

This transparent communication helps users understand what's happening behind the scenes.

## Agent Configuration

Agent configuration is defined in `src/resources/agent-config.json`.

Supported top-level shape:

```json
{
	"defaultAgentName": "orchestrator-agent",
	"agents": [
		{
			"name": "orchestrator-agent",
			"role": "orchestrator",
			"url": "/agent-api",
			"llm-config": {
				"model": "openai/gpt-4o-mini",
				"base-url": "$OPENROUTER_BASE_URL",
				"temperature": 0.2,
				"http-referer": "$OPENROUTER_HTTP_REFERER",
				"x-title": "$OPENROUTER_X_TITLE"
			},
			"system-prompt": "You are the orchestrator-agent.",
			"delegation-rules": [
				{
					"target-agent": "atlassian-agent",
					"keywords": ["jira", "confluence"],
					"semantic-keywords": ["issue tracking", "knowledge base"],
					"regex-patterns": ["\\bjira\\b", "\\bconfluence\\b"],
					"priority": 10,
					"min-confidence": 0.62
				}
			]
		},
		{
			"name": "atlassian-agent",
			"role": "specialist",
			"url": "/agent-api",
			"llm-config": {
				"model": "openai/gpt-4o-mini",
				"base-url": "$OPENROUTER_BASE_URL",
				"temperature": 0.2,
				"http-referer": "$OPENROUTER_HTTP_REFERER",
				"x-title": "$OPENROUTER_X_TITLE"
			},
			"system-prompt": "You are atlassian-agent.",
			"mcp-config": {
				"atlassian-mcp-docker": {
					"type": "http",
					"url": "http://127.0.0.1:8000/mcp"
				}
			}
		}
	]
}
```

Notes:

- `llm-config` in each agent controls model/provider runtime settings for that specific agent.
- `OPENROUTER_API_KEY` remains environment-only (secret) and is not stored in `agent-config.json`.
- `llm-config` string values can reference environment variables using `$ENV_VAR_NAME`.
- `defaultAgentName` decides which agent is preselected on the entry screen.
- `delegation-rules` are evaluated in the backend by the local `agent-api` LangGraph orchestrator.
- Routing uses a hybrid strategy: deterministic `regex-patterns`, then deterministic `keywords`, then semantic fallback via `semantic-keywords` with `min-confidence` threshold.
- Lower `priority` values are evaluated first.
- For local `agent-api` calls, the frontend sends only `sessionId` and `userPrompt`. The backend resolves orchestrator/specialist prompts and MCP settings from `agent-config.json`.
- Prefer using the relative local endpoint (`/agent-api`) to keep frontend configuration portable between IDE and Docker runs.
- In IDE mode, Vite proxies `/agent-api` to `VITE_LOCAL_CHAT_AGENT_PROXY_TARGET` (default `http://localhost:8787`).
- In Docker UI mode, nginx proxies `/agent-api` to `NGINX_AGENT_API_UPSTREAM` (default `http://host.docker.internal:18787`).
- Jira/Confluence requests are delegated behind the scenes to `atlassian-agent` in LangGraph; the UI continues calling the same local API endpoint.

## Project Structure

```
ai-copilot/
├── src/                          # React frontend source
│   ├── components/               # React components
│   ├── resources/                # Configuration files (agent-config.json)
│   ├── types/                    # TypeScript type definitions
│   ├── App.tsx                   # Main routing component
│   └── main.tsx                  # Entry point
├── agent-api/                    # Express backend server
│   └── server.js                 # Agent orchestration API
├── tests/                        # Playwright e2e tests
├── documentation/                # Project documentation
├── requirements/                 # Feature requirements
├── package.json                  # Dependencies and scripts
├── vite.config.js                # Vite configuration
├── tsconfig.json                 # TypeScript configuration
├── playwright.config.js          # Playwright test configuration
└── eslint.config.js              # ESLint configuration
```

## Documentation

- **[Installation Guide](documentation/installation.md)** - Setup instructions and prerequisites
- **[Docker Guide](documentation/docker.md)** - A2A Inspector Docker Compose setup, image source, and scripts
- **[Implementation Details](documentation/implementation.md)** - Tech stack and project layout
- **[Architecture](documentation/architecture.md)** - System design and component layers
- **[API Reference](documentation/api/index.md)** - Backend API endpoints and schemas
- **[A2A Agent Cards](documentation/a2a/cards/)** - Generated static A2A agent cards and manifest
- **[Requirements](requirements/)** - Functional and non-functional requirements by feature
- **[Tests](tests.md)** - Test inventory and coverage

## Development

### Available Commands

```bash
# Start development (UI at http://localhost:5173, API at http://localhost:8787)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Scan repository for secrets
npm run secrets:scan

# Run e2e tests
npm run test:e2e

# Start only the API server
npm run agent-api

# Regenerate static A2A agent cards
npm run generate:a2a-cards
```

### Environment Variables

For development, copy `.env/agent-dev.env.example` to `.env/agent-dev.env` and set real values locally.

```bash
# Linux/macOS
cp .env/agent-dev.env.example .env/agent-dev.env

# Windows PowerShell
Copy-Item .env/agent-dev.env.example .env/agent-dev.env
```

Then edit `.env/agent-dev.env`:

```bash
OPENROUTER_API_KEY=your_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_HTTP_REFERER=http://localhost:5173
OPENROUTER_X_TITLE=Axomoxoa AI Copilot
OTEL_TRACES_EXPORTER=console  # Options: console, otlp, none
AGENT_API_PORT=8787
# AGENT_API_BASE_URL: Leave unset for local dev (defaults to http://localhost:8787).
# When running in Docker, docker-compose sets this to http://host.docker.internal:18787
# so A2A agent card URLs are reachable from other containers (e.g. A2A Inspector).
```

### Secrets and Logging Safety

- `.env/agent-dev.env` is git-ignored and must remain local-only.
- Secret scanning is enforced in CI (`.github/workflows/secrets-scan.yml`) and can be run locally with `npm run secrets:scan`.
- Pre-commit hook path is configured to `.githooks` via `npm install` (`prepare` script). Install `gitleaks` locally to enable staged secret checks.
- Backend telemetry redacts sensitive fields and avoids logging raw prompts/responses to reduce accidental confidential data exposure.

### Architecture Layers

See [Architecture Documentation](documentation/architecture.md) for system design details including:
- Frontend architecture (React components, routing)
- Backend architecture (Express, LangGraph orchestration)
- Agent delegation flow
- OTEL tracing integration
