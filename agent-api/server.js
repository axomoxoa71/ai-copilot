import cors from "cors";
import express from "express";
import { z } from "zod";
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  configureTelemetry,
  logEvent,
  mapHttpStatusToLogLevel,
  traceparentFromSpanContext,
} from "./telemetry.js";
import {
  buildClientResponseLogOutput,
  makeInteractionLog,
  runAgentInteraction,
} from "./agent-runtime.js";
import { buildAllAgentCards, handleA2ARequest, normalizeTaskForA2A } from "./a2a-handler.js";

// Initialise OTEL (registers tracer provider, wraps global fetch).
configureTelemetry();

const app = express();
app.use(cors());
app.use(express.json());

const tracer = trace.getTracer("agent-api", "1.0.0");

// Create a server span for every HTTP request. If caller trace context exists,
// continue it; otherwise this starts a new trace root for backend-originated flows.
app.use((req, res, next) => {
  const extractedContext = propagation.extract(context.active(), req.headers);
  const requestSpan = tracer.startSpan(
    `HTTP ${req.method} ${req.path}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": req.method,
        "url.path": req.path,
        "url.full": `${req.protocol}://${req.get("host")}${req.originalUrl || req.path}`,
      },
    },
    extractedContext,
  );

  const requestContext = trace.setSpan(extractedContext, requestSpan);
  const requestSpanContext = requestSpan.spanContext();
  const responseTraceparent = traceparentFromSpanContext(requestSpanContext);

  if (responseTraceparent) {
    res.setHeader("traceparent", responseTraceparent);
  }
  res.setHeader("x-trace-id", requestSpanContext.traceId);

  let spanEnded = false;
  const finalizeSpan = (statusCode, statusMessage) => {
    if (spanEnded) {
      return;
    }
    spanEnded = true;

    requestSpan.setAttribute("http.response.status_code", statusCode);
    requestSpan.setStatus(
      statusCode >= 500
        ? { code: SpanStatusCode.ERROR, message: statusMessage || `HTTP ${statusCode}` }
        : { code: SpanStatusCode.OK },
    );

    logEvent({
      status: mapHttpStatusToLogLevel(statusCode),
      endpoint: req.originalUrl || req.path,
      message: `Inbound ${req.method} completed with status ${statusCode}`,
      traceId: requestSpanContext.traceId,
      spanId: requestSpanContext.spanId,
      httpStatusCode: statusCode,
    });

    requestSpan.end();
  };

  res.on("finish", () => {
    finalizeSpan(res.statusCode, res.statusMessage);
  });

  res.on("close", () => {
    finalizeSpan(res.statusCode || 499, "Client closed connection");
  });

  return context.with(requestContext, () => next());
});

function summarizeA2ARequestBody(body) {
  if (!body || typeof body !== "object") {
    return { hasBody: false };
  }

  const rpcBody = body;
  const params = rpcBody.params && typeof rpcBody.params === "object" ? rpcBody.params : null;
  const message = params?.message && typeof params.message === "object" ? params.message : null;

  return {
    hasBody: true,
    jsonrpc: typeof rpcBody.jsonrpc === "string" ? rpcBody.jsonrpc : null,
    id: rpcBody.id ?? null,
    method: typeof rpcBody.method === "string" ? rpcBody.method : null,
    hasParams: Boolean(params),
    messageId: typeof message?.messageId === "string" ? message.messageId : null,
    role: typeof message?.role === "string" ? message.role : null,
    partsCount: Array.isArray(message?.parts) ? message.parts.length : 0,
  };
}

function summarizeA2AResponsePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { hasPayload: false };
  }

  const rpcPayload = payload;
  const hasError = Boolean(rpcPayload.error);
  const error = hasError && typeof rpcPayload.error === "object" ? rpcPayload.error : null;
  const result = rpcPayload.result && typeof rpcPayload.result === "object" ? rpcPayload.result : null;
  const task = result?.task && typeof result.task === "object"
    ? result.task
    : result?.status && result?.id
      ? result
      : null;
  const message = result?.message && typeof result.message === "object" ? result.message : null;

  return {
    hasPayload: true,
    jsonrpc: typeof rpcPayload.jsonrpc === "string" ? rpcPayload.jsonrpc : null,
    id: rpcPayload.id ?? null,
    hasResult: Boolean(rpcPayload.result),
    hasError,
    errorCode: typeof error?.code === "number" ? error.code : null,
    errorMessage: typeof error?.message === "string" ? error.message : null,
    taskId: typeof task?.id === "string" ? task.id : null,
    contextId: typeof task?.contextId === "string" ? task.contextId : null,
    taskState: typeof task?.status?.state === "string" ? task.status.state : null,
    messageId: typeof message?.messageId === "string" ? message.messageId : null,
    resultKeys: result ? Object.keys(result) : [],
  };
}

function logA2ARequest(req, userData = {}) {
  logEvent({
    status: "INFO",
    endpoint: req.originalUrl || req.path,
    message: "A2A request received",
    userData: {
      method: req.method,
      ...userData,
    },
  });
}

