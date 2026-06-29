/**
 * MCP Tool Discovery and Invocation
 * 
 * This module handles discovery of tools from MCP servers via tools/list
 * and invocation of those tools. Tool selection is delegated to the LLM
 * based on tool descriptions and user intent, following MCP best practices.
 */

/**
 * Initializes MCP session (optional, some servers don't require it)
 */
export async function initializeMcpSession(endpoint) {
  if (!endpoint || typeof endpoint !== "string") {
    throw new Error("MCP endpoint URL required for initialization");
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          clientInfo: {
            name: "ai-copilot",
            version: "0.0.0",
          },
          capabilities: {},
        },
      }),
    });

    const result = await response.json();
    return result.jsonrpc === "2.0" ? response.headers.get("Mcp-Session-Id") : null;
  } catch {
    // Initialize is optional; continue without it
    return null;
  }
}

/**
 * Discovers available tools from an MCP server via JSON-RPC tools/list
 * Returns an array of tool descriptors with name, description, and inputSchema
 */
export async function discoverMcpTools(endpoint, sessionHeaders = {}) {
  if (!endpoint || typeof endpoint !== "string") {
    throw new Error("MCP endpoint URL required for tool discovery");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...sessionHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method: "tools/list",
      params: {},
    }),
  });

  const result = await response.json();
  
  if (result.error) {
    throw new Error(`MCP tools/list failed: ${result.error.message}`);
  }

  const tools = Array.isArray(result.result?.tools) ? result.result.tools : [];
  return tools;
}

/**
 * Calls an MCP tool via JSON-RPC tools/call
 * The LLM has already decided which tool to use; this just invokes it
 */
export async function callMcpTool(endpoint, toolName, toolArgs, sessionHeaders = {}) {
  if (!endpoint || typeof endpoint !== "string") {
    throw new Error("MCP endpoint URL required");
  }
  
  if (!toolName || typeof toolName !== "string") {
    throw new Error("Tool name required");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...sessionHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toolArgs,
      },
    }),
  });

  const result = await response.json();

  if (result.error) {
    throw new Error(`MCP tool call failed: ${result.error.message}`);
  }

  return result.result;
}

/**
 * Converts MCP tool schema to a format suitable for LangChain tool definition
 * Extracts relevant parameter information and creates a user-friendly schema
 */
export function convertMcpToolToLangChainSchema(mcpTool) {
  if (!mcpTool || typeof mcpTool !== "object") {
    return {};
  }

  const schema = mcpTool.inputSchema || {};
  const properties = schema.properties || {};
  
  // Convert MCP JSON schema to a simpler object for LangChain
  const convertedProperties = {};
  
  for (const [key, value] of Object.entries(properties)) {
    convertedProperties[key] = {
      type: value.type || "string",
      description: value.description || "",
    };
  }

  return {
    type: "object",
    properties: convertedProperties,
    required: schema.required || [],
  };
}

/**
 * Normalizes tool result content to a string format
 */
export function normalizeMcpToolResult(result) {
  if (!result || typeof result !== "object") {
    return "";
  }

  // Try common content field names
  if (typeof result.content === "string" && result.content.trim().length > 0) {
    return result.content.trim();
  }

  if (Array.isArray(result.content)) {
    const textParts = result.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          if (typeof part.text === "string") {
            return part.text;
          }
          if (typeof part.value === "string") {
            return part.value;
          }
        }
        return "";
      })
      .filter((part) => part.trim().length > 0)
      .join("\n");

    if (textParts.trim().length > 0) {
      return textParts;
    }
  }

  if (typeof result.output === "string" && result.output.trim().length > 0) {
    return result.output.trim();
  }

  if (result.structuredContent && typeof result.structuredContent === "object") {
    return JSON.stringify(result.structuredContent, null, 2);
  }

  return JSON.stringify(result, null, 2);
}