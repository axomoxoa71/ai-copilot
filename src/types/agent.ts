export type AgentConfig = {
  name: string;
  url: string;
  role?: "orchestrator" | "specialist";
  systemPrompt?: string;
  mcpConfig?: Record<string, McpServerConfig>;
  delegationRules?: DelegationRule[];
  basicAuthUser?: string;
  basicAuthPassword?: string;
  headerApiKeyName?: string;
  headerApiKeyValue?: string;
};

export type McpServerConfig = {
  type: string;
  url: string;
};

export type DelegationRule = {
  targetAgent: string;
  keywords: string[];
  semanticKeywords?: string[];
  regexPatterns?: string[];
  priority: number;
  minConfidence: number;
};

export type AgentConfigDocument = {
  defaultAgentName?: string;
  defaultModel?: string;
  availableModels?: ModelOptionRaw[];
  agents: AgentConfigRaw[];
};

export type ModelOptionRaw = {
  id?: string;
  label?: string;
};

export type AgentConfigRaw = {
  name: string;
  url: string;
  role?: "orchestrator" | "specialist";
  "system-prompt"?: string;
  "mcp-config"?: Record<string, McpServerConfig>;
  "delegation-rules"?: DelegationRuleRaw[];
  "basic-auth-user"?: string;
  "basic-auth-password"?: string;
  "header-api-key-name"?: string;
  "header-api-key-value"?: string;
};

export type DelegationRuleRaw = {
  "target-agent"?: string;
  keywords?: string[];
  "semantic-keywords"?: string[];
  "regex-patterns"?: string[];
  priority?: number;
  "min-confidence"?: number;
};
