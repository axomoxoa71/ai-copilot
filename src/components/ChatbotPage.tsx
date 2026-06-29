import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentConfig } from "../types/agent";
import "./ChatbotPage.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = "user" | "assistant";

type Attachment = {
  name: string;
  mimeType: string;
  textPreview: string; // first 2 000 chars for text files
};

type LogActor = "user" | "api" | "agent" | "tool";

type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type ExecutionLog = {
  actor: LogActor;
  timestamp: string;
  type?: string;
  message: string;
  input: unknown;
  output: unknown;
  agent?: string;
  target?: string;
  mcpServer?: string;
  mcpTool?: string;
};

type ExecutionCosts = {
  tokenUsage: TokenUsage;
  totalCostUsd: number | null;
  model?: string;
};

type ModelOption = {
  id: string;
  label: string;
};

type MessageErrorInfo = {
  traceId: string;
  errorMessage: string;
  errorDetails: string;
  stackTrace: string;
};

type AgentProgressUpdate =
  | { kind: "status"; message: string }
  | { kind: "log"; log: ExecutionLog }
  | { kind: "partial"; delta: string; accumulated: string };

type AssistantMessageVariant = "intermediate" | "final";

type Message = {
  id: string;
  role: Role;
  content: string;
  assistantVariant?: AssistantMessageVariant;
  attachment?: Attachment;
  timestamp: Date;
  isError?: boolean;
  logs?: ExecutionLog[];
  costs?: ExecutionCosts | null;
  parentUserMessageId?: string;
  errorInfo?: MessageErrorInfo;
};

type Session = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
};

function inferAssistantMessageVariant(content: string): AssistantMessageVariant {
  return content.startsWith("Execution updates:") ? "intermediate" : "final";
}

class AgentRequestError extends Error {
  traceId?: string;
  userMessage?: string;

  constructor(message: string, traceId?: string, userMessage?: string) {
    super(message);
    this.name = "AgentRequestError";
    this.traceId = traceId;
    this.userMessage = userMessage;
  }
}

type LogLevel = "INFO" | "WARNING" | "ERROR";

function getLevelStyle(level: LogLevel): string {
  // These styles are used with browser console %c formatting.
  if (level === "ERROR") return "color:#fff;background:#b42318;padding:2px 6px;border-radius:4px;font-weight:700;";
  if (level === "WARNING") return "color:#1f2937;background:#f59e0b;padding:2px 6px;border-radius:4px;font-weight:700;";
  return "color:#fff;background:#2563eb;padding:2px 6px;border-radius:4px;font-weight:700;";
}

function extractTraceIdFromResponse(response: Response): string | undefined {
  const directTraceId = response.headers.get("x-trace-id")?.trim();
  if (directTraceId) return directTraceId;

  const traceparent = response.headers.get("traceparent")?.trim();
  if (!traceparent) return undefined;

  // W3C traceparent uses trace id as the second segment: version-traceId-spanId-flags.
  const parts = traceparent.split("-");
  if (parts.length < 4) return undefined;
  return parts[1] || undefined;
}

function getTraceIdFromError(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "traceId" in error &&
    typeof (error as { traceId?: unknown }).traceId === "string"
  ) {
    return (error as { traceId: string }).traceId;
  }
  return undefined;
}

function getUserMessageFromError(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "userMessage" in error &&
    typeof (error as { userMessage?: unknown }).userMessage === "string"
  ) {
    return (error as { userMessage: string }).userMessage;
  }
  return undefined;
}

function getMessageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error.";
}

function getStackFromError(error: unknown): string | undefined {
  if (
    typeof error === "object"
    && error !== null
    && "stack" in error
    && typeof (error as { stack?: unknown }).stack === "string"
  ) {
    return (error as { stack: string }).stack;
  }

  return undefined;
}

function normalizeMessageErrorInfo(value: unknown): MessageErrorInfo | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const info = value as Record<string, unknown>;
  const traceId = typeof info.traceId === "string" ? info.traceId : "unavailable";
  const errorMessage = typeof info.errorMessage === "string" ? info.errorMessage : "Unknown error.";
  const errorDetails = typeof info.errorDetails === "string" ? info.errorDetails : errorMessage;
  const stackTrace = typeof info.stackTrace === "string" ? info.stackTrace : "unavailable";

  return { traceId, errorMessage, errorDetails, stackTrace };
}

function parseErrorInfoFromMessage(message: Message): MessageErrorInfo {
  const normalized = normalizeMessageErrorInfo(message.errorInfo);
  if (normalized) {
    return normalized;
  }

  const lines = message.content.split(/\r?\n/);
  const traceLine = lines.find((line) => line.startsWith("Trace ID:"));
  const detailsLine = lines.find((line) => line.startsWith("Error Details:"));

  const traceId = traceLine ? traceLine.replace("Trace ID:", "").trim() : "unavailable";
  const errorDetails = detailsLine
    ? detailsLine.replace("Error Details:", "").trim()
    : message.content.trim() || "Unknown error.";

  return {
    traceId,
    errorMessage: errorDetails,
    errorDetails,
    stackTrace: "unavailable",
  };
}

function extractToolFailureSummary(logs: ExecutionLog[]): {
  hasFailure: boolean;
  errorMessage: string;
  errorDetails: string;
} {
  const toolErrors = logs
    .filter((log) => log.actor === "tool")
    .map((log) => {
      const outputRecord = log.output && typeof log.output === "object"
        ? (log.output as Record<string, unknown>)
        : null;
      const resultText = typeof outputRecord?.result === "string"
        ? outputRecord.result.trim()
        : "";

      return {
        message: log.message,
        resultText,
      };
    })
    .filter((entry) => /^error\b/i.test(entry.resultText));

  if (toolErrors.length === 0) {
    return {
      hasFailure: false,
      errorMessage: "",
      errorDetails: "",
    };
  }

  const details = toolErrors
    .slice(0, 5)
    .map((entry, index) => `${index + 1}. ${entry.resultText}`)
    .join("\n");

  const firstError = toolErrors[0]?.resultText || "Tool execution failed.";

  return {
    hasFailure: true,
    errorMessage: "Tool invocation failed during execution.",
    errorDetails: [
      `Detected ${toolErrors.length} tool error(s).`,
      `Primary failure: ${firstError}`,
      "",
      "Tool failures:",
      details,
    ].join("\n"),
  };
}

function logWithLevel(level: LogLevel, context?: string, traceId?: string, error?: unknown) {
  const payload = {
    level,
    context,
    traceId: traceId ?? "unavailable",
    message: getMessageFromError(error),
    error,
  };

  const label = `%c${level}%c [ChatbotPage]`;
  const levelStyle = getLevelStyle(level);
  const resetStyle = "color:inherit;background:transparent;font-weight:normal;";

  if (level === "ERROR") {
    console.error(label, levelStyle, resetStyle, payload);
    return;
  }

  if (level === "WARNING") {
    console.warn(label, levelStyle, resetStyle, payload);
    return;
  }

  console.info(label, levelStyle, resetStyle, payload);
}

function logErrorWithTraceId(error: unknown, traceId?: string, context?: string) {
  logWithLevel("ERROR", context, traceId, error);
}

