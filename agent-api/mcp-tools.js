import { tool } from "@langchain/core/tools";
import { logEvent } from "./telemetry.js";
import {
  initializeMcpSession,
  discoverMcpTools,
  callMcpTool,
  convertMcpToolToLangChainSchema,
  normalizeMcpToolResult,
} from "./atlassian-mcp.js";

function normalizeMcpServerName(serverName) {
  if (typeof serverName !== "string") {
    return "";
  }

  return serverName.trim().replace(/-(docker|http|https)$/i, "");
}

export function getPrimaryMcpServerDescriptor(selectedMcpConfig) {
  if (!selectedMcpConfig || typeof selectedMcpConfig !== "object") {
    return null;
  }

  const entries = Object.entries(selectedMcpConfig).filter(([, entry]) => entry && typeof entry === "object");
  for (const [serverName, entry] of entries) {
    if (typeof entry.url === "string" && entry.url.trim().length > 0) {
      return {
        name: normalizeMcpServerName(serverName),
        endpoint: entry.url.trim(),
      };
    }
  }

  return null;
}

/**
 * Builds LangChain tools from dynamically discovered MCP tool definitions.
 * The LLM receives all tool descriptions and selects which to invoke.
 *
 * Returns { tools, toolExecutors, toolDefinitions }
 */
export async function buildMcpToolsFromDiscovery(selectedMcpConfig) {
  const primaryMcpServer = getPrimaryMcpServerDescriptor(selectedMcpConfig);
  const endpoint = primaryMcpServer?.endpoint;

  if (!endpoint) {
    logEvent({
      status: "INFO",
      endpoint: "/agent-api",
      message: "No MCP endpoint configured; MCP tools will not be available.",
    });
    return { tools: [], toolExecutors: {}, toolDefinitions: {} };
  }

  try {
    let sessionId = null;
    try {
      sessionId = await initializeMcpSession(endpoint);
    } catch (error) {
      logEvent({
        status: "WARNING",
        endpoint: "/agent-api",
        message: "MCP session initialization failed; continuing without session.",
        error,
      });
    }

    const sessionHeaders = sessionId ? { "Mcp-Session-Id": sessionId } : {};
    const mcpTools = await discoverMcpTools(endpoint, sessionHeaders);

    logEvent({
      status: "INFO",
      event: "tool.mcp_tools_discovered",
      endpoint: "/agent-api",
      message: `MCP server returned ${mcpTools.length} tool(s)`,
      userData: {
        endpoint,
        toolCount: mcpTools.length,
        tools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
      },
    });

    const toolExecutors = {};
    const toolDefinitions = {};

    const langchainTools = mcpTools.map((mcpTool) => {
      const toolName = mcpTool.name;
      toolDefinitions[toolName] = mcpTool;

      const executeFunction = async (args) => {
        try {
          logEvent({
            status: "INFO",
            event: "tool.mcp_call",
            endpoint: "/agent-api",
            message: `Invoking MCP tool: ${toolName}`,
            userData: { toolName, args },
          });

          const result = await callMcpTool(endpoint, toolName, args, sessionHeaders);
          return normalizeMcpToolResult(result);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          logEvent({
            status: "WARNING",
            event: "tool.mcp_error",
            endpoint: "/agent-api",
            message: `MCP tool ${toolName} failed`,
            error,
          });
          throw new Error(`MCP tool ${toolName} failed: ${errorMessage}`, {
            ...(error instanceof Error ? { cause: error } : {}),
          });
        }
      };

      toolExecutors[toolName] = executeFunction;

      return tool(
        executeFunction,
        {
          name: toolName,
          description: mcpTool.description || `Atlassian tool: ${toolName}`,
          schema: convertMcpToolToLangChainSchema(mcpTool),
        },
      );
    });

    return { tools: langchainTools, toolExecutors, toolDefinitions };
  } catch (error) {
    logEvent({
      status: "WARNING",
      endpoint: "/agent-api",
      message: "Failed to discover or build MCP tools",
      error,
    });
    return { tools: [], toolExecutors: {}, toolDefinitions: {} };
  }
}

export function getMissingRequiredToolArgs(toolDefinition, args) {
  const required = Array.isArray(toolDefinition?.inputSchema?.required)
    ? toolDefinition.inputSchema.required.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];

  if (required.length === 0) {
    return [];
  }

  const normalizedArgs = args && typeof args === "object" ? args : {};

  return required.filter((fieldName) => {
    const value = normalizedArgs[fieldName];
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      return true;
    }
    return false;
  });
}

/**
 * Detects whether MCP tool definitions expose a structured Jira JQL workflow
 * (convert → validate → query) that should be enforced in order.
 */
export function detectJiraJqlWorkflow(toolDefinitions) {
  const names = Object.keys(toolDefinitions || {});

  const findName = (predicate) => names.find((name) => predicate(name.toLowerCase()));
  const convertTool = findName((name) =>
    (name.includes("jql") && (name.includes("convert") || name.includes("from_text") || name.includes("fromtext")
      || name.includes("from_nl") || name.includes("fromnl")))
    || (name.includes("natural") && name.includes("jql"))
    || (name.includes("text") && name.includes("jql") && name.includes("to"))
  );
  const validateTool = findName((name) => name.includes("validate") && name.includes("jql"));
  const queryTool = findName((name) =>
    (name.includes("query") || name.includes("search") || name.includes("find"))
    && name.includes("jira")
    && (name.includes("issues") || name.includes("issue"))
  );

  const hasOrderedWorkflow = Boolean(convertTool && validateTool && queryTool);
  return { hasOrderedWorkflow, convertTool, validateTool, queryTool };
}

export function isErrorResultText(value) {
  return /^error\b/i.test(String(value || "").trimStart());
}
