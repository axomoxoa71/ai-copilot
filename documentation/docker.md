# Docker Deployment

This document explains the Docker-based deployment for both the backend API and A2A Inspector used by this repository.

## Table of Contents

- [Docker Deployment](#docker-deployment)
  - [Table of Contents](#table-of-contents)
  - [Full Stack (Backend + UI)](#full-stack-backend--ui)
    - [Scripts in package.json](#scripts-in-packagejson)
    - [UI Reverse Proxy Mapping](#ui-reverse-proxy-mapping)
  - [Backend API](#backend-api)
    - [Docker Compose Config](#docker-compose-config)
    - [Scripts in package.json](#scripts-in-packagejson)
    - [Runtime Environment Variables](#runtime-environment-variables)
  - [A2A Inspector](#a2a-inspector)
    - [Docker Compose Config](#docker-compose-config)
    - [Scripts in package.json](#scripts-in-packagejson)
    - [Connecting to Agents](#connecting-to-agents)

  ## Full Stack (Backend + UI)

  Use these commands to manage backend and UI Docker deployments together:

  ### Scripts in package.json

  | Script | Command | Purpose |
  |---|---|---|
  | deploy:ai-copilot | npm run deploy:ai-copilot-backend && npm run deploy:ai-copilot-ui | Build and deploy backend and UI in sequence. |
  | run:ai-copilot | npm run run:ai-copilot-backend && npm run run:ai-copilot-ui | Start backend and UI containers using existing images. |
  | stop:ai-copilot | npm run stop:ai-copilot-ui && npm run stop:ai-copilot-backend | Stop backend and UI containers in sequence. |

  After full-stack deploy:

  - UI: `http://localhost:15173`
  - Backend API: `http://localhost:18787/agent-api/health`

  ### UI Reverse Proxy Mapping

  The UI calls the local API via relative path `/agent-api`.

  - In IDE mode: Vite proxies `/agent-api` to `VITE_LOCAL_CHAT_AGENT_PROXY_TARGET` (default `http://localhost:8787`).
  - In Docker UI mode: nginx proxies `/agent-api` to `NGINX_AGENT_API_UPSTREAM` (default `http://host.docker.internal:18787`).

  Override Docker upstream when needed:

  - PowerShell example before UI deploy:
    - `$env:NGINX_AGENT_API_UPSTREAM='http://host.docker.internal:18787'`
    - `npm run deploy:ai-copilot-ui`

## Backend API

| Attribute | Value |
|---|---|
| Name | ai-copilot-backend |
| Service Name | ai-copilot-backend |
| Compose Project Name | ai-copilot-backend |
| Container Name | ai-copilot-backend |
| Image Name | ai-copilot-backend:latest |
| Purpose | Build and run the backend API (including A2A routes) in Docker. |

### Docker Compose Config

| Attribute | Value |
|---|---|
| Compose File Path | docker/docker-compose.ai-copilot-backend-yaml |
| Service | ai-copilot-backend |
| Port Mapping | 18787:8787 |
| Restart Policy | unless-stopped |
| Build and Start Command | npm run deploy:ai-copilot-backend |

### Scripts in package.json

| Script | Command | Purpose |
|---|---|---|
| deploy:ai-copilot-backend | docker compose -f docker/docker-compose.ai-copilot-backend-yaml up -d --build | Build and run backend in detached mode. |
| run:ai-copilot-backend | docker compose -f docker/docker-compose.ai-copilot-backend-yaml up -d | Run backend in detached mode using existing image. |
| stop:ai-copilot-backend | docker compose -f docker/docker-compose.ai-copilot-backend-yaml down | Stop and remove the compose-managed backend container and network. |

### Runtime Environment Variables

The backend service reads these variables from your shell environment (with defaults set in compose):

- `OPENROUTER_API_KEY` (required for chat completion calls)
- `OPENROUTER_BASE_URL`
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_X_TITLE`
- `OTEL_TRACES_EXPORTER`
- `AGENT_API_PORT` (fixed to `8787` in compose)

After deploy, health and A2A endpoints are available at:

- `http://localhost:18787/agent-api/health`
- `http://localhost:18787/.well-known/agent.json`
- `http://localhost:18787/a2a/{agentName}`

## A2A Inspector

| Attribute | Value |
|---|---|
| Name | a2a-inspector |
| Service Name | a2a-inspector |
| Compose Project Name | a2a-inspector |
| Container Name | a2a-inspector |
| Image Name | a2a-inspector:latest |
| Purpose | Build and run A2A Inspector without installing local Python and Node.js dependencies in this repository. |
| Source | https://github.com/a2aproject/a2a-inspector |
| Build Source | https://github.com/a2aproject/a2a-inspector.git |

### Docker Compose Config

| Attribute | Value |
|---|---|
| Compose File Path | docker/docker-compose.a2a-inspector.yml |
| Service | a2a-inspector |
| Port Mapping | 8090:8080 |
| Restart Policy | unless-stopped |
| Build and Start Command | npm run deploy:a2a-inspector |

### Scripts in package.json

| Script | Command | Purpose |
|---|---|---|
| deploy:a2a-inspector | docker compose -f docker/docker-compose.a2a-inspector.yml up -d --build | Build and run A2A Inspector in detached mode. |
| run:a2a-inspector | docker compose -f docker/docker-compose.a2a-inspector.yml up -d | Run A2A Inspector in detached mode using existing image. |
| stop:a2a-inspector | docker compose -f docker/docker-compose.a2a-inspector.yml down | Stop and remove the compose-managed container and network. |

### Connecting to Agents

When running the backend in Docker, open the Inspector at `http://localhost:8090` and enter any of the following agent base URLs:

| Agent | A2A Base URL |
|---|---|
| orchestrator-agent | `http://host.docker.internal:18787/a2a/orchestrator-agent` |
| atlassian-agent | `http://host.docker.internal:18787/a2a/atlassian-agent` |
| workato-dev | `http://host.docker.internal:18787/a2a/workato-dev` |

The Inspector fetches each agent's card from `{baseUrl}/.well-known/agent.json` and displays its capabilities and skills. You can send tasks interactively from the Inspector UI.

For full A2A protocol documentation see [documentation/a2a/a2a.md](a2a/a2a.md).