// ---------------------------------------------------------------------------
// Local-storage helpers
// ---------------------------------------------------------------------------

const SESSIONS_KEY = "ai-copilot-chat-sessions";
const ACTIVE_KEY = "ai-copilot-active-session";

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Record<string, unknown>[]).map((s) => ({
      id: s.id as string,
      title: s.title as string,
      createdAt: new Date(s.createdAt as string),
      updatedAt: new Date(s.updatedAt as string),
      messages: ((s.messages as Record<string, unknown>[]) ?? []).map((m) => ({
        id: m.id as string,
        role: m.role as Role,
        content: m.content as string,
        assistantVariant:
          m.role === "assistant"
            ? ((m.assistantVariant as AssistantMessageVariant | undefined) ??
              inferAssistantMessageVariant((m.content as string) ?? ""))
            : undefined,
        attachment: m.attachment as Attachment | undefined,
        timestamp: new Date(m.timestamp as string),
        isError: m.isError as boolean | undefined,
        logs: normalizeLogs(m.logs),
        costs: normalizeCosts(m.costs),
        parentUserMessageId: m.parentUserMessageId as string | undefined,
        errorInfo: normalizeMessageErrorInfo(m.errorInfo),
      })),
    }));
  } catch (error) {
    logErrorWithTraceId(error, undefined, "loadSessions");
    return [];
  }
}

function persistSessions(sessions: Session[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch (error) {
    logErrorWithTraceId(error, undefined, "persistSessions");
    // ignore storage failures
  }
}

function makeSession(): Session {
  return {
    id: crypto.randomUUID(),
    title: "New conversation",
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function deriveTitle(content: string): string {
  const t = content.trim();
  return t.length === 0 ? "New conversation" : t.length > 60 ? t.slice(0, 60) + "…" : t;
}

// ---------------------------------------------------------------------------
// Agent API helpers
// ---------------------------------------------------------------------------

function buildAuthHeader(agent: AgentConfig): string | null {
  if (!agent.basicAuthUser || !agent.basicAuthPassword) return null;
  return `Basic ${btoa(`${agent.basicAuthUser}:${agent.basicAuthPassword}`)}`;
}

function isLocalAgentApiUrl(url: string): boolean {
  return /\/agent-api\/?$/i.test(url);
}

function buildHealthUrl(url: string): string {
  return url.replace(/\/agent-api\/?$/i, "/agent-api/health");
}

function buildStreamUrl(url: string): string {
  return url.replace(/\/agent-api\/?$/i, "/agent-api/stream");
}

type ClientTraceContext = {
  traceId: string;
  spanId: string;
  traceparent: string;
};

function randomHex(length: number): string {
  const byteLength = Math.ceil(length / 2);
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, length);
}

function createClientTraceContext(): ClientTraceContext {
  const traceId = randomHex(32);
  const spanId = randomHex(16);
  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

function addTraceHeaders(headers: Record<string, string>, trace: ClientTraceContext) {
  headers.traceparent = trace.traceparent;
  headers["x-trace-id"] = trace.traceId;
}

function extractAssistantText(payload: Record<string, unknown>): string | null {
  const direct = [
    payload.answer,
    payload.response,
    payload.message,
    payload.content,
    payload.text,
  ].find((value) => typeof value === "string");

  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }

  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (typeof first === "object" && first !== null) {
      const item = first as Record<string, unknown>;
      if (typeof item.text === "string") return item.text;

      const message = item.message;
      if (typeof message === "object" && message !== null) {
        const messageRecord = message as Record<string, unknown>;
        if (typeof messageRecord.content === "string") {
          return messageRecord.content;
        }
      }
    }
  }

  return null;
}


function extractErrorText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const record = payload as Record<string, unknown>;
  const details = record.details;
  const detailsText =
    typeof details === "string"
      ? details
      : details !== undefined
        ? JSON.stringify(details)
        : "";

  const errorMessage = typeof record.error === "string" ? record.error : "";
  const message = typeof record.message === "string" ? record.message : "";

  const joined = [errorMessage, message, detailsText]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" | ");

  return joined.length > 0 ? joined : null;
}

function formatLogPayload(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeTokenUsage(value: unknown): TokenUsage {
  if (typeof value !== "object" || value === null) {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
  }

  const usage = value as Record<string, unknown>;
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);

  return {
    prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completion_tokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    total_tokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  };
}

function normalizeCosts(value: unknown): ExecutionCosts | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const costs = value as Record<string, unknown>;
  const numericCost = Number(costs.totalCostUsd);
  const normalizedModel =
    typeof costs.model === "string" && costs.model.trim().length > 0
      ? costs.model.trim()
      : undefined;

  return {
    tokenUsage: normalizeTokenUsage(costs.tokenUsage),
    totalCostUsd: Number.isFinite(numericCost) ? numericCost : null,
    model: normalizedModel,
  };
}

function normalizeLogEntry(value: unknown): ExecutionLog | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const actor = entry.actor;
  const validActors: LogActor[] = ["user", "api", "agent", "tool"];
  if (typeof actor !== "string" || !validActors.includes(actor as LogActor)) {
    return null;
  }

  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString();
  const message = typeof entry.message === "string" ? entry.message : "(no message)";
  const type = typeof entry.type === "string" && entry.type.trim().length > 0
    ? entry.type.trim()
    : undefined;

  return {
    actor: actor as LogActor,
    timestamp,
    type,
    message,
    input: entry.input ?? null,
    output: entry.output ?? null,
    agent: typeof entry.agent === "string" && entry.agent.trim().length > 0
      ? entry.agent.trim()
      : undefined,
    target: typeof entry.target === "string" && entry.target.trim().length > 0
      ? entry.target.trim()
      : undefined,
    mcpServer: typeof entry.mcpServer === "string" && entry.mcpServer.trim().length > 0
      ? entry.mcpServer.trim()
      : undefined,
    mcpTool: typeof entry.mcpTool === "string" && entry.mcpTool.trim().length > 0
      ? entry.mcpTool.trim()
      : undefined,
  };
}

function normalizeLogs(value: unknown): ExecutionLog[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeLogEntry(entry))
    .filter((entry): entry is ExecutionLog => entry !== null);
}

function getToolLogApi(log: ExecutionLog): string | null {
  if (log.actor !== "tool" || typeof log.output !== "object" || log.output === null) {
    return null;
  }

  const output = log.output as Record<string, unknown>;
  const rawApi = output.API;
  if (typeof rawApi === "string" && rawApi.trim().length > 0) {
    return rawApi;
  }

  if (Array.isArray(rawApi) && rawApi.length > 0) {
    return rawApi
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0)
      .join("\n");
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getLogToolName(log: ExecutionLog): string | null {
  if (log.mcpTool) {
    return log.mcpTool;
  }

  const input = asRecord(log.input);
  const rawTool = input?.tool;
  return typeof rawTool === "string" && rawTool.trim().length > 0 ? rawTool.trim() : null;
}

function getLogTarget(log: ExecutionLog): string | null {
  if (log.target) {
    return log.target;
  }

  if (log.actor !== "agent") {
    return null;
  }

  const input = asRecord(log.input);
  const candidateTargets = [input?.selectedAgentName, input?.routeMatchedRuleTarget];
  const selectedTarget = candidateTargets.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );

  return typeof selectedTarget === "string" ? selectedTarget.trim() : null;
}

