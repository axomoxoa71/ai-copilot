import { readFileSync } from "node:fs";
import path from "node:path";
import { logEvent } from "./telemetry.js";

const ORCHESTRATOR_AGENT_NAME = "orchestrator-agent";
const ATLASSIAN_AGENT_NAME = "atlassian-agent";
const DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT =
  "You are the orchestrator-agent. Route Jira and Confluence questions to atlassian-agent. Handle all other topics directly.";
const DEFAULT_ATLASSIAN_SYSTEM_PROMPT =
  "You are atlassian-agent. Specialize in Jira and Confluence workflows, issue triage, JQL, and documentation guidance.";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL_TEMPERATURE = 0.2;
const ATLASSIAN_KEYWORDS = [
  "jira",
  "confluence",
  "jql",
  "issue",
  "epic",
  "backlog",
  "sprint",
  "space",
  "ticket",
  "atlassian",
];

function isRunningInDocker() {
  if (typeof process.env.RUNNING_IN_DOCKER === "string") {
    return ["1", "true", "yes"].includes(process.env.RUNNING_IN_DOCKER.trim().toLowerCase());
  }

  if (typeof process.env.DOCKER === "string") {
    return ["1", "true", "yes"].includes(process.env.DOCKER.trim().toLowerCase());
  }

  if (process.platform !== "linux") {
    return false;
  }

  try {
    readFileSync("/.dockerenv", "utf-8");
    return true;
  } catch {
    return false;
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
}

function resolveConfigString(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("$")) {
    return trimmed;
  }

  const envName = trimmed.slice(1).trim();
  if (!envName) {
    return "";
  }

  const envValue = process.env[envName];
  return typeof envValue === "string" ? envValue.trim() : "";
}

function resolveDefaultAtlassianMcpUrl() {
  const explicit = resolveConfigString("$ATLASSIAN_MCP_URL");
  if (explicit) {
    return explicit;
  }

  if (isRunningInDocker()) {
    return resolveConfigString("$ATLASSIAN_MCP_URL_DOCKER") || "http://host.docker.internal:8000/mcp";
  }

  return resolveConfigString("$ATLASSIAN_MCP_URL_LOCAL") || "http://127.0.0.1:8000/mcp";
}

function resolveAtlassianMcpConfig(rawMcpConfig, fallbackUrl) {
  const rawEntries = rawMcpConfig && typeof rawMcpConfig === "object"
    ? Object.entries(rawMcpConfig)
    : [];

  const resolvedEntries = rawEntries
    .filter(([, value]) => value && typeof value === "object")
    .map(([key, value]) => {
      const typedEntry = value;
      const resolvedUrl = resolveConfigString(typedEntry.url);
      return [
        key,
        {
          ...typedEntry,
          url: resolvedUrl || fallbackUrl,
        },
      ];
    });

  if (resolvedEntries.length > 0) {
    return Object.fromEntries(resolvedEntries);
  }

  return {
    "atlassian-mcp-docker": {
      type: "http",
      url: fallbackUrl,
    },
  };
}

function resolveTemperature(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(2, numeric));
}

function resolveRetryCount(value, fallback) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return fallback;
  }

  return numeric;
}

function normalizeLlmConfig(rawConfig, fallbackConfig) {
  const candidate = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const model = resolveConfigString(candidate.model) || fallbackConfig.model;
  const baseUrl = resolveConfigString(candidate["base-url"]) || fallbackConfig.baseUrl;
  const temperature = resolveTemperature(candidate.temperature, fallbackConfig.temperature);
  const httpReferer = resolveConfigString(candidate["http-referer"]) || fallbackConfig.httpReferer;
  const xTitle = resolveConfigString(candidate["x-title"]) || fallbackConfig.xTitle;

  return {
    model,
    baseUrl,
    temperature,
    httpReferer,
    xTitle,
  };
}

function parseRegexPatterns(patterns) {
  const regexPatterns = [];
  const normalizedPatterns = normalizeStringArray(patterns);

  for (const pattern of normalizedPatterns) {
    try {
      regexPatterns.push(new RegExp(pattern, "i"));
    } catch (error) {
      logEvent({
        status: "WARNING",
        endpoint: "startup",
        message: `Ignoring invalid routing regex pattern: ${pattern}`,
        error,
      });
    }
  }

  return regexPatterns;
}