function logA2AResponse(req, statusCode, payload, userData = {}) {
  logEvent({
    status: statusCode >= 400 ? "WARNING" : "INFO",
    endpoint: req.originalUrl || req.path,
    message: "A2A response sent",
    userData: {
      method: req.method,
      statusCode,
      response: summarizeA2AResponsePayload(payload),
      ...userData,
    },
  });
}

function writeSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ---- Health ----------------------------------------------------------------

app.get("/agent-api/health", (_req, res) => {
  res.locals.responseMessage = "Health check succeeded.";
  res.status(200).json({
    status: "ok",
    hasOpenRouterApiKey: Boolean(process.env.OPENROUTER_API_KEY),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// ---- Chat endpoint ---------------------------------------------------------

const requestSchema = z.object({
  sessionId: z.string().min(1),
  userPrompt: z.string().min(1),
  model: z.string().optional(),
});

app.post("/agent-api", async (req, res) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      logEvent({
        status: "WARNING",
        endpoint: req.originalUrl || req.path,
        message: "Invalid request payload",
        userData: { errors: parsed.error.flatten() },
      });
      res.locals.responseMessage = "Invalid request payload.";
      return res.status(400).json({
        error: "Invalid request payload.",
        details: parsed.error.flatten(),
      });
    }

    const { sessionId, userPrompt } = parsed.data;

    logEvent({
      status: "INFO",
      endpoint: req.originalUrl || req.path,
      message: "Agent API request initiated",
      userData: { sessionId, promptLength: userPrompt.length },
    });

    const data = await runAgentInteraction(parsed.data);
    const responseLogs = Array.isArray(data.logs) ? [...data.logs] : [];
    responseLogs.push(
      makeInteractionLog(
        "api",
        "Returned response to client.",
        { sessionId },
        buildClientResponseLogOutput(data.agentResponse, data.tokenUsage),
        "interaction",
        { target: `POST ${req.originalUrl || req.path}` },
      ),
    );

    logEvent({
      status: "INFO",
      endpoint: req.originalUrl || req.path,
      message: "Agent API request completed successfully",
      userData: {
        sessionId,
        totalTokens: data.tokenUsage?.total_tokens,
        responseLength: data.agentResponse?.length,
      },
    });

    res.locals.responseMessage = "Agent response generated successfully.";
    return res.status(200).json({ ...data, logs: responseLogs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    logEvent({
      status: "ERROR",
      endpoint: req.originalUrl || req.path,
      message: `Agent request failed: ${message}`,
      error,
      userData: { sessionId: req.body?.sessionId },
    });
    res.locals.responseMessage = `Agent request failed: ${message}`;
    return res.status(500).json({ error: message });
  }
});

app.post("/agent-api/stream", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    logEvent({
      status: "WARNING",
      endpoint: req.originalUrl || req.path,
      message: "Invalid stream request payload",
      userData: { errors: parsed.error.flatten() },
    });
    res.locals.responseMessage = "Invalid stream request payload.";
    return res.status(400).json({
      error: "Invalid request payload.",
      details: parsed.error.flatten(),
    });
  }

  const { sessionId, userPrompt, model } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let clientClosed = false;
  req.on("aborted", () => {
    clientClosed = true;
  });
  res.on("close", () => {
    clientClosed = true;
  });

  const sendEvent = (event, payload) => {
    if (clientClosed) {
      return;
    }
    writeSseEvent(res, event, payload);
  };

  sendEvent("started", {
    sessionId,
    timestamp: new Date().toISOString(),
    message: "Streaming agent execution started.",
  });

  try {
    const data = await runAgentInteraction({
      sessionId,
      userPrompt,
      model,
      onProgress: (progressEvent) => {
        sendEvent("progress", {
          sessionId,
          timestamp: new Date().toISOString(),
          ...progressEvent,
        });
      },
    });

    const responseLogs = Array.isArray(data.logs) ? [...data.logs] : [];
    responseLogs.push(
      makeInteractionLog(
        "api",
        "Returned streaming response to client.",
        { sessionId },
        buildClientResponseLogOutput(data.agentResponse, data.tokenUsage),
        "interaction",
        { target: `POST ${req.originalUrl || req.path}` },
      ),
    );

    sendEvent("final", { ...data, logs: responseLogs });
    sendEvent("done", {
      sessionId,
      timestamp: new Date().toISOString(),
      message: "Streaming agent execution finished.",
    });

    res.locals.responseMessage = "Streaming agent response generated successfully.";
    if (!clientClosed) {
      return res.end();
    }
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    logEvent({
      status: "ERROR",
      endpoint: req.originalUrl || req.path,
      message: `Streaming agent request failed: ${message}`,
      error,
      userData: { sessionId },
    });

    sendEvent("error", { error: message, sessionId, timestamp: new Date().toISOString() });
    res.locals.responseMessage = `Streaming agent request failed: ${message}`;
    if (!clientClosed) {
      return res.end();
    }
    return undefined;
  }
});

// ---- Start -----------------------------------------------------------------

const port = Number(process.env.AGENT_API_PORT || 8787);
const configuredA2ABaseUrl = process.env.AGENT_API_BASE_URL || `http://localhost:${port}`;

// Build agent cards dynamically per request so the URL reflects the caller's network context.
// Falls back to AGENT_API_BASE_URL or localhost when Host header is absent.
function getAgentCards(req) {
  const host = req.headers.host || `localhost:${port}`;
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const baseUrl = `${protocol}://${host}`;
  return buildAllAgentCards(baseUrl);
}

// Keep a startup set for existence checks (agent name validation).
const agentCards = buildAllAgentCards(configuredA2ABaseUrl);

// ---- A2A Protocol endpoints ------------------------------------------------

// Default well-known card for the first (orchestrator) agent.
app.get("/.well-known/agent.json", (req, res) => {
  logA2ARequest(req, { route: "default-well-known" });
  const cards = getAgentCards(req);
  const defaultCard = cards.values().next().value;
  if (!defaultCard) {
    const response = { error: "No agents configured." };
    logA2AResponse(req, 404, response, { route: "default-well-known" });
    return res.status(404).json(response);
  }
  logA2AResponse(req, 200, defaultCard, {
    route: "default-well-known",
    agentName: defaultCard.name,
  });
  return res.status(200).json(defaultCard);
});

// Per-agent well-known card: GET /a2a/:agentName/.well-known/agent.json
app.get("/a2a/:agentName/.well-known/agent.json", (req, res) => {
  const { agentName } = req.params;
  logA2ARequest(req, { route: "agent-well-known", agentName });
  if (!agentCards.has(agentName)) {
    const response = { error: `Agent '${agentName}' not found.` };
    logA2AResponse(req, 404, response, { route: "agent-well-known", agentName });
    return res.status(404).json(response);
  }
  const card = getAgentCards(req).get(agentName);
  logA2AResponse(req, 200, card, {
    route: "agent-well-known",
    agentName,
  });
  return res.status(200).json(card);
});

// Per-agent A2A task endpoint: POST /a2a/:agentName
app.post("/a2a/:agentName", async (req, res) => {
  const { agentName } = req.params;

  logA2ARequest(req, {
    route: "agent-rpc",
    agentName,
    request: summarizeA2ARequestBody(req.body),
  });

  if (!agentCards.has(agentName)) {
    const response = {
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32001, message: `Agent '${agentName}' not found.` },
    };
    logA2AResponse(req, 404, response, {
      route: "agent-rpc",
      agentName,
    });
    return res.status(404).json(response);
  }

  const response = await handleA2ARequest(req.body, agentName);
  logA2AResponse(req, 200, response, {
    route: "agent-rpc",
    agentName,
  });
  return res.status(200).json(response);
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`agent-api listening on http://localhost:${port}/agent-api`);
  // eslint-disable-next-line no-console
  console.log(`agent-api health endpoint on http://localhost:${port}/agent-api/health`);
  // eslint-disable-next-line no-console
  console.log(`A2A well-known card on http://localhost:${port}/.well-known/agent.json`);
  // eslint-disable-next-line no-console
  console.log(`A2A configured base URL for cards: ${configuredA2ABaseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`A2A JSON-RPC endpoint template: ${configuredA2ABaseUrl}/a2a/{agentName}`);

  // Self-check: verify normalizeTaskForA2A is available and produces artifactId.
  const selfCheckTask = {
    id: "startup-check",
    contextId: "startup-check-ctx",
    status: { state: "completed", timestamp: new Date().toISOString() },
    artifacts: [{ index: 0, parts: [{ type: "text", text: "ok" }] }],
  };
  const selfCheckResult = normalizeTaskForA2A(selfCheckTask);
  const a2aArtifactIdOk = typeof selfCheckResult.artifacts[0]?.artifactId === "string";

  logEvent({
    status: a2aArtifactIdOk ? "INFO" : "ERROR",
    endpoint: "startup",
    message: a2aArtifactIdOk
      ? "A2A artifact normalization self-check PASSED — artifactId will be present on all task artifacts"
      : "A2A artifact normalization self-check FAILED — artifactId may be missing from task artifacts (Inspector validation will fail)",
    userData: {
      a2aArtifactIdOk,
      sampleArtifactId: selfCheckResult.artifacts[0]?.artifactId ?? null,
    },
  });

  logEvent({
    status: "INFO",
    endpoint: "startup",
    message: "A2A startup configuration",
    userData: {
      port,
      configuredA2ABaseUrl,
      agentCount: agentCards.size,
      agents: [...agentCards.keys()],
      rpcEndpointTemplate: `${configuredA2ABaseUrl}/a2a/{agentName}`,
    },
  });

  for (const agentName of agentCards.keys()) {
    // eslint-disable-next-line no-console
    console.log(`A2A agent [${agentName}]: http://localhost:${port}/a2a/${agentName}`);
  }
});
