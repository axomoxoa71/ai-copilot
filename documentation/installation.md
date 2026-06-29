# Installation

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Environment Setup](#environment-setup)
4. [Production Build](#production-build)
5. [Docker Setup (Optional)](#docker-setup-optional)
6. [A2A Inspector via Docker Compose](#a2a-inspector-via-docker-compose)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

- **Node.js**: Version 20 or higher (check with `node --version`)
- **npm**: Comes with Node.js 20+ (check with `npm --version`)
- **Git**: For cloning the repository
- **OpenRouter/OpenAI API Key**: Required for LLM functionality (optional for local testing)

## Quick Start

### 1. Clone the Repository

```bash
git clone <repo-url>
cd ai-copilot
```

### 2. Install Dependencies

```bash
npm install
```

If you encounter `EJSONPARSE` errors at package.json start, check for accidental leading characters before `{` in package.json.

### 3. Configure Environment

Copy `.env/agent-dev.env.example` to `.env/agent-dev.env`:

```bash
# Linux/macOS
cp .env/agent-dev.env.example .env/agent-dev.env

# Windows PowerShell
Copy-Item .env/agent-dev.env.example .env/agent-dev.env
```

Then edit `.env/agent-dev.env`:

```bash
# Required for LLM features (get from https://openrouter.ai or https://platform.openai.com)
OPENROUTER_API_KEY=your_api_key_here

# Optional: Observability settings
# Options: console (default), otlp, none
OTEL_TRACES_EXPORTER=console

# Optional: API server port (default: 8787)
AGENT_API_PORT=8787

# Optional: Base URL embedded in A2A agent cards (default: http://localhost:<port>)
# Leave unset for local IDE development.
# When running in Docker, this is set automatically via docker-compose to:
# AGENT_API_BASE_URL=http://host.docker.internal:18787

# Optional: Atlassian MCP endpoint (if using Atlassian agent)
ATLASSIAN_MCP_URL=http://127.0.0.1:8000/mcp

# Optional: Environment-specific Atlassian MCP endpoints
# Used only when ATLASSIAN_MCP_URL is not set.
# Local IDE default: ATLASSIAN_MCP_URL_LOCAL (fallback: http://127.0.0.1:8000/mcp)
# Docker default: ATLASSIAN_MCP_URL_DOCKER (fallback: http://host.docker.internal:8000/mcp)
# RUNNING_IN_DOCKER=true
```

### 4. Start Development Environment

```bash
npm run dev
```

This starts both the frontend (http://localhost:5173) and backend API (http://localhost:8787) concurrently.

### 5. Open in Browser

Navigate to http://localhost:5173 and begin chatting.

## Environment Setup

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | - | API key for OpenRouter or OpenAI |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` | Optional value referenced by `llm-config.base-url` |
| `OPENROUTER_HTTP_REFERER` | No | - | Optional value referenced by `llm-config.http-referer` |
| `OPENROUTER_X_TITLE` | No | - | Optional value referenced by `llm-config.x-title` |
| `OTEL_TRACES_EXPORTER` | No | `console` | Tracing exporter: console, otlp, or none |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | No | `http://localhost:4317` | OTLP receiver endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | No | - | OTLP headers (key1=value1,key2=value2) |
| `AGENT_API_PORT` | No | `8787` | Port for backend API server |
| `ATLASSIAN_MCP_URL` | No | Environment-aware fallback | Explicit Atlassian MCP endpoint override for all environments |
| `ATLASSIAN_MCP_URL_LOCAL` | No | `http://127.0.0.1:8000/mcp` | Local IDE Atlassian MCP endpoint (used when explicit override is unset) |
| `ATLASSIAN_MCP_URL_DOCKER` | No | `http://host.docker.internal:8000/mcp` | Docker Atlassian MCP endpoint (used when explicit override is unset) |
| `RUNNING_IN_DOCKER` | No | auto-detected | Optional Docker mode hint (`true`/`false`) for endpoint selection |

### Agent Configuration

Edit `src/resources/agent-config.json` to configure agents:

- **agents[].llm-config**: Model/provider runtime settings (`model`, `base-url`, `temperature`, headers) per agent
- **defaultAgentName**: Which agent starts selected on entry screen
- **agents[]**: Array of available agents with routing rules
- **delegation-rules**: Conditions for routing to specialist agents

For secret management, keep API keys in environment variables. `OPENROUTER_API_KEY` must remain in env and should not be committed into `agent-config.json`.

### Secret Scanning and Commit Protection

This repository includes gitleaks-based secret scanning:

- Local full scan: `npm run secrets:scan`
- Local staged scan: `npm run secrets:scan:staged`
- CI scan workflow: `.github/workflows/secrets-scan.yml`

After `npm install`, git hooks are configured to use `.githooks/` (`prepare` script). Install gitleaks locally to enable pre-commit staged scanning.

See [README.md](../README.md#agent-configuration) for full schema and examples.

## Production Build

### Build Optimization

```bash
npm run build
```

This creates an optimized production bundle:
- TypeScript type checking (`tsc --noEmit`)
- Vite bundling and minification
- Output: `dist/` folder

### Preview Production Build Locally

```bash
npm run preview
```

Opens the production build at http://localhost:4173 for testing before deployment.

### Production Deployment

1. Build the application: `npm run build`
2. Deploy the `dist/` folder to your static hosting (Netlify, Vercel, S3, etc.)
3. Ensure backend API is accessible to the deployed frontend
4. Configure CORS on backend if frontend and API are on different domains

## Docker Setup (Optional)

For A2A Inspector deployment details, see [docker.md](./docker.md).

### Build Docker Image

```bash
docker build -t ai-copilot .
```

### Run Container

```bash
docker run -p 5173:5173 -p 8787:8787 \
  -e OPENROUTER_API_KEY=your_key_here \
  -e OTEL_TRACES_EXPORTER=console \
  ai-copilot
```

## A2A Inspector via Docker Compose

This repository includes Docker Compose support to build and run A2A Inspector from the upstream source repository.

- Compose file: `docker/docker-compose.a2a-inspector.yml`
- Service/project/container name: `a2a-inspector`
- Host URL: http://127.0.0.1:8090

Use the package scripts:

```bash
npm run deploy:a2a-inspector
npm run run:a2a-inspector
npm run stop:a2a-inspector
```

See [docker.md](./docker.md) for the full Docker reference.

## Troubleshooting

### Port Already in Use

If ports 5173 or 8787 are in use:

```bash
# Specify different port via environment variable
AGENT_API_PORT=8788 npm run dev
```

### Module Not Found Errors

If you see `MODULE_NOT_FOUND` or import errors:

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### API Connection Issues

If the frontend cannot connect to the backend:

1. Verify backend is running: `curl http://localhost:8787/agent-api/health`
2. Check CORS is enabled in `agent-api/server.js`
3. Ensure frontend calls the relative endpoint `/agent-api` and that `VITE_LOCAL_CHAT_AGENT_PROXY_TARGET` points to your backend (default `http://localhost:8787`)

### TypeScript Errors

If you see TypeScript errors:

```bash
npm run typecheck
```

This runs full type checking without building.

### OTEL Tracing Issues

If traces aren't appearing:

1. Check `OTEL_TRACES_EXPORTER` is set to `console` or `otlp`
2. For OTLP, verify endpoint is accessible: `curl http://localhost:4317`
3. Review backend logs for OTEL initialization messages
