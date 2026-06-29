import { useMemo, useState } from "react";
import "./App.css";
import ChatbotPage from "./components/ChatbotPage";
import EntryPage from "./components/EntryPage";
import agentConfigRaw from "./resources/agent-config.json";
import type {
  AgentConfig,
  AgentConfigDocument,
  AgentConfigRaw,
  DelegationRule,
  DelegationRuleRaw,
  McpServerConfig,
  ModelOptionRaw,
} from "./types/agent";

type ModelOption = {
  id: string;
  label: string;
};

function resolveConfigValue(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.startsWith("$")) return trimmed;

  // Support "$ENV_KEY||fallback" for robust local/docker defaults.
  const [rawEnvKey, ...fallbackParts] = trimmed.slice(1).split("||");
  const envKey = rawEnvKey.trim();
  const fallback = fallbackParts.join("||").trim();
  const envValue = (import.meta.env as Record<string, unknown>)[envKey];
  if (typeof envValue === "string" && envValue.trim().length > 0) {
    return envValue.trim();
  }

  return fallback;
}

function optionalValue(value: string | undefined): string | undefined {
  const resolved = resolveConfigValue(value);
  return resolved.length > 0 ? resolved : undefined;
}

function normalizeMcpConfig(
  mcpConfig: Record<string, McpServerConfig> | undefined,
): Record<string, McpServerConfig> | undefined {
  if (!mcpConfig || typeof mcpConfig !== "object") {
    return undefined;
  }

  const entries = Object.entries(mcpConfig)
    .filter(([, value]) => {
      if (!value || typeof value !== "object") {
        return false;
      }

      return (
        typeof value.type === "string"
        && value.type.trim().length > 0
        && typeof value.url === "string"
        && value.url.trim().length > 0
      );
    })
    .map(([key, value]) => [
      key,
      {
        type: value.type.trim(),
        url: value.url.trim(),
      },
    ] as const);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeDelegationRules(
  rules: DelegationRuleRaw[] | undefined,
): DelegationRule[] | undefined {
  if (!Array.isArray(rules)) {
    return undefined;
  }

  const normalizeKeywordList = (items: string[] | undefined): string[] =>
    (Array.isArray(items)
      ? items
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item.length > 0)
      : []);

  const normalized = rules
    .map((rule) => {
      const targetAgent = optionalValue(rule["target-agent"]);
      const keywords = normalizeKeywordList(rule.keywords);
      const semanticKeywords = normalizeKeywordList(rule["semantic-keywords"]);
      const regexPatterns = Array.isArray(rule["regex-patterns"])
        ? rule["regex-patterns"]
            .map((pattern) => pattern.trim())
            .filter((pattern) => pattern.length > 0)
        : [];
      const numericPriority = Number(rule.priority);
      const priority = Number.isFinite(numericPriority)
        ? Math.max(0, Math.floor(numericPriority))
        : 100;
      const numericMinConfidence = Number(rule["min-confidence"]);
      const minConfidence = Number.isFinite(numericMinConfidence)
        ? Math.max(0, Math.min(1, numericMinConfidence))
        : 0.62;

      if (
        !targetAgent
        || (keywords.length === 0 && semanticKeywords.length === 0 && regexPatterns.length === 0)
      ) {
        return null;
      }

      return {
        targetAgent,
        ...(keywords.length > 0 ? { keywords } : { keywords: [] }),
        ...(semanticKeywords.length > 0 ? { semanticKeywords } : {}),
        ...(regexPatterns.length > 0 ? { regexPatterns } : {}),
        priority,
        minConfidence,
      };
    })
    .filter((rule): rule is DelegationRule => rule !== null);

  return normalized.length > 0 ? normalized : undefined;
}

function getAgentConfigEntries(
  raw: AgentConfigRaw[] | AgentConfigDocument,
): { entries: AgentConfigRaw[]; defaultAgentName?: string } {
  if (Array.isArray(raw)) {
    return { entries: raw };
  }

  return {
    entries: Array.isArray(raw.agents) ? raw.agents : [],
    defaultAgentName: optionalValue(raw.defaultAgentName),
  };
}