function getLogAgent(log: ExecutionLog): string | null {
  if (log.agent) {
    return log.agent;
  }

  if (log.actor !== "agent") {
    return null;
  }

  const input = asRecord(log.input);
  const delegatedBy = input?.delegatedBy;
  if (typeof delegatedBy === "string" && delegatedBy.trim().length > 0) {
    return delegatedBy.trim();
  }

  const selectedAgentName = input?.selectedAgentName;
  if (log.type !== "orchestration" && typeof selectedAgentName === "string" && selectedAgentName.trim().length > 0) {
    return selectedAgentName.trim();
  }

  return null;
}

function getLogDetails(log: ExecutionLog): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string }> = [];
  const agent = getLogAgent(log);
  const target = getLogTarget(log);
  const tool = getLogToolName(log);
  const api = getToolLogApi(log);

  if (agent) {
    details.push({ label: "Agent", value: agent ?? "Unknown" });
  }

  if (target) {
    details.push({ label: "Target", value: target });
  }

  if (log.mcpServer) {
    details.push({ label: "MCP", value: log.mcpServer });
  }

  if (tool) {
    details.push({ label: "Tool", value: tool });
  }

  if (api) {
    details.push({ label: "API", value: api });
  }

  return details;
}

async function fetchMockAIResponse(history: Message[]): Promise<string> {
  // Simulate network latency
  await new Promise<void>((r) => setTimeout(r, 600 + Math.random() * 800));

  const last = history.filter((m) => m.role === "user").at(-1);
  const text = last?.content?.trim().toLowerCase() ?? "";
  const hasAttachment = Boolean(last?.attachment);

  if (text.includes("hello") || text.includes("hi") || text.includes("hey")) {
    return (
      "Hello! 👋 I'm **Axomoxoa AI Copilot**, your intelligent assistant.\n\n" +
      "Here's what I can do for you:\n" +
      "- Answer questions and explain concepts\n" +
      "- Help with code and technical problems\n" +
      "- Analyse files you attach\n" +
      "- Speak responses aloud (toggle the 🔊 in the header)\n" +
      "- Accept voice input (click the mic button)\n\n" +
      "What would you like to explore?"
    );
  }

  if (text.includes("help") || text.includes("what can you do")) {
    return (
      "## Capabilities\n\n" +
      "| Feature | How to use |\n" +
      "| --- | --- |\n" +
      "| **Text chat** | Type in the input box and press Ctrl+Enter or click Send |\n" +
      "| **Voice input** | Click the 🎤 button to start/stop recording |\n" +
      "| **Voice output** | Toggle 🔊 in the header — new responses will be read aloud |\n" +
      "| **File attachment** | Click 📎 and pick any text / code / JSON / CSV file |\n" +
      "| **Chat history** | All sessions are saved in your browser — use the sidebar to switch |\n\n" +
      "Ask me anything to get started!"
    );
  }

  if (text.match(/\bcode\b|typescript|javascript|react|python|sql|css/)) {
    return (
      "I can help with code! Here's a quick TypeScript example:\n\n" +
      "```typescript\n" +
      "// Fetch data with proper error handling\n" +
      "async function fetchData<T>(url: string): Promise<T> {\n" +
      "  const response = await fetch(url);\n" +
      "  if (!response.ok) {\n" +
      "    throw new Error(`HTTP ${response.status}`);\n" +
      "  }\n" +
      "  return response.json() as Promise<T>;\n" +
      "}\n" +
      "```\n\n" +
      "To wire me up to a real AI model, update `fetchAIResponse` in\n" +
      "`src/components/ChatbotPage.tsx` to call your preferred API (OpenAI, Claude, Gemini…)."
    );
  }

  if (hasAttachment) {
    const fileName = last?.attachment?.name ?? "the file";
    const preview = last?.attachment?.textPreview;
    return (
      `I received **${fileName}**.${preview ? " Here's what I can see:\n\n```\n" + preview.slice(0, 300) + (preview.length > 300 ? "\n…" : "") + "\n```" : ""}\n\n` +
      "Connect me to a real AI backend to get a meaningful analysis of this file."
    );
  }

  const preview = last?.content?.slice(0, 120) ?? "";
  return (
    `You said: *"${preview}${(last?.content?.length ?? 0) > 120 ? "…" : ""}"*\n\n` +
    "This is a **demo response**. To connect to a real AI backend, replace the " +
    "`fetchAIResponse` function in `src/components/ChatbotPage.tsx` with a call " +
    "to your preferred AI API."
  );
}

