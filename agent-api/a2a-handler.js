/**
 * A2A (Agent-to-Agent) Protocol Handler
 *
 * Implements the A2A Protocol (https://a2a-protocol.org/) for exposing
 * agents as interoperable A2A endpoints. Each agent is accessible via:
 *   GET  /a2a/:agentName/.well-known/agent.json  — Agent Card
 *   POST /a2a/:agentName                         — JSON-RPC 2.0 endpoint
 *
 * Supported JSON-RPC methods (A2A spec v1.0):
 *   message/send — Send a message to the agent and get a response (task or message)
 *   tasks/get    — Retrieve a previously submitted task by id
 *   tasks/cancel — Cancel a pending/working task
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAgentInteraction } from "./agent-runtime.js";
import { logEvent } from "./telemetry.js";

// ---------------------------------------------------------------------------
// Task store (in-memory, per server process)
// ---------------------------------------------------------------------------

/** @type {Map<string, A2ATask>} */
const taskStore = new Map();

// ---------------------------------------------------------------------------
// Agent card builder
// ---------------------------------------------------------------------------

/**
 * Build the A2A Agent Card for a given agent config entry.
 * @param {object} agentConfig - Single agent entry from routing config agents array.
 * @param {string} serverBaseUrl - e.g. "http://localhost:8787"
 * @returns {object} A2A Agent Card
 */
export function buildAgentCard(agentConfig, serverBaseUrl) {
  const agentName = agentConfig.name ?? "unknown-agent";
  const agentUrl = `${serverBaseUrl}/a2a/${encodeURIComponent(agentName)}`;

  const capabilities = agentConfig.capabilities ?? [];
  const skills = capabilities.map((cap) => ({
    id: cap,
    name: cap
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    description: `Capability: ${cap}`,
    tags: [cap],
  }));

  // Derive skills from delegation-rules if this is the orchestrator
  const delegationRules = agentConfig["delegation-rules"] ?? [];
  for (const rule of delegationRules) {
    const target = rule["target-agent"] ?? "";
    const category = rule.category ?? target;
    if (target && !skills.find((s) => s.id === `delegate-to-${target}`)) {
      skills.push({
        id: `delegate-to-${target}`,
        name: `Delegate to ${target}`,
        description: `Delegates ${category} tasks to ${target}`,
        tags: rule.keywords?.slice(0, 5) ?? [category],
      });
    }
  }

  return {
    name: agentName,
    description:
      agentConfig.description ??
      `Agent: ${agentName}. Role: ${agentConfig.role ?? "agent"}.`,
    url: agentUrl,
    version: "1.0.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: skills.length > 0 ? skills : [
      {
        id: "chat",
        name: "Chat",
        description: "Process natural language requests",
        tags: ["chat", "nlp"],
      },
    ],
  };
}

/**
 * Build all agent cards keyed by agent name.
 * @param {string} serverBaseUrl
 * @returns {Map<string, object>}
 */
export function buildAllAgentCards(serverBaseUrl) {
  const configPath = path.resolve(process.cwd(), "src", "resources", "agent-config.json");
  let agents = [];

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.agents)) {
      agents = parsed.agents.filter((a) => a && typeof a === "object" && typeof a.name === "string");
    }
  } catch {
    // If config cannot be read, fall back to empty list
  }

  const cards = new Map();
  for (const agent of agents) {
    cards.set(agent.name, buildAgentCard(agent, serverBaseUrl));
  }
  return cards;
}

// -------------------------------------------------------------------------
// A2A task lifecycle
// -------------------------------------------------------------------------

const TaskState = {
  SUBMITTED: "submitted",
  WORKING: "working",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELED: "canceled",
  INPUT_REQUIRED: "input-required",
};

function updateTaskState(task, state, message) {
  task.status = {
    state,
    timestamp: new Date().toISOString(),
    ...(message ? { message } : {}),
  };
}

/**
 * Normalize task payload to include required A2A fields.
 * Ensures every artifact has a stable artifactId.
 * @param {A2ATask} task
 * @returns {object}
 */
