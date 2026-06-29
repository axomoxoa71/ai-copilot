# Architecture

This document describes the system architecture of the AI Copilot project, including layers, components, and data flows.

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Layers](#architecture-layers)
3. [Component Diagram](#component-diagram)
4. [Backend Module Interactions](#backend-module-interactions)
5. [Agent Routing Flow](#agent-routing-flow)
6. [Session Management](#session-management)
7. [Observability Architecture](#observability-architecture)
8. [Deployment Considerations](#deployment-considerations)

## System Overview

AI Copilot is a distributed system consisting of:

- **Frontend**: React SPA providing the user interface
- **Backend API**: Express server orchestrating multi-agent conversations
- **LLM Provider**: OpenAI/OpenRouter for language model inference
- **Optional MCP Servers**: External services integrated via Model Context Protocol

The system supports intelligent task routing, delegating specialized queries to appropriate agents while maintaining a unified chat interface.

## Architecture Layers

### Layer Diagram

```mermaid
graph TB
    User["👤 User"]
    Browser["🌐 Browser"]
    FE["React Frontend<br/>TypeScript + Vite"]
    Router["React Router<br/>SPA Routing"]
    UI["UI Components<br/>ChatbotPage, EntryPage"]
    
    Network["HTTP/REST"]
    
    API["Express Server<br/>Port 8787"]
    OrchestratorAgent["🤖 Orchestrator Agent<br/>LangGraph"]
    SpecialistAgent["🤖 Specialist Agents<br/>Jira, Confluence, etc."]
    DelegationEngine["Delegation Engine<br/>Regex, Keywords, Semantic"]
    SessionMgr["Session Manager<br/>In-Memory Store"]
    ConfigMgr["Config Manager<br/>agent-config.json"]
    
    LLMNetwork["HTTPS API"]
    
    LLMProvider["🧠 LLM Provider<br/>OpenAI/OpenRouter"]
    MCP["Optional MCP Servers<br/>Atlassian, Custom"]
    
    Tracing["OpenTelemetry<br/>Console/OTLP Export"]
    
    User -->|"Types & Clicks"| Browser
    Browser -->|"React Mount"| FE
    FE --> Router
    FE --> UI
    UI -->|"User Messages"| Network
    Network -->|"POST /agent-api"| API
    
    API --> DelegationEngine
    DelegationEngine --> ConfigMgr
    DelegationEngine -->|"Route Decision"| OrchestratorAgent
    DelegationEngine -->|"Route Decision"| SpecialistAgent
    
    OrchestratorAgent --> SessionMgr
    SpecialistAgent --> SessionMgr
    
    OrchestratorAgent -->|"Chat Completion"| LLMNetwork
    SpecialistAgent -->|"Chat Completion"| LLMNetwork
    LLMNetwork --> LLMProvider
    
    SpecialistAgent -.->|"Optional Context"| MCP
    
    API -.->|"Trace Events"| Tracing
    OrchestratorAgent -.->|"Trace Events"| Tracing
    SpecialistAgent -.->|"Trace Events"| Tracing
    
    LLMProvider -->|"Response"| LLMNetwork
    LLMNetwork -->|"Completion"| OrchestratorAgent
    LLMNetwork -->|"Completion"| SpecialistAgent
    
    OrchestratorAgent -->|"JSON Response"| API
    SpecialistAgent -->|"JSON Response"| API
    API -->|"HTTP 200"| Network
    Network -->|"Response Data"| UI
    UI -->|"Render Message"| Browser
    Browser -->|"Display"| User
    
    style User fill:#e1f5ff
    style Browser fill:#fff3e0
    style FE fill:#f3e5f5
    style API fill:#e8f5e9
    style LLMProvider fill:#fce4ec
    style Tracing fill:#ede7f6
```

### Layer Details

#### 1. Presentation Layer (Frontend)

**Technology**: React 19, TypeScript, Vite

**Responsibilities**:
- Render user interface (chat messages, input fields, agent selector)
- Manage UI state and animations
- Route between pages (EntryPage, ChatbotPage, etc.)
- Handle user input and validation
- Display responses with formatting (markdown, syntax highlighting)

**Key Components**:
- `App.tsx`: Root component with routing context
- `ChatbotPage.tsx`: Main chat interface with message list and input
- `EntryPage.tsx`: Agent selection screen
- `index.css`: Global styles and CSS variables

#### 2. API Layer (Backend)

**Technology**: Express.js, Node.js — decomposed into focused modules

| Module | Responsibility |
|---|---|
| `server.js` | Express app, CORS/JSON middleware, route handlers, server start |
| `telemetry.js` | OTEL provider setup, `logEvent()`, global fetch instrumentation |
| `routing-config.js` | Load `agent-config.json`, resolve `$ENV_VAR` references, typed config |
| `routing-engine.js` | LangGraph state machine: intent detection → agent selection |
| `agent-runtime.js` | Session store, token usage helpers, full agent interaction loop |
| `mcp-tools.js` | MCP tool discovery, LangChain wrappers, Jira JQL workflow detection |
| `web-search.js` | DuckDuckGo instant-answer search, `webSearchTool`, auto-lookup heuristic |
| `atlassian-mcp.js` | Low-level MCP JSON-RPC (`initialize`, `tools/list`, `tools/call`) |
| `response-json.js` | Safe async JSON body parser |

**Key Endpoints**:
- `GET /agent-api/health`: Health check
- `POST /agent-api`: Chat completion request

#### 3. Orchestration Layer (LangGraph)

**Technology**: LangGraph (state machine framework)

**Responsibilities**:
- Evaluate delegation rules based on user input
- Maintain conversation state and message history
- Coordinate between orchestrator and specialist agents
- Manage agent-specific configurations (prompts, MCP connections)

**Routing Logic**:
1. Parse user input with regex patterns (highest priority)
2. Match against keywords (deterministic)
3. Fall back to semantic similarity (LLM-based)
4. Apply confidence threshold and priority ordering

#### 4. Agent Layer

**Agents**:
- **Orchestrator Agent**: Default agent handling general topics, web search requests, and task delegation
- **Specialist Agents**: Domain-specific agents (e.g., Atlassian agent for Jira/Confluence)

**Responsibilities**:
- Execute system prompt for their domain
- Invoke LLM with appropriate context
- Process tool calls (via MCP if applicable)
- Return structured responses

**Orchestrator Agent Behavior**:
When the Orchestrator Agent receives a request it cannot resolve directly, it:
1. **Identifies the topic**: Analyzes if the request matches a specialist domain
2. **Delegates or Performs**:
   - **Delegates to Atlassian Agent**: If request is about Jira tickets, Confluence pages, or Atlassian workflows
   - **Performs Web Search**: If request requires current information not in training data
   - **Responds Directly**: For general knowledge questions

**Specialist Agents**:
- **Atlassian Agent**: Handles Jira and Confluence queries by connecting to the configured Atlassian MCP server for real-time data
  - Uses MCP tools instead of web search for Jira and Confluence work
  - Supports: Jira issue searches, sprint planning, Confluence documentation, and issue/page lookups
  - Returns: Structured responses with real-time data from Atlassian systems

#### 5. LLM Provider Layer

**Technology**: LangChain (ChatOpenAI), OpenAI API / OpenRouter

**Responsibilities**:
- Abstract LLM API calls via LangChain's ChatOpenAI wrapper
- Provide language model inference through OpenAI or OpenRouter endpoints
- Handle chat completion requests with message formatting
- Track and report token usage (prompt, completion, total)
- Manage API authentication and error handling

#### 6. Observability Layer

**Technology**: OpenTelemetry (OTEL)

**Responsibilities**:
- Instrument HTTP requests and responses
- Capture trace context across distributed calls
- Export traces to console or OTLP collector
- Provide structured logging with severity levels

## Component Diagram

### Frontend Components

```mermaid
graph LR
    App["App.tsx<br/>Router Provider"]
    Routes["React Router<br/>Route Definitions"]
    EP["EntryPage<br/>Agent Selection"]
    CP["ChatbotPage<br/>Chat Interface"]
    MSG["Message Display<br/>Markdown Rendering"]
    INPUT["Input Component<br/>Textarea + Send"]
    
    App --> Routes
    Routes -->|"/ path"| EP
    Routes -->|"/chatbot path"| CP
    CP --> MSG
    CP --> INPUT
    
    style App fill:#e3f2fd
    style Routes fill:#e3f2fd
    style EP fill:#f3e5f5
    style CP fill:#f3e5f5
    style MSG fill:#fce4ec
    style INPUT fill:#fce4ec
```

### Backend Components

The backend is decomposed into focused modules. `server.js` is the thin entry-point; all orchestration logic lives in dedicated files.

```mermaid
graph LR
    Server["server.js\nEntry-point"]
    Telemetry["telemetry.js\nOTEL + Logging"]
    RoutingConfig["routing-config.js\nConfig Loader"]
    RoutingEngine["routing-engine.js\nLangGraph Routing"]
    AgentRuntime["agent-runtime.js\nAgent Loop + Sessions"]
    McpTools["mcp-tools.js\nMCP Tool Builder"]
    WebSearch["web-search.js\nWeb Search"]
    AtlassianMcp["atlassian-mcp.js\nMCP JSON-RPC"]
    ResponseJson["response-json.js\nJSON Parser"]
    LLMClient["ChatOpenAI\n(LangChain)"]
    MCP["Atlassian MCP Server\n(external)"]
    DDG["DuckDuckGo API\n(external)"]

    Server -->|"init OTEL"| Telemetry
    Server -->|"runAgentInteraction"| AgentRuntime

    AgentRuntime --> RoutingConfig
    AgentRuntime --> RoutingEngine
    AgentRuntime --> McpTools
    AgentRuntime --> WebSearch
    AgentRuntime --> Telemetry
    AgentRuntime -->|"invoke"| LLMClient

    RoutingEngine --> RoutingConfig

    McpTools --> AtlassianMcp
    McpTools --> Telemetry
    AtlassianMcp -->|"HTTP JSON-RPC"| MCP

    WebSearch --> ResponseJson
    WebSearch --> Telemetry
    WebSearch -->|"HTTPS"| DDG

    RoutingConfig --> Telemetry

    style Server fill:#c8e6c9
    style Telemetry fill:#fff9c4
    style RoutingConfig fill:#e1f5fe
    style RoutingEngine fill:#e1f5fe
    style AgentRuntime fill:#f3e5f5
    style McpTools fill:#fce4ec
    style WebSearch fill:#fce4ec
    style AtlassianMcp fill:#ffe0b2
    style ResponseJson fill:#f5f5f5
    style LLMClient fill:#e8f5e9
    style MCP fill:#eceff1
    style DDG fill:#eceff1
```

## Backend Module Interactions

The following diagram maps the runtime call graph between `agent-api/` modules and external services.

```mermaid
graph TD
    Server["server.js\nExpress entry-point"]
    Telemetry["telemetry.js\nOTEL + logEvent"]
    RoutingConfig["routing-config.js\nLoad agent-config.json"]
    RoutingEngine["routing-engine.js\nLangGraph state machine"]
    AgentRuntime["agent-runtime.js\nAgent loop + sessions"]
    McpTools["mcp-tools.js\nMCP tool discovery"]
    WebSearch["web-search.js\nDuckDuckGo search"]
    AtlassianMcp["atlassian-mcp.js\nMCP JSON-RPC"]
    ResponseJson["response-json.js\nSafe JSON parse"]
    LLM["ChatOpenAI\n(LangChain / OpenRouter)"]
    MCPServer["Atlassian MCP Server\n(external HTTP)"]
    DDG["DuckDuckGo API\n(external HTTPS)"]

    Server -->|"configureTelemetry()\nat startup"| Telemetry
    Server -->|"runAgentInteraction()"| AgentRuntime
    Server -->|"logEvent()"| Telemetry

    AgentRuntime -->|"loadRoutingConfig()"| RoutingConfig
    AgentRuntime -->|"buildRoutingGraph()\n→ invoke()"| RoutingEngine
    AgentRuntime -->|"buildMcpToolsFromDiscovery()\ngetMissingRequiredToolArgs()\ndetectJiraJqlWorkflow()"| McpTools
    AgentRuntime -->|"webSearchTool\nrunWebSearch()\nshouldAutoWebLookup()"| WebSearch
    AgentRuntime -->|"logEvent()"| Telemetry
    AgentRuntime -->|"model.invoke()"| LLM

    RoutingEngine -->|"reads config"| RoutingConfig

    McpTools -->|"initializeMcpSession()\ndiscoverMcpTools()\ncallMcpTool()"| AtlassianMcp
    McpTools -->|"logEvent()"| Telemetry
    AtlassianMcp -->|"HTTP POST JSON-RPC"| MCPServer

    WebSearch -->|"readJsonResponse()"| ResponseJson
    WebSearch -->|"logEvent()"| Telemetry
    WebSearch -->|"fetch()"| DDG

    RoutingConfig -->|"logEvent()"| Telemetry

    style Server fill:#c8e6c9
    style Telemetry fill:#fff9c4
    style RoutingConfig fill:#e1f5fe
    style RoutingEngine fill:#e1f5fe
    style AgentRuntime fill:#f3e5f5
    style McpTools fill:#fce4ec
    style WebSearch fill:#fce4ec
    style AtlassianMcp fill:#ffe0b2
    style ResponseJson fill:#f5f5f5
    style LLM fill:#e8f5e9
    style MCPServer fill:#eceff1
    style DDG fill:#eceff1
```

**Notes**:
- `telemetry.js`, `response-json.js`, and `routing-config.js` are **pure leaves** — they import nothing from inside the project
- `server.js` only knows about `agent-runtime.js` and `telemetry.js`; all internal wiring is hidden behind those modules
- External services (`LLM`, `MCPServer`, `DDG`) are called via the instrumented global `fetch` so all outbound calls automatically carry OTEL trace context

### Request Lifecycle Sequence

The sequence diagram below traces a single chat request from the browser through every module. The two alternate paths show the **Atlassian agent flow** (Jira/Confluence prompt) and the **orchestrator + web search flow** (general prompt with current-events hint).

```mermaid
sequenceDiagram
  autonumber
  participant FE as Browser / Frontend
  participant SRV as server.js
  participant TEL as telemetry.js
  participant RT as agent-runtime.js
  participant RC as routing-config.js
  participant RE as routing-engine.js
  participant WS as web-search.js
  participant MT as mcp-tools.js
  participant AM as atlassian-mcp.js
  participant LLM as ChatOpenAI (OpenRouter)
  participant DDG as DuckDuckGo API
  participant MCP as Atlassian MCP Server

  Note over SRV,TEL: Startup (once per process)
  SRV->>TEL: configureTelemetry()
  TEL-->>SRV: tracer ready, fetch instrumented
  SRV->>RT: import → loadRoutingConfig() + buildRoutingGraph()
  RT->>RC: loadRoutingConfig()
  RC-->>RT: routingConfig { keywords, llmConfig, … }
  RT->>RE: buildRoutingGraph(routingConfig)
  RE-->>RT: compiled LangGraph

  Note over FE,SRV: Incoming request
  FE->>SRV: POST /agent-api { sessionId, userPrompt }
  SRV->>TEL: logEvent(INFO, "request initiated")
  SRV->>RT: runAgentInteraction({ sessionId, userPrompt })

  RT->>RE: routingGraph.invoke({ userPrompt })
  RE-->>RT: { selectedAgentName, selectedSystemPrompt, … }
  RT->>TEL: logEvent(INFO, "routing decision")

  alt Atlassian agent selected (Jira / Confluence prompt)
    RT->>MT: buildMcpToolsFromDiscovery(mcpConfig)
    MT->>AM: initializeMcpSession(endpoint)
    AM->>MCP: POST /mcp initialize
    MCP-->>AM: sessionId
    AM-->>MT: sessionId
    MT->>AM: discoverMcpTools(endpoint, headers)
    AM->>MCP: POST /mcp tools/list
    MCP-->>AM: [tool definitions]
    AM-->>MT: mcpTools[]
    MT->>TEL: logEvent(INFO, "tools discovered")
    MT-->>RT: { tools, toolExecutors, toolDefinitions }

    RT->>LLM: model.invoke(messages + system prompt)
    LLM-->>RT: AIMessage { tool_calls: [jira_query] }

    RT->>MT: toolExecutors["jira_query"](args)
    MT->>AM: callMcpTool(endpoint, "jira_query", args)
    AM->>MCP: POST /mcp tools/call
    MCP-->>AM: result
    AM-->>MT: raw result
    MT-->>RT: normalised text result
    RT->>TEL: logEvent(INFO, "tool result")

    RT->>LLM: model.invoke(messages + ToolMessage)
    LLM-->>RT: AIMessage { content: "Here are your tickets…" }

  else Orchestrator selected (general / current-events prompt)
    RT->>WS: shouldAutoWebLookup(userPrompt)
    WS-->>RT: true
    RT->>WS: runWebSearch(userPrompt)
    WS->>DDG: GET api.duckduckgo.com?q=…
    DDG-->>WS: JSON payload
    WS-->>RT: formatted snippets + source URLs
    RT->>TEL: logEvent(INFO, "web lookup completed")

    RT->>LLM: model.invoke(messages + web context)
    LLM-->>RT: AIMessage { content: "According to…" }

    opt LLM requests explicit web_search tool call
      RT->>WS: runWebSearch(toolQuery)
      WS->>DDG: GET api.duckduckgo.com?q=…
      DDG-->>WS: JSON payload
      WS-->>RT: formatted snippets
      RT->>LLM: model.invoke(messages + ToolMessage)
      LLM-->>RT: AIMessage { content: final answer }
    end
  end

  RT->>TEL: logEvent(INFO, "agent response generated")
  RT-->>SRV: { agentResponse, tokenUsage, logs, costs }
  SRV->>TEL: logEvent(INFO, "request completed")
  SRV-->>FE: 200 { agentResponse, tokenUsage, logs }
```

## Agent Routing Flow

### Decision Tree

```mermaid
graph TD
    Input["User Message"]
    RegexCheck{"Matches Regex<br/>Pattern?"}
    KeywordCheck{"Contains<br/>Keywords?"}
    SemanticCheck{"Semantic<br/>Similarity > Threshold?"}
    Priority{"Apply Priority<br/>Ordering"}
    RouteOrch["Route to<br/>Orchestrator Agent"]
    RouteSpec["Route to<br/>Specialist Agent"]
    
    Input --> RegexCheck
    RegexCheck -->|"Yes"| Priority
    RegexCheck -->|"No"| KeywordCheck
    KeywordCheck -->|"Yes"| Priority
    KeywordCheck -->|"No"| SemanticCheck
    SemanticCheck -->|"Yes"| Priority
    SemanticCheck -->|"No"| RouteOrch
    Priority -->|"Specialist Rule"| RouteSpec
    Priority -->|"No Match"| RouteOrch
    RouteSpec -->|"Returns Data"| OrcResponse["Orchestrator decides:<br/>Web Search, Delegate,<br/>or Direct Answer"]
    
    style Input fill:#fff9c4
    style RegexCheck fill:#ffecb3
    style KeywordCheck fill:#ffecb3
    style SemanticCheck fill:#ffe082
    style Priority fill:#ffd54f
    style RouteOrch fill:#c8e6c9
    style RouteSpec fill:#a1d5a8
    style OrcResponse fill:#bbdefb
```

### Routing Strategy

**Priority Order** (evaluated sequentially):
1. **Regex Patterns** (deterministic, fastest) - e.g., `\bjira\b`
2. **Keywords** (deterministic, medium speed) - e.g., `["jira", "confluence", "ticket"]`
3. **Semantic Keywords** (LLM-based, slowest) - e.g., `["issue tracking", "knowledge base"]`

### Routing Configuration Example

```json
{
  "defaultAgentName": "orchestrator-agent",
  "agents": [
    {
      "name": "orchestrator-agent",
      "llm-config": {
        "model": "openai/gpt-4o-mini",
        "base-url": "$OPENROUTER_BASE_URL",
        "temperature": 0.2,
        "http-referer": "$OPENROUTER_HTTP_REFERER",
        "x-title": "$OPENROUTER_X_TITLE"
      },
      "delegation-rules": [
        {
          "target-agent": "atlassian-agent",
          "keywords": ["jira", "confluence", "issue", "ticket"],
          "semantic-keywords": ["issue tracking", "knowledge base"],
          "regex-patterns": ["\\bjira\\b", "\\bconfluence\\b"],
          "priority": 10,
          "min-confidence": 0.62
        }
      ]
    }
  ]
}
```

### Orchestrator Agent Decision Logic

When a request routes to the **Orchestrator Agent** or when it cannot be delegated, the agent decides:

| Scenario | Action | Example |
|----------|--------|---------|
| **Atlassian Delegation** | Pass to Atlassian Agent for real-time data | "Show me open JIRA tickets" → Queries Jira API in real-time |
| **Web Search Needed** | Use web search tools | "Latest AI developments?" → Performs web search for current info |
| **General Query** | Answer directly | "What is Python?" → Responds from training data |

**User Communication**: The system clearly informs users:
- ✅ "Let me check your Jira workspace..." (delegating)
- ✅ "Searching the web for current information..." (web search)
- ✅ Direct response with source attribution (general knowledge)

### Evaluation Order

## Session Management

### Session Lifecycle

```mermaid
sequenceDiagram
    Frontend->>Backend: POST /agent-api {sessionId, userPrompt}
    Backend->>SessionMgr: Get or Create session(sessionId)
    SessionMgr-->>Backend: Session{messages[], metadata}
    Backend->>LangGraph: Execute agent workflow
    LangGraph->>LLM: Chat completion request
    LLM-->>LangGraph: Response + tokenUsage
    LangGraph->>SessionMgr: Append messages to history
    Backend-->>Frontend: {agentResponse, tokenUsage, logs}
    Frontend->>Frontend: Render message, update state
```

### Session Structure

```javascript
{
  sessionId: "unique-session-id",
  messages: [
    { role: "human", content: "User message" },
    { role: "assistant", content: "Agent response" },
    // ... conversation history
  ],
  metadata: {
    createdAt: timestamp,
    lastActivityAt: timestamp,
    agentName: "orchestrator-agent",
    messageCount: number
  }
}
```

**Lifetime**: Sessions persist in-memory for the duration of server uptime. On server restart, all sessions are lost (consider persistent storage for production).

## Observability Architecture

### Tracing Hierarchy

```mermaid
graph TD
    RootSpan["HTTP Request Span<br/>(method, path)"]
    DelegationSpan["Delegation Span<br/>(routing decision)"]
    AgentSpan["Agent Workflow Span<br/>(agent execution)"]
    LLMSpan["LLM Call Span<br/>(method, model, tokens)"]
    
    RootSpan --> DelegationSpan
    RootSpan --> AgentSpan
    AgentSpan --> LLMSpan
    
    RootSpan -.->|"Attributes"| Attrs1["traceId<br/>spanId<br/>http.method<br/>url.path"]
    LLMSpan -.->|"Attributes"| Attrs2["model<br/>prompt_tokens<br/>completion_tokens"]
    
    style RootSpan fill:#e1f5fe
    style DelegationSpan fill:#b3e5fc
    style AgentSpan fill:#81d4fa
    style LLMSpan fill:#4fc3f7
    style Attrs1 fill:#f1f8e9
    style Attrs2 fill:#f1f8e9
```

### Log Format

Every event generates a structured JSON log:

```json
{
  "status": "INFO|WARNING|ERROR",
  "timestamp": "2026-06-19T10:30:45.123Z",
  "endpoint": "/agent-api",
  "message": "Agent API request completed successfully",
  "traceId": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "spanId": "xxxxxxxxxxxxxxxx",
  "httpStatusCode": 200,
  "error": null,
  "userData": {
    "sessionId": "session-123",
    "totalTokens": 1250,
    "responseLength": 500
  }
}
```

### Trace Exporters

- **Console**: Writes to stdout (default for local development)
- **OTLP HTTP**: Sends to OpenTelemetry collector endpoint
- **None**: Disables tracing (for performance-sensitive deployments)

## Deployment Considerations

### Scalability

- **Stateless API**: Multiple backend instances can run behind load balancer
- **Session Storage**: Current in-memory store limits to single instance; use Redis/database for multi-instance deployments
- **Frontend**: Deployed as static files (CDN-compatible)

### Security

- **CORS**: Configured in Express middleware; restrict to trusted origins
- **Secrets**: API keys stored in environment variables (never in config files)
- **Validation**: Zod schema validation on all inputs
- **Rate Limiting**: Not currently implemented; recommend adding for production

### Reliability

- **Error Handling**: Structured logging of all errors with trace context
- **Health Checks**: `/agent-api/health` endpoint for monitoring
- **Timeouts**: Configure LLM provider timeouts in LLMClient
- **Retry Logic**: Implement exponential backoff for transient failures

### Performance

- **Response Caching**: Consider caching common queries
- **Batch Processing**: Current architecture processes single requests; batch API could improve throughput
- **Token Optimization**: Monitor token usage and optimize prompts to reduce costs