async function fetchAIResponse(
  history: Message[],
  agent: AgentConfig,
  sessionId: string,
  selectedModel: string,
  onProgress?: (update: AgentProgressUpdate) => void,
): Promise<{ text: string; logs: ExecutionLog[]; costs: ExecutionCosts | null }> {
  if (agent.url.startsWith("mock://")) {
    return {
      text: await fetchMockAIResponse(history),
      logs: [],
      costs: null,
    };
  }

  const lastUserMessage = history.filter((message) => message.role === "user").at(-1);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const requestTrace = createClientTraceContext();
  addTraceHeaders(headers, requestTrace);

  const authHeader = buildAuthHeader(agent);
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  if (agent.headerApiKeyName && agent.headerApiKeyValue) {
    headers[agent.headerApiKeyName] = agent.headerApiKeyValue;
  }

  const isLocalAgentApi = isLocalAgentApiUrl(agent.url);

  const buildRequestBody = () =>
    JSON.stringify(
      isLocalAgentApi
        ? {
            sessionId,
            userPrompt: lastUserMessage?.content ?? "",
            model: selectedModel,
          }
        : {
            messages: history.map((message) => ({
              role: message.role,
              content: message.content,
              attachment: message.attachment,
              timestamp: message.timestamp.toISOString(),
            })),
          },
    );

  if (isLocalAgentApi) {
    const streamUrl = buildStreamUrl(agent.url);
    let streamResponse: Response;
    try {
      streamResponse = await fetch(streamUrl, {
        method: "POST",
        headers,
        body: buildRequestBody(),
      });
    } catch (error) {
      throw new AgentRequestError(
        getMessageFromError(error),
        requestTrace.traceId,
        "The streaming request could not reach the backend.",
      );
    }
    const streamTraceId = extractTraceIdFromResponse(streamResponse);

    if (!streamResponse.ok) {
      let apiErrorText = "";

      try {
        const payload = (await streamResponse.json()) as unknown;
        apiErrorText = extractErrorText(payload) ?? "";
      } catch {
        // ignore parse errors for non-JSON error bodies
      }

      throw new AgentRequestError(
        apiErrorText || `Stream request failed with status ${streamResponse.status}`,
        streamTraceId,
        apiErrorText || `The streaming request failed (HTTP ${streamResponse.status}).`,
      );
    }

    if (!streamResponse.body) {
      throw new AgentRequestError(
        "Stream response body is not available.",
        streamTraceId,
        "The server accepted the request but did not provide a streaming body.",
      );
    }

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: Record<string, unknown> | null = null;
    const receivedEvents: string[] = [];
    let lastProgressMessage = "";
    let lastSsePayloadSnippet = "";

    const findEventBoundary = (text: string): { index: number; length: number } | null => {
      const crlfIndex = text.indexOf("\r\n\r\n");
      if (crlfIndex >= 0) {
        return { index: crlfIndex, length: 4 };
      }

      const lfIndex = text.indexOf("\n\n");
      if (lfIndex >= 0) {
        return { index: lfIndex, length: 2 };
      }

      return null;
    };

    const processSseChunk = (chunk: string) => {
      const lines = chunk.split(/\r?\n/);
      let eventName = "message";
      const dataLines: string[] = [];
      let captureData = false;

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          captureData = false;
          continue;
        }

        if (line.startsWith("data:")) {
          captureData = true;
          dataLines.push(line.slice(5).trimStart());
          continue;
        }

        // Continue capturing multi-line data until empty line or next event
        if (captureData && line.trim().length > 0 && !line.startsWith("event:")) {
          dataLines.push(line);
        }
      }

      const dataText = dataLines.join("\n");
      lastSsePayloadSnippet = dataText.slice(0, 600);
      let payload: unknown = null;
      try {
        payload = dataText.length > 0 ? JSON.parse(dataText) as unknown : null;
      } catch {
        payload = { message: dataText };
      }

      receivedEvents.push(eventName);

      if (eventName === "progress") {
        const progressPayload = payload as Record<string, unknown> | null;
        const progressEvent = typeof progressPayload?.event === "string" ? progressPayload.event : "status";

        if (progressEvent === "final_delta") {
          const delta = typeof progressPayload?.delta === "string" ? progressPayload.delta : "";
          const accumulated = typeof progressPayload?.accumulated === "string"
            ? progressPayload.accumulated
            : "";
          if (typeof onProgress === "function") {
            onProgress({ kind: "partial", delta, accumulated });
          }
          return;
        }

        if (progressEvent === "log") {
          const normalizedLog = normalizeLogEntry(progressPayload?.log);
          if (normalizedLog && typeof onProgress === "function") {
            onProgress({ kind: "log", log: normalizedLog });
          }
          return;
        }

        const message =
          typeof progressPayload?.message === "string" && progressPayload.message.trim().length > 0
            ? progressPayload.message.trim()
            : "Working...";
        lastProgressMessage = message;
        onProgress?.({ kind: "status", message });
        return;
      }

      if (eventName === "error") {
        const errorPayload = payload as Record<string, unknown> | null;
        const message =
          typeof errorPayload?.error === "string" && errorPayload.error.trim().length > 0
            ? errorPayload.error
            : "Streaming request failed.";
        const errorDetails = [
          typeof errorPayload?.details === "string" && errorPayload.details.trim().length > 0
            ? `Details: ${errorPayload.details.trim()}`
            : "",
          typeof errorPayload?.code === "string" && errorPayload.code.trim().length > 0
            ? `Code: ${errorPayload.code.trim()}`
            : "",
          lastProgressMessage ? `Last Progress: ${lastProgressMessage}` : "",
          receivedEvents.length > 0 ? `Events Received: ${receivedEvents.join(" -> ")}` : "",
        ]
          .filter((part) => part.length > 0)
          .join("\n");

        throw new AgentRequestError(
          message,
          streamTraceId,
          errorDetails.length > 0 ? errorDetails : message,
        );
      }

      if (eventName === "final") {
        finalPayload = (payload ?? null) as Record<string, unknown> | null;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let boundary = findEventBoundary(buffer);
      while (boundary) {
        const rawEvent = buffer.slice(0, boundary.index).trim();
        buffer = buffer.slice(boundary.index + boundary.length);
        if (rawEvent.length > 0) {
          processSseChunk(rawEvent);
        }
        boundary = findEventBoundary(buffer);
      }
    }

    if (!finalPayload) {
      const diagnostics = [
        "The stream ended before a final response was received.",
        receivedEvents.length > 0 ? `Events Received: ${receivedEvents.join(" -> ")}` : "Events Received: none",
        lastProgressMessage ? `Last Progress: ${lastProgressMessage}` : "",
        lastSsePayloadSnippet ? `Last Payload Snippet: ${lastSsePayloadSnippet}` : "",
      ]
        .filter((part) => part.length > 0)
        .join("\n");

      throw new AgentRequestError(
        "Streaming request ended without a final payload.",
        streamTraceId,
        diagnostics,
      );
    }

    const finalData = finalPayload as Record<string, unknown>;

    return {
      text: typeof finalData.agentResponse === "string" ? finalData.agentResponse : "",
      logs: normalizeLogs(finalData.logs),
      costs: normalizeCosts(finalData.costs),
    };
  }

  let response: Response;
  try {
    response = await fetch(agent.url, {
      method: "POST",
      headers,
      body: buildRequestBody(),
    });
  } catch (error) {
    throw new AgentRequestError(
      getMessageFromError(error),
      requestTrace.traceId,
      "The request could not reach the backend.",
    );
  }

  if (!response.ok) {
    let apiErrorText = "";

    try {
      const payload = (await response.json()) as unknown;
      apiErrorText = extractErrorText(payload) ?? "";
    } catch {
      // ignore parse errors for non-JSON error bodies
    }

    const defaultUserMessage =
      response.status === 400
        ? "The request payload is invalid."
        : response.status === 401 || response.status === 403
          ? "Authentication failed for the selected agent."
          : response.status >= 500
            ? "The agent server failed to process the request."
            : "The agent request failed.";

    throw new AgentRequestError(
      apiErrorText || `Agent request failed with status ${response.status}`,
      extractTraceIdFromResponse(response),
      apiErrorText || `${defaultUserMessage} (HTTP ${response.status})`,
    );
  }

  let payload: Record<string, unknown>;

  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    throw new AgentRequestError(
      "Agent response was not valid JSON.",
      extractTraceIdFromResponse(response) ?? getTraceIdFromError(error),
    );
  }

  if (isLocalAgentApi && typeof payload.agentResponse === "string") {
    return {
      text: payload.agentResponse,
      logs: normalizeLogs(payload.logs),
      costs: normalizeCosts(payload.costs),
    };
  }

  const text = extractAssistantText(payload);
  if (!text) {
    throw new AgentRequestError(
      "Agent response did not include a message.",
      extractTraceIdFromResponse(response),
    );
  }

  return {
    text,
    logs: [],
    costs: null,
  };
}

// ---------------------------------------------------------------------------
// Speech helpers
// ---------------------------------------------------------------------------

interface ISpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