export function loadRoutingConfig() {
  const configPath = path.resolve(process.cwd(), "src", "resources", "agent-config.json");
  const defaultAtlassianMcpUrl = resolveDefaultAtlassianMcpUrl();
  const fallbackLlmConfig = {
    model: DEFAULT_OPENROUTER_MODEL,
    baseUrl: DEFAULT_OPENROUTER_BASE_URL,
    temperature: DEFAULT_MODEL_TEMPERATURE,
    httpReferer: process.env.OPENROUTER_HTTP_REFERER || "",
    xTitle: process.env.OPENROUTER_X_TITLE || "",
  };

  const fallbackConfig = {
    orchestratorName: ORCHESTRATOR_AGENT_NAME,
    atlassianName: ATLASSIAN_AGENT_NAME,
    orchestratorPrompt: DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT,
    atlassianPrompt: DEFAULT_ATLASSIAN_SYSTEM_PROMPT,
    atlassianMcpConfig: resolveAtlassianMcpConfig(null, defaultAtlassianMcpUrl),
    atlassianKeywords: [...ATLASSIAN_KEYWORDS],
    atlassianSemanticKeywords: [],
    atlassianRegexPatterns: [],
    atlassianMinConfidence: 0.62,
    atlassianRuleTarget: ATLASSIAN_AGENT_NAME,
    defaultLlmConfig: fallbackLlmConfig,
    orchestratorLlmConfig: fallbackLlmConfig,
    atlassianLlmConfig: fallbackLlmConfig,
    toolExecutionRetries: 1,
  };

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.agents)) {
      return fallbackConfig;
    }

    const agents = parsed.agents.filter((agent) => agent && typeof agent === "object");
    const configuredDefaultAgentName =
      typeof parsed.defaultAgentName === "string" && parsed.defaultAgentName.trim().length > 0
        ? parsed.defaultAgentName.trim()
        : ORCHESTRATOR_AGENT_NAME;

    const orchestratorAgent =
      agents.find((agent) => agent.name === configuredDefaultAgentName)
      || agents.find((agent) => agent.role === "orchestrator")
      || agents.find((agent) => agent.name === ORCHESTRATOR_AGENT_NAME)
      || null;

    const delegationRules = Array.isArray(orchestratorAgent?.["delegation-rules"])
      ? [...orchestratorAgent["delegation-rules"]]
      : [];
    const sortedRules = delegationRules
      .filter((rule) => rule && typeof rule === "object")
      .sort((left, right) => {
        const leftPriority = Number.isFinite(Number(left.priority)) ? Number(left.priority) : 999;
        const rightPriority = Number.isFinite(Number(right.priority)) ? Number(right.priority) : 999;
        return leftPriority - rightPriority;
      });

    const atlassianRule =
      sortedRules.find((rule) => rule["target-agent"] === ATLASSIAN_AGENT_NAME)
      || sortedRules.find((rule) => typeof rule["target-agent"] === "string")
      || null;

    const atlassianTargetName =
      typeof atlassianRule?.["target-agent"] === "string" && atlassianRule["target-agent"].trim().length > 0
        ? atlassianRule["target-agent"].trim()
        : ATLASSIAN_AGENT_NAME;

    const atlassianAgent =
      agents.find((agent) => agent.name === atlassianTargetName)
      || agents.find((agent) => agent.name === ATLASSIAN_AGENT_NAME)
      || null;

    const configuredMcp = atlassianAgent?.["mcp-config"];
    const defaultLlmConfig = normalizeLlmConfig(parsed["llm-config"], fallbackLlmConfig);
    const orchestratorLlmConfig = normalizeLlmConfig(orchestratorAgent?.["llm-config"], defaultLlmConfig);
    const atlassianLlmConfig = normalizeLlmConfig(atlassianAgent?.["llm-config"], defaultLlmConfig);
    const configuredToolExecutionRetries = resolveRetryCount(
      parsed?.["agent-runtime"]?.["tool-execution-retries"],
      fallbackConfig.toolExecutionRetries,
    );

    return {
      orchestratorName:
        typeof orchestratorAgent?.name === "string" && orchestratorAgent.name.trim().length > 0
          ? orchestratorAgent.name.trim()
          : ORCHESTRATOR_AGENT_NAME,
      atlassianName:
        typeof atlassianAgent?.name === "string" && atlassianAgent.name.trim().length > 0
          ? atlassianAgent.name.trim()
          : atlassianTargetName,
      orchestratorPrompt:
        typeof orchestratorAgent?.["system-prompt"] === "string"
        && orchestratorAgent["system-prompt"].trim().length > 0
          ? orchestratorAgent["system-prompt"].trim()
          : DEFAULT_ORCHESTRATOR_SYSTEM_PROMPT,
      atlassianPrompt:
        typeof atlassianAgent?.["system-prompt"] === "string" && atlassianAgent["system-prompt"].trim().length > 0
          ? atlassianAgent["system-prompt"].trim()
          : DEFAULT_ATLASSIAN_SYSTEM_PROMPT,
      atlassianMcpConfig: resolveAtlassianMcpConfig(configuredMcp, defaultAtlassianMcpUrl),
      atlassianKeywords:
        normalizeStringArray(atlassianRule?.keywords).length > 0
          ? normalizeStringArray(atlassianRule?.keywords)
          : [...ATLASSIAN_KEYWORDS],
      atlassianSemanticKeywords: normalizeStringArray(atlassianRule?.["semantic-keywords"]),
      atlassianRegexPatterns: parseRegexPatterns(atlassianRule?.["regex-patterns"]),
      atlassianMinConfidence: Number.isFinite(Number(atlassianRule?.["min-confidence"]))
        ? Number(atlassianRule["min-confidence"])
        : 0.62,
      atlassianRuleTarget:
        typeof atlassianRule?.["target-agent"] === "string" && atlassianRule["target-agent"].trim().length > 0
          ? atlassianRule["target-agent"].trim()
          : atlassianTargetName,
      defaultLlmConfig,
      orchestratorLlmConfig,
      atlassianLlmConfig,
      toolExecutionRetries: configuredToolExecutionRetries,
    };
  } catch (error) {
    logEvent({
      status: "WARNING",
      endpoint: "startup",
      message: "Failed to load agent-config.json for routing. Falling back to defaults.",
      error,
    });
    return fallbackConfig;
  }
}