function normalizeAgentConfig(
  rawConfig: AgentConfigRaw[] | AgentConfigDocument,
): { agents: AgentConfig[]; defaultAgentName?: string; defaultModel: string; availableModels: ModelOption[] } {
  const { entries, defaultAgentName } = getAgentConfigEntries(rawConfig);
  const fallbackModel = "openai/gpt-4o-mini";

  const normalizeModelOption = (option: ModelOptionRaw): ModelOption | null => {
    const id = optionalValue(option.id);
    if (!id) {
      return null;
    }

    return {
      id,
      label: optionalValue(option.label) ?? id,
    };
  };

  const availableModels =
    Array.isArray((rawConfig as AgentConfigDocument).availableModels)
      ? ((rawConfig as AgentConfigDocument).availableModels ?? [])
          .map((option) => normalizeModelOption(option))
          .filter((option): option is ModelOption => option !== null)
      : [];

  const configuredDefaultModel = optionalValue((rawConfig as AgentConfigDocument).defaultModel);
  const defaultModel = configuredDefaultModel
    ?? availableModels[0]?.id
    ?? fallbackModel;

  const agents = entries
    .map((entry) => {
      const basicAuthUser = optionalValue(entry["basic-auth-user"]);
      const basicAuthPassword = optionalValue(entry["basic-auth-password"]);
      const headerApiKeyName = optionalValue(entry["header-api-key-name"]);
      const headerApiKeyValue = optionalValue(entry["header-api-key-value"]);
      const systemPrompt = optionalValue(entry["system-prompt"]);
      const mcpConfig = normalizeMcpConfig(entry["mcp-config"]);
      const delegationRules = normalizeDelegationRules(entry["delegation-rules"]);

      return {
        name: resolveConfigValue(entry.name),
        url: resolveConfigValue(entry.url),
        ...(entry.role ? { role: entry.role } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(mcpConfig ? { mcpConfig } : {}),
        ...(delegationRules ? { delegationRules } : {}),
        ...(basicAuthUser ? { basicAuthUser } : {}),
        ...(basicAuthPassword ? { basicAuthPassword } : {}),
        ...(headerApiKeyName ? { headerApiKeyName } : {}),
        ...(headerApiKeyValue ? { headerApiKeyValue } : {}),
      };
    })
    .filter(
      (entry): entry is AgentConfig => {
        const hasBasicUser = Boolean(entry.basicAuthUser);
        const hasBasicPassword = Boolean(entry.basicAuthPassword);
        const basicAuthPairValid =
          (hasBasicUser && hasBasicPassword) ||
          (!hasBasicUser && !hasBasicPassword);

        const hasApiKeyName = Boolean(entry.headerApiKeyName);
        const hasApiKeyValue = Boolean(entry.headerApiKeyValue);
        const apiKeyPairValid =
          (hasApiKeyName && hasApiKeyValue) ||
          (!hasApiKeyName && !hasApiKeyValue);

        return Boolean(
          entry.name && entry.url && basicAuthPairValid && apiKeyPairValid,
        );
      },
    );

  return {
    agents,
    defaultAgentName,
    defaultModel,
    availableModels,
  };
}

export default function App() {
  const normalizedConfig = useMemo(
    () => normalizeAgentConfig(agentConfigRaw as AgentConfigRaw[] | AgentConfigDocument),
    [],
  );

  const agents = normalizedConfig.agents;
  const preferredDefaultAgent = useMemo(
    () =>
      agents.find((agent) => agent.name === normalizedConfig.defaultAgentName)
      ?? agents.find((agent) => agent.role === "orchestrator")
      ?? agents[0]
      ?? null,
    [agents, normalizedConfig.defaultAgentName],
  );

  const [connectedAgent, setConnectedAgent] = useState<AgentConfig | null>(null);

  return (
    <div className="app-root">
      {connectedAgent ? (
        <ChatbotPage
          agent={connectedAgent}
          defaultModel={normalizedConfig.defaultModel}
          availableModels={normalizedConfig.availableModels}
        />
      ) : (
        <EntryPage
          agents={agents}
          onConnect={setConnectedAgent}
          initialAgentName={preferredDefaultAgent?.name}
        />
      )}
    </div>
  );
}