const SpeechRecognitionCtor: (new () => ISpeechRecognition) | null =
  (typeof window !== "undefined" &&
    ((window as unknown as { SpeechRecognition?: new () => ISpeechRecognition })
      .SpeechRecognition ??
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => ISpeechRecognition;
        }
      ).webkitSpeechRecognition)) ||
  null;

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "code block")
    .replace(/`[^`]+`/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/[*_~>|]/g, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logErrorWithTraceId(error, undefined, "copyMessage");
      // ignore
    }
  }

  return (
    <button
      type="button"
      className="cb-copy-btn"
      onClick={() => void copy()}
      aria-label={copied ? "Copied!" : "Copy message"}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <polyline
            points="20 6 9 17 4 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <rect
            x="9" y="9" width="11" height="11" rx="2"
            fill="none" stroke="currentColor" strokeWidth="2"
          />
          <rect
            x="4" y="4" width="11" height="11" rx="2"
            fill="none" stroke="currentColor" strokeWidth="2"
          />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  canInspect,
  onInspect,
  onRetry,
  onShowErrorDetails,
}: {
  message: Message;
  canInspect?: boolean;
  onInspect?: (message: Message) => void;
  onRetry?: (message: Message) => void;
  onShowErrorDetails?: (message: Message) => void;
}) {
  const isUser = message.role === "user";
  const isExecutionUpdateContent = /^\s*Execution updates:/i.test(message.content);
  const isIntermediateAssistantMessage =
    !isUser && ((message.assistantVariant ?? "final") === "intermediate" || isExecutionUpdateContent);

  return (
    <article
      className={`cb-bubble cb-bubble--${isUser ? "user" : "assistant"}${isIntermediateAssistantMessage ? " cb-bubble--assistant-intermediate" : ""}${message.isError ? " cb-bubble--error" : ""}`}
      aria-label={`${isUser ? "You" : "Assistant"}: ${message.content.slice(0, 80)}`}
    >
      <div className="cb-bubble-meta">
        <span className="cb-bubble-role">{isUser ? "You" : "AI"}</span>
        <span className="cb-bubble-time">
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {isUser && canInspect && (
          <button
            type="button"
            className="cb-trace-btn"
            onClick={() => onInspect?.(message)}
            aria-label="Show execution logs"
            title="Trace"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <line x1="8" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="8" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="8" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="3" y1="6" x2="3.01" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="3" y1="12" x2="3.01" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="3" y1="18" x2="3.01" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {isUser && onRetry && (
          <button
            type="button"
            className="cb-retry-btn"
            onClick={() => onRetry(message)}
            aria-label="Re-execute this prompt"
            title="Retry"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path
                d="M23 4v6h-6M1 20v-6h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <CopyButton text={message.content} />
      </div>

      {message.attachment && (
        <div className="cb-attachment-badge">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path
              d="M8 7v9a4 4 0 1 0 8 0V6a3 3 0 1 0-6 0v9a2 2 0 1 0 4 0V8"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            />
          </svg>
          {message.attachment.name}
        </div>
      )}

      {message.isError && !isUser && (
        <button
          type="button"
          className="cb-error-banner"
          onClick={() => onShowErrorDetails?.(message)}
          aria-label="Show error details"
          title="Show error details"
        >
          <span className="cb-error-icon" aria-hidden="true">!</span>
          <span className="cb-error-label">Error details</span>
        </button>
      )}

      <div className="cb-bubble-body">
        {isUser ? (
          <p className="cb-bubble-text">{message.content}</p>
        ) : (
          <div className="cb-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => (
                  <a {...props} target="_blank" rel="noopener noreferrer" />
                ),
                table: (props) => (
                  <div className="cb-table-wrap">
                    <table {...props} />
                  </div>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// TypingIndicator
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <article className="cb-bubble cb-bubble--assistant" aria-label="AI is typing">
      <div className="cb-bubble-meta">
        <span className="cb-bubble-role">AI</span>
      </div>
      <div className="cb-bubble-body">
        <div className="cb-typing" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// WelcomeScreen
// ---------------------------------------------------------------------------

const STARTER_PROMPTS = [
  "Hello! What can you do?",
  "Help me write a TypeScript function",
  "Explain how React hooks work",
  "What's the difference between async/await and Promises?",
];

function WelcomeScreen({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <div className="cb-welcome">
      <div className="cb-welcome-avatar" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="24" cy="24" r="20" />
          <path d="M16 24s3 5 8 5 8-5 8-5" strokeLinecap="round" />
          <circle cx="18" cy="19" r="2" fill="currentColor" stroke="none" />
          <circle cx="30" cy="19" r="2" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <h2 className="cb-welcome-title">How can I help you?</h2>
      <p className="cb-welcome-sub">
        Send a message, attach a file, or use voice input to get started.
      </p>
      <div className="cb-starter-grid">
        {STARTER_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            className="cb-starter-btn"
            onClick={() => onPrompt(p)}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatbotPage
// ---------------------------------------------------------------------------

type ChatbotPageProps = {
  agent: AgentConfig;
  defaultModel: string;
  availableModels: ModelOption[];
};

export default function ChatbotPage({ agent, defaultModel, availableModels }: ChatbotPageProps) {
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) ?? "";
    } catch (error) {
      logErrorWithTraceId(error, undefined, "readActiveSessionId");
      return "";
    }
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [voiceOutputLang, setVoiceOutputLang] = useState<"en-US" | "de-DE">(() => {
    const browserLang = navigator.language || "en-US";
    return browserLang.startsWith("de") ? "de-DE" : "en-US";
  });
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem("selected-model");
    return saved || defaultModel;
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [agentStatusWarning, setAgentStatusWarning] = useState("");
  const [selectedUserMessageId, setSelectedUserMessageId] = useState<string | null>(null);
  const [selectedErrorMessageId, setSelectedErrorMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const modelOptions = useMemo(() => {
    const normalized = availableModels
      .map((option) => ({
        id: option.id.trim(),
        label: option.label.trim().length > 0 ? option.label.trim() : option.id.trim(),
      }))
      .filter((option) => option.id.length > 0);

    if (normalized.length > 0) {
      return normalized;
    }

    return [{ id: defaultModel, label: defaultModel }];
  }, [availableModels, defaultModel]);

  const executionDetailsByUserId = useMemo(() => {
    const details = new Map<string, { logs: ExecutionLog[]; costs: ExecutionCosts | null }>();
    if (!active) {
      return details;
    }

    for (const message of active.messages) {
      if (message.role !== "assistant" || !message.parentUserMessageId) {
        continue;
      }

      details.set(message.parentUserMessageId, {
        logs: message.logs ?? [],
        costs: message.costs ?? null,
      });
    }

    return details;
  }, [active]);

  const selectedExecution = useMemo(() => {
    if (!active || !selectedUserMessageId) {
      return null;
    }

    const userMessage = active.messages.find(
      (message) => message.id === selectedUserMessageId && message.role === "user",
    );

    const assistantMessage = active.messages.find(
      (message) => message.role === "assistant" && message.parentUserMessageId === selectedUserMessageId,
    );

    if (!userMessage || !assistantMessage) {
      return null;
    }

    return {
      userMessage,
      logs: assistantMessage.logs ?? [],
      costs: assistantMessage.costs ?? null,
    };
  }, [active, selectedUserMessageId]);

  const selectedErrorMessage = useMemo(() => {
    if (!active || !selectedErrorMessageId) {
      return null;
    }

    const message = active.messages.find(
      (item) => item.id === selectedErrorMessageId && item.role === "assistant" && item.isError,
    );

    if (!message) {
      return null;
    }

    return {
      message,
      errorInfo: parseErrorInfoFromMessage(message),
    };
  }, [active, selectedErrorMessageId]);

  // Persist sessions whenever they change
  useEffect(() => {
    persistSessions(sessions);
  }, [sessions]);

  // Persist active session id
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_KEY, activeId);
    } catch (error) {
      logErrorWithTraceId(error, undefined, "persistActiveSessionId");
      // ignore
    }
  }, [activeId]);

  // Persist selected model
  useEffect(() => {
    try {
      localStorage.setItem("selected-model", selectedModel);
    } catch (error) {
      logErrorWithTraceId(error, undefined, "persistSelectedModel");
      // ignore
    }
  }, [selectedModel]);

  useEffect(() => {
    if (!selectedUserMessageId && !selectedErrorMessageId) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedUserMessageId(null);
        setSelectedErrorMessageId(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedUserMessageId, selectedErrorMessageId]);

  useEffect(() => {
    const hasSelectedModel = modelOptions.some((option) => option.id === selectedModel);
    if (!hasSelectedModel) {
      setSelectedModel(defaultModel);
    }
  }, [modelOptions, selectedModel, defaultModel]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [voiceOutputLang]);

  // Show a startup warning if the local agent endpoint is unreachable.
  useEffect(() => {
    if (!isLocalAgentApiUrl(agent.url)) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = {};
    const requestTrace = createClientTraceContext();
    addTraceHeaders(headers, requestTrace);

    const authHeader = buildAuthHeader(agent);
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    if (agent.headerApiKeyName && agent.headerApiKeyValue) {
      headers[agent.headerApiKeyName] = agent.headerApiKeyValue;
    }

    void fetch(buildHealthUrl(agent.url), {
      method: "GET",
      headers,
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new AgentRequestError(
            `Health check status ${response.status}`,
            extractTraceIdFromResponse(response),
          );
        }
        logWithLevel("INFO", "agentHealthCheck", undefined, "Local agent health check succeeded.");
        setAgentStatusWarning("");
      })
      .catch((error) => {
        logWithLevel(
          "WARNING",
          "agentHealthCheck",
          getTraceIdFromError(error) ?? requestTrace.traceId,
          error,
        );
        setAgentStatusWarning(
          "local-chat-agent is currently offline. Start it with npm run agent-api (local) or npm run deploy:ai-copilot-backend (Docker).",
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [agent]);

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  function resetComposerState() {
    setSelectedUserMessageId(null);
    setInput("");
    setAttachment(null);
    setVoiceError("");
  }

  function startNewSession() {
    const s = makeSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    resetComposerState();
  }

  function selectSession(id: string) {
    setActiveId(id);
    resetComposerState();
  }

  function deleteSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) {
      setActiveId("");
      setSelectedUserMessageId(null);
    }
  }

  function patchSessions(updater: (prev: Session[]) => Session[]) {
    setSessions((prev) => {
      return updater(prev);
    });
  }

  function updateMessageContent(sessionId: string, messageId: string, nextContent: string) {
    patchSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          messages: session.messages.map((message) =>
            message.id === messageId ? { ...message, content: nextContent, timestamp: new Date() } : message,
          ),
          updatedAt: new Date(),
        };
      }),
    );
  }

  function formatProgressLogLine(log: ExecutionLog): string {
    if (log.actor === "agent" && log.type === "orchestration") {
      const agent = getLogAgent(log) ?? "Unknown";
      const target = getLogTarget(log);
      if (target && target !== agent) {
        return `- Delegation: ${agent} -> ${target} (${log.message})`;
      }
      return `- Orchestration: ${log.message} (${agent})`;
    }

    if (log.actor === "tool") {
      const tool = getLogToolName(log) ?? "unknown-tool";
      const api = getToolLogApi(log);
      if (api) {
        return `- Tool: ${tool} (${log.message}) [API: ${api}]`;
      }
      return `- Tool: ${tool} (${log.message})`;
    }

    const actor = log.actor.toUpperCase();
    const actorType = log.type ? `${actor} · ${log.type.toUpperCase()}` : actor;
    const extras = getLogDetails(log)
      .filter((detail) => detail.label !== "Agent")
      .slice(0, 2)
      .map((detail) => `${detail.label}: ${detail.value}`)
      .join(" | ");

    return extras.length > 0
      ? `- ${actorType}: ${log.message} (${extras})`
      : `- ${actorType}: ${log.message}`;
  }

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------

  async function sendMessage(overrideInput?: string) {
    const text = (overrideInput ?? input).trim();
    if (!text && !attachment) return;
    if (isLoading) return;

    let sessionId = activeId;

    if (!active) {
      const s = makeSession();
      patchSessions((prev) => [s, ...prev]);
      sessionId = s.id;
      setActiveId(s.id);
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      attachment: attachment ?? undefined,
      timestamp: new Date(),
    };

    patchSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              title: s.messages.length === 0 ? deriveTitle(text || attachment?.name || "File") : s.title,
              messages: [...s.messages, userMsg],
              updatedAt: new Date(),
            }
          : s,
      ),
    );

    setInput("");
    setAttachment(null);
    setIsLoading(true);
    setVoiceError("");

    const shouldStreamProgress = isLocalAgentApiUrl(agent.url);
    const progressMessageId = shouldStreamProgress ? crypto.randomUUID() : null;

    if (progressMessageId) {
      patchSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: progressMessageId,
                    role: "assistant",
                    content: "Execution updates:\n- Orchestrator received your request.",
                    assistantVariant: "intermediate",
                    timestamp: new Date(),
                  },
                ],
                updatedAt: new Date(),
              }
            : session,
        ),
      );
    }

    // Build full history for context
    const history = [
      ...(sessions.find((s) => s.id === sessionId)?.messages ?? []),
      userMsg,
    ];

    try {
      const streamLines: string[] = ["- Orchestrator received your request."];
      let partialResponseText = "";
      const responsePayload = await fetchAIResponse(
        history,
        agent,
        sessionId,
        selectedModel,
        progressMessageId
          ? (update) => {
              if (update.kind === "partial") {
                partialResponseText = update.accumulated;
                const draft = partialResponseText.trim().length > 0
                  ? `\n\nLive response draft:\n${partialResponseText}`
                  : "";
                updateMessageContent(
                  sessionId,
                  progressMessageId,
                  `Execution updates:\n${streamLines.slice(-32).join("\n")}${draft}`,
                );
                return;
              }

              const line = update.kind === "log"
                ? formatProgressLogLine(update.log)
                : `- ${update.message}`;

              streamLines.push(line);
              const maxLines = 32;
              const displayedLines = streamLines.slice(-maxLines);
              const draft = partialResponseText.trim().length > 0
                ? `\n\nLive response draft:\n${partialResponseText}`
                : "";
              updateMessageContent(
                sessionId,
                progressMessageId,
                `Execution updates:\n${displayedLines.join("\n")}${draft}`,
              );
            }
          : undefined,
      );
      logWithLevel("INFO", "sendMessage", undefined, "Agent response received.");

      if (progressMessageId) {
        streamLines.push("- Execution completed.");
        const draft = partialResponseText.trim().length > 0
          ? `\n\nLive response draft:\n${partialResponseText}`
          : "";
        updateMessageContent(
          sessionId,
          progressMessageId,
          `Execution updates:\n${streamLines.slice(-32).join("\n")}${draft}`,
        );
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: responsePayload.text,
        assistantVariant: "final",
        timestamp: new Date(),
        logs: responsePayload.logs,
        costs: responsePayload.costs,
        parentUserMessageId: userMsg.id,
      };

      const toolFailure = extractToolFailureSummary(responsePayload.logs);
      if (toolFailure.hasFailure) {
        assistantMsg.isError = true;
        assistantMsg.errorInfo = {
          traceId: "unavailable",
          errorMessage: toolFailure.errorMessage,
          errorDetails: toolFailure.errorDetails,
          stackTrace: "unavailable",
        };
      }

      patchSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [...s.messages, assistantMsg], updatedAt: new Date() }
            : s,
        ),
      );

      if (voiceOutputEnabled) {
        speakText(responsePayload.text);
      }
    } catch (error) {
      const traceId = getTraceIdFromError(error);
      logWithLevel("ERROR", "sendMessage", traceId, error);
      const userError = getUserMessageFromError(error);
      const errorDetails =
        userError && userError.trim().length > 0
          ? userError.trim()
          : getMessageFromError(error);
      const errorMessage = getMessageFromError(error);
      const errorTraceId = traceId && traceId.trim().length > 0 ? traceId : "unavailable";
      const stackTrace = getStackFromError(error)?.trim() || "unavailable";
      const errorText = [
        "Sorry, something went wrong. Please try again.",
        `Trace ID: ${errorTraceId}`,
        `Error Details: ${errorDetails}`,
      ].join("\n");

      patchSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant" as Role,
                    content: errorText,
                    assistantVariant: "final",
                    timestamp: new Date(),
                    isError: true,
                    parentUserMessageId: userMsg.id,
                    errorInfo: {
                      traceId: errorTraceId,
                      errorMessage,
                      errorDetails,
                      stackTrace,
                    },
                  },
                ],
                updatedAt: new Date(),
              }
            : s,
        ),
      );

      if (voiceOutputEnabled) {
        speakText(errorText);
      }
    } finally {
      setIsLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Voice output
  // ---------------------------------------------------------------------------

  function speakText(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.lang = voiceOutputLang;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    synthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }

  function toggleVoiceOutput() {
    setVoiceOutputEnabled((v) => {
      if (v) stopSpeaking();
      return !v;
    });
  }

  // ---------------------------------------------------------------------------
  // Voice input
  // ---------------------------------------------------------------------------

  const startRecording = useCallback(() => {
    if (!SpeechRecognitionCtor) {
      setVoiceError("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }

    setVoiceError("");
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = voiceOutputLang;

    let finalTranscript = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setInput(
        (prev) => {
          const base = finalTranscript || prev;
          return interim ? `${base} ${interim}`.trim() : base;
        },
      );
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      logErrorWithTraceId(event, undefined, "speechRecognition");
      const msg =
        event.error === "not-allowed"
          ? "Microphone access denied. Allow microphone permission in browser settings."
          : event.error === "network"
            ? "Speech recognition network error. Check your connection."
            : "Voice input failed. Please try again.";
      setVoiceError(msg);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [voiceOutputLang]);

  function stopRecording() {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }

  function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  // ---------------------------------------------------------------------------
  // File attachment
  // ---------------------------------------------------------------------------

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const isText =
      file.type.startsWith("text/") ||
      /\.(md|json|csv|ts|tsx|js|jsx|py|sql|yaml|yml|xml|html|css)$/.test(file.name);

    if (isText) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = (ev.target?.result as string) ?? "";
        setAttachment({ name: file.name, mimeType: file.type, textPreview: content.slice(0, 2000) });
      };
      reader.readAsText(file);
    } else {
      setAttachment({ name: file.name, mimeType: file.type, textPreview: "" });
    }

    e.target.value = "";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void sendMessage();
    }
  }

  // ---------------------------------------------------------------------------
  // Sorted sessions for sidebar
  // ---------------------------------------------------------------------------

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    [sessions],
  );

  const canSend = (input.trim().length > 0 || attachment !== null) && !isLoading;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="cb-layout">
      {/* ---- Sidebar ---- */}
      <aside
        className={`cb-sidebar${sidebarOpen ? " cb-sidebar--open" : ""}`}
        aria-label="Chat sessions"
        aria-hidden={!sidebarOpen}
      >
        <div className="cb-sidebar-top">
          <span className="cb-sidebar-label">Conversations</span>
          <button
            type="button"
            className="cb-icon-btn"
            onClick={startNewSession}
            title="New conversation"
            aria-label="New conversation"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav aria-label="Conversation list">
          <ul className="cb-session-list" role="list">
            {sortedSessions.length === 0 && (
              <li className="cb-session-empty">No conversations yet.</li>
            )}
            {sortedSessions.map((s) => (
              <li key={s.id} className="cb-session-item">
                <button
                  type="button"
                  className={`cb-session-btn${s.id === activeId ? " is-active" : ""}`}
                  onClick={() => selectSession(s.id)}
                  aria-current={s.id === activeId ? "page" : undefined}
                >
                  <span className="cb-session-title">{s.title}</span>
                  <span className="cb-session-count">
                    {s.messages.length > 0 ? `${s.messages.length} msg` : "empty"}
                  </span>
                </button>
                <button
                  type="button"
                  className="cb-session-del"
                  onClick={() => deleteSession(s.id)}
                  aria-label={`Delete "${s.title}"`}
                  title="Delete"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* ---- Main panel ---- */}
      <div className="cb-main">
        {/* Toolbar */}
        <header className="cb-toolbar">
          <button
            type="button"
            className={`cb-icon-btn${sidebarOpen ? " is-active" : ""}`}
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            title="Toggle sidebar"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <rect x="3" y="5" width="18" height="2" rx="1" fill="currentColor" />
              <rect x="3" y="11" width="18" height="2" rx="1" fill="currentColor" />
              <rect x="3" y="17" width="18" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>

          <h1 className="cb-toolbar-title">
            {active?.title ?? "Axomoxoa AI Copilot"}
          </h1>

          <div className="cb-toolbar-right">
            {/* Voice output toggle */}
            <button
              type="button"
              className={`cb-icon-btn${voiceOutputEnabled ? " is-active" : ""}`}
              onClick={toggleVoiceOutput}
              aria-label={voiceOutputEnabled ? "Disable voice output" : "Enable voice output"}
              title={voiceOutputEnabled ? "Voice output: on" : "Voice output: off"}
            >
              {isSpeaking ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  {voiceOutputEnabled && (
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  )}
                </svg>
              )}
            </button>

            {/* Voice language selector */}
            <select
              className="cb-voice-lang-select"
              value={voiceOutputLang}
              onChange={(e) => setVoiceOutputLang(e.target.value as "en-US" | "de-DE")}
              aria-label="Voice language for input and output"
              title="Voice language for input and output"
            >
              <option value="en-US">🇬🇧 English</option>
              <option value="de-DE">🇩🇪 Deutsch</option>
            </select>

            {/* Model selector */}
            <select
              className="cb-model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              aria-label="AI model selection"
              title="Select AI model"
            >
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>

            {/* New chat */}
            <button
              type="button"
              className="cb-icon-btn"
              onClick={startNewSession}
              aria-label="New conversation"
              title="New conversation"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="cb-messages" role="log" aria-label="Chat messages" aria-live="polite">
          {isLocalAgentApiUrl(agent.url) && agentStatusWarning && (
            <p className="cb-status-warning" role="alert">
              {agentStatusWarning}
            </p>
          )}

          {!active || active.messages.length === 0 ? (
            <WelcomeScreen
              onPrompt={(p) => {
                setInput(p);
                void sendMessage(p);
              }}
            />
          ) : (
            <>
              {active.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  canInspect={msg.role === "user" && executionDetailsByUserId.has(msg.id)}
                  onInspect={(selectedMessage) => setSelectedUserMessageId(selectedMessage.id)}
                  onShowErrorDetails={(selectedMessage) => setSelectedErrorMessageId(selectedMessage.id)}
                  onRetry={(retryMessage) => {
                    setInput(retryMessage.content);
                    void sendMessage(retryMessage.content);
                  }}
                />
              ))}
              {isLoading && <TypingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} aria-hidden="true" />
        </div>

        {/* Input area */}
        <div className="cb-input-area">
          {voiceError && (
            <p className="cb-voice-error" role="alert">
              {voiceError}
              <button
                type="button"
                className="cb-voice-error-dismiss"
                onClick={() => setVoiceError("")}
                aria-label="Dismiss"
              >
                ×
              </button>
            </p>
          )}

          {attachment && (
            <div className="cb-attached" role="status" aria-label={`Attached: ${attachment.name}`}>
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path d="M8 7v9a4 4 0 1 0 8 0V6a3 3 0 1 0-6 0v9a2 2 0 1 0 4 0V8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>{attachment.name}</span>
              <button
                type="button"
                className="cb-remove-attach"
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
              >
                ×
              </button>
            </div>
          )}

          <div className="cb-input-row">
            {/* Attach */}
            <button
              type="button"
              className="cb-input-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              aria-label="Attach file"
              title="Attach file"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M8 7v9a4 4 0 1 0 8 0V6a3 3 0 1 0-6 0v9a2 2 0 1 0 4 0V8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              className="cb-file-input"
              onChange={handleFileChange}
              aria-hidden="true"
              tabIndex={-1}
            />

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              className={`cb-textarea${isRecording ? " cb-textarea--recording" : ""}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRecording ? "Listening…" : "Message Axomoxoa AI Copilot (Ctrl+Enter to send)"}
              disabled={isLoading}
              rows={1}
              aria-label="Message input"
              aria-multiline="true"
            />

            {/* Mic */}
            <button
              type="button"
              className={`cb-input-btn${isRecording ? " cb-input-btn--recording" : ""}`}
              onClick={toggleRecording}
              disabled={isLoading}
              aria-label={isRecording ? "Stop voice input" : "Start voice input"}
              title={isRecording ? "Stop recording" : "Voice input"}
            >
              {isRecording ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M19 10a7 7 0 1 1-14 0M12 19v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </button>

            {/* Send */}
            <button
              type="button"
              className="cb-send-btn"
              onClick={() => void sendMessage()}
              disabled={!canSend}
              aria-label="Send message"
              title="Send (Ctrl+Enter)"
            >
              {isLoading ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="38" strokeDashoffset="10" strokeLinecap="round">
                    <animateTransform attributeName="transform" type="rotate" values="0 12 12;360 12 12" dur="0.9s" repeatCount="indefinite" />
                  </circle>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M22 2L11 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="m22 2-7 20-4-9-9-4 20-7z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>

          <p className="cb-hint">
            {voiceOutputEnabled && "🔊 Voice output on · "}
            {isRecording && "🎤 Recording · "}
            Ctrl+Enter to send
          </p>
        </div>
      </div>

      {selectedExecution && (
        <div
          className="cb-trace-overlay"
          onClick={() => setSelectedUserMessageId(null)}
          role="presentation"
        >
          <section
            className="cb-trace-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Execution logs"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="cb-trace-header">
              <h2>Execution details</h2>
              <button
                type="button"
                className="cb-trace-close"
                onClick={() => setSelectedUserMessageId(null)}
                aria-label="Close execution details"
              >
                ×
              </button>
            </header>

            <p className="cb-trace-user-text">{selectedExecution.userMessage.content}</p>

            <div className="cb-trace-costs">
              <h3>Execution & Costs</h3>
              {selectedExecution.costs?.model && (
                <p>Model: {selectedExecution.costs.model}</p>
              )}
              <p>Prompt tokens: {selectedExecution.costs?.tokenUsage.prompt_tokens ?? 0}</p>
              <p>Completion tokens: {selectedExecution.costs?.tokenUsage.completion_tokens ?? 0}</p>
              <p>Total tokens: {selectedExecution.costs?.tokenUsage.total_tokens ?? 0}</p>
              <p>
                Estimated USD cost: {
                  selectedExecution.costs?.totalCostUsd !== null
                  && selectedExecution.costs?.totalCostUsd !== undefined
                    ? selectedExecution.costs.totalCostUsd
                    : "Not provided"
                }
              </p>
            </div>

            <div className="cb-trace-logs">
              <h3>Logs</h3>
              {selectedExecution.logs.length === 0 ? (
                <p className="cb-trace-empty">No execution logs were returned for this message.</p>
              ) : (
                <ol>
                  {selectedExecution.logs.map((log, index) => {
                    const logDetails = getLogDetails(log);
                    return (
                      <li key={`${log.timestamp}-${index}`} className="cb-trace-log-item">
                        <p className="cb-trace-log-meta">
                          <strong>
                            {log.actor.toUpperCase()}
                            {log.type ? ` · ${log.type.toUpperCase()}` : ""}
                          </strong>
                          <span>{new Date(log.timestamp).toLocaleString()}</span>
                        </p>
                        <p className="cb-trace-log-message">{log.message}</p>
                        {logDetails.map((detail) => (
                          <p key={detail.label} className="cb-trace-log-api">
                            <strong>{detail.label}:</strong> {detail.value}
                          </p>
                        ))}
                        <div className="cb-trace-io">
                          <div>
                            <h4>Input</h4>
                            <pre>{formatLogPayload(log.input)}</pre>
                          </div>
                          <div>
                            <h4>Output</h4>
                            <pre>{formatLogPayload(log.output)}</pre>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>
      )}

      {selectedErrorMessage && (
        <div
          className="cb-trace-overlay"
          onClick={() => setSelectedErrorMessageId(null)}
          role="presentation"
        >
          <section
            className="cb-trace-panel cb-error-details-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Error details"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="cb-trace-header">
              <h2>Error details</h2>
              <button
                type="button"
                className="cb-trace-close"
                onClick={() => setSelectedErrorMessageId(null)}
                aria-label="Close error details"
              >
                ×
              </button>
            </header>

            <div className="cb-error-details-grid">
              <section className="cb-error-details-section">
                <h3>Trace ID</h3>
                <pre>{selectedErrorMessage.errorInfo.traceId}</pre>
              </section>

              <section className="cb-error-details-section">
                <h3>Error Message</h3>
                <pre>{selectedErrorMessage.errorInfo.errorMessage}</pre>
              </section>

              <section className="cb-error-details-section">
                <h3>Error Details</h3>
                <pre>{selectedErrorMessage.errorInfo.errorDetails}</pre>
              </section>

              <section className="cb-error-details-section">
                <h3>Stack Trace</h3>
                <pre>{selectedErrorMessage.errorInfo.stackTrace}</pre>
              </section>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