export function normalizeTaskForA2A(task) {
  const artifacts = Array.isArray(task?.artifacts)
    ? task.artifacts.map((artifact, index) => ({
      artifactId:
        typeof artifact?.artifactId === "string" && artifact.artifactId.trim().length > 0
          ? artifact.artifactId
          : `${task.id}-artifact-${index}`,
      index: typeof artifact?.index === "number" ? artifact.index : index,
      parts: Array.isArray(artifact?.parts) ? artifact.parts : [],
    }))
    : [];

  return {
    id: task.id,
    contextId: task.contextId,
    status: task.status,
    artifacts,
    ...(process.env.A2A_INCLUDE_HISTORY === "true" && Array.isArray(task.history)
      ? { history: task.history }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

const JSON_RPC_VERSION = "2.0";

function rpcSuccess(id, result) {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

// Standard JSON-RPC error codes
const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;
// A2A-specific error codes
const A2A_TASK_NOT_FOUND = -32001;
const A2A_TASK_NOT_CANCELABLE = -32002;

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

/**
 * Extract plain text from A2A message parts.
 * Handles both standard A2A format and variations.
 * @param {object} message - {role, parts[]}
 * @returns {string}
 */
function extractTextFromMessage(message) {
  if (!message || !Array.isArray(message.parts)) return "";
  
  const texts = message.parts
    .map((p) => {
      if (!p) return null;
      // Handle standard A2A: { type: "text", text: "..." }
      if (p.type === "text" && typeof p.text === "string") return p.text;
      // Handle direct text property
      if (typeof p.text === "string") return p.text;
      // Handle string part (edge case)
      if (typeof p === "string") return p;
      return null;
    })
    .filter((t) => t !== null)
    .map((t) => String(t).trim())
    .filter((t) => t.length > 0);
  
  return texts.join("\n");
}

/**
 * Handle message/send (A2A spec v1.0)
 *
 * Sends a message to the agent. Request params must include:
 *   message: {
 *     messageId: string (required)
 *     role: "user" | "agent" (required)
 *     parts: Part[] (required)
 *     contextId?: string (optional, defaults to generated UUID)
 *     taskId?: string (optional, for continuing existing task)
 *     metadata?: Record<string, any>
 *   }
 *   configuration?: MessageSendConfiguration
 *   metadata?: Record<string, any>
 *
 * Response is SendMessageResponse:
 *   result contains either a Task or a Message object (not wrapped)
 */
async function handleMessageSend(params, agentName) {
  if (!params || typeof params !== "object") {
    return { error: { code: RPC_INVALID_PARAMS, message: "params required" } };
  }

  const message = params.message;
  if (!message || typeof message !== "object") {
    return { error: { code: RPC_INVALID_PARAMS, message: "params.message required" } };
  }

  // Validate required message fields per A2A spec v1.0
  if (typeof message.messageId !== "string" || message.messageId.trim().length === 0) {
    return { error: { code: RPC_INVALID_PARAMS, message: "params.message.messageId (string) required" } };
  }
  if (typeof message.role !== "string" || !["user", "agent"].includes(message.role)) {
    return { error: { code: RPC_INVALID_PARAMS, message: "params.message.role must be 'user' or 'agent'" } };
  }
  if (!Array.isArray(message.parts) || message.parts.length === 0) {
    return { error: { code: RPC_INVALID_PARAMS, message: "params.message.parts must be a non-empty array" } };
  }

  // Extract text from message parts
  const userPrompt = extractTextFromMessage(message);
  if (!userPrompt.trim()) {
    logEvent({
      status: "WARNING",
      endpoint: `/a2a/${agentName}`,
      message: "A2A message/send: no text extracted from parts",
      userData: {
        messageId: message.messageId,
        partsCount: Array.isArray(message.parts) ? message.parts.length : 0,
      },
    });
    return { error: { code: RPC_INVALID_PARAMS, message: "Message must contain at least one non-empty text part" } };
  }

  // Use taskId if provided, otherwise generate one
  const taskId = typeof message.taskId === "string" && message.taskId.trim().length > 0
    ? message.taskId
    : randomUUID();

  // Use contextId if provided, otherwise generate one
  const contextId = typeof message.contextId === "string" && message.contextId.trim().length > 0
    ? message.contextId
    : randomUUID();

  // Create or retrieve task
  let task = taskStore.get(taskId);
  if (!task) {
    task = {
      id: taskId,
      contextId,
      status: { state: TaskState.SUBMITTED, timestamp: new Date().toISOString() },
      history: [message],
    };
    taskStore.set(taskId, task);
  } else {
    // Continuing an existing task
    task.history.push(message);
  }

  updateTaskState(task, TaskState.WORKING);

  logEvent({
    status: "INFO",
    endpoint: `/a2a/${agentName}`,
    message: "A2A message/send started",
    userData: { taskId, contextId, agentName, promptLength: userPrompt.length },
  });

  try {
    const interactionResult = await runAgentInteraction({
      sessionId: contextId,
      userPrompt,
    });

    const agentResponse = interactionResult.agentResponse ?? "";

    // Create response message
    const responseMessage = {
      messageId: randomUUID(),
      role: "agent",
      parts: [{ type: "text", text: agentResponse }],
      contextId,
      taskId,
    };

    // Per A2A spec, return the final task state.
    task.status = {
      state: TaskState.COMPLETED,
      timestamp: new Date().toISOString(),
    };
    task.history.push(responseMessage);
    task.artifacts = [
      {
        artifactId: `${taskId}-artifact-0`,
        index: 0,
        parts: responseMessage.parts,
      },
    ];

    logEvent({
      status: "INFO",
      endpoint: `/a2a/${agentName}`,
      message: "A2A message/send completed",
      userData: {
        taskId,
        contextId,
        agentName,
        totalTokens: interactionResult.tokenUsage?.total_tokens,
      },
    });

    const responseTask = normalizeTaskForA2A(task);

    logEvent({
      status: "INFO",
      endpoint: `/a2a/${agentName}`,
      message: "A2A response task structure",
      userData: {
        taskId: responseTask.id,
        contextId: responseTask.contextId,
        state: responseTask.status?.state ?? null,
        artifactsCount: Array.isArray(responseTask.artifacts) ? responseTask.artifacts.length : 0,
      },
    });

    // message/send success should return a top-level Task object in result.
    return { result: responseTask };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    task.status = {
      state: TaskState.FAILED,
      timestamp: new Date().toISOString(),
      message: errMsg,
    };

    logEvent({
      status: "ERROR",
      endpoint: `/a2a/${agentName}`,
      message: `A2A message/send failed: ${errMsg}`,
      error: err,
      userData: { taskId, contextId, agentName },
    });

    return { error: { code: RPC_INTERNAL_ERROR, message: errMsg } };
  }
}

/**
 * Handle tasks/get — retrieve a task from the in-memory store.
 */
function handleTasksGet(params) {
  if (!params || typeof params.id !== "string") {
    return { error: { code: RPC_INVALID_PARAMS, message: "params.id is required" } };
  }

  const task = taskStore.get(params.id);
  if (!task) {
    return { error: { code: A2A_TASK_NOT_FOUND, message: `Task ${params.id} not found` } };
  }

  return { result: normalizeTaskForA2A(task) };
}

/**
 * Handle tasks/cancel — mark a submitted/working task as canceled.
 */
function handleTasksCancel(params) {
  if (!params || typeof params.id !== "string") {
    return { error: { code: RPC_INVALID_PARAMS, message: "params.id is required" } };
  }

  const task = taskStore.get(params.id);
  if (!task) {
    return { error: { code: A2A_TASK_NOT_FOUND, message: `Task ${params.id} not found` } };
  }

  const cancelableStates = [TaskState.SUBMITTED, TaskState.WORKING, TaskState.INPUT_REQUIRED];
  if (!cancelableStates.includes(task.status.state)) {
    return {
      error: {
        code: A2A_TASK_NOT_CANCELABLE,
        message: `Task ${params.id} is in state '${task.status.state}' and cannot be canceled`,
      },
    };
  }

  updateTaskState(task, TaskState.CANCELED);
  return { result: normalizeTaskForA2A(task) };
}

// ---------------------------------------------------------------------------
// Main request dispatcher
// ---------------------------------------------------------------------------

/**
 * Process an A2A JSON-RPC request for a specific agent.
 * @param {object} body - Parsed request body
 * @param {string} agentName - Target agent name
 * @returns {Promise<object>} JSON-RPC response object
 */
export async function handleA2ARequest(body, agentName) {
  const requestId = body?.id ?? null;

  if (!body || typeof body !== "object") {
    return rpcError(null, RPC_PARSE_ERROR, "Parse error: body must be a JSON object");
  }

  if (body.jsonrpc !== "2.0") {
    return rpcError(requestId, RPC_INVALID_REQUEST, "jsonrpc must be '2.0'");
  }

  const method = body.method;
  const params = body.params;

  let outcome;
  switch (method) {
    case "message/send":
      outcome = await handleMessageSend(params, agentName);
      break;
    case "tasks/get":
      outcome = handleTasksGet(params);
      break;
    case "tasks/cancel":
      outcome = handleTasksCancel(params);
      break;
    default:
      return rpcError(requestId, RPC_METHOD_NOT_FOUND, `Method '${method}' not found`);
  }

  if (outcome.error) {
    return rpcError(requestId, outcome.error.code, outcome.error.message);
  }

  return rpcSuccess(requestId, outcome.result);
}
