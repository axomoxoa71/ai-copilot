import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { logEvent } from "./telemetry.js";
import { loadRoutingConfig } from "./routing-config.js";
import { buildRoutingGraph } from "./routing-engine.js";
import {
  buildMcpToolsFromDiscovery,
  getMissingRequiredToolArgs,
  detectJiraJqlWorkflow,
  isErrorResultText,
} from "./mcp-tools.js";
import {
  webSearchTool,
  runWebSearch,
  shouldAutoWebLookup,
  extractUrls,
} from "./web-search.js";

// Module-level singletons: config and graph are loaded once at startup.
const routingConfig = loadRoutingConfig();
const routingGraph = buildRoutingGraph(routingConfig);

// Per-session conversation history keyed by sessionId.
export const sessions = new Map();

// ---------------------------------------------------------------------------
// Token-usage helpers
// ---------------------------------------------------------------------------

export function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }

  const promptTokens = Number(
    usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens ?? 0,
  );
  const completionTokens = Number(
    usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.outputTokens ?? 0,
  );
  const totalTokens = Number(
    usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens,
  );

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

export function mergeUsage(total, next) {
  const normalized = normalizeTokenUsage(next);
  return {
    prompt_tokens: total.prompt_tokens + normalized.prompt_tokens,
    completion_tokens: total.completion_tokens + normalized.completion_tokens,
    total_tokens: total.total_tokens + normalized.total_tokens,
  };
}

function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function extractCostUsd(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata;
  const keys = ["total_cost", "totalCost", "cost", "total_cost_usd", "totalCostUsd"];

  for (const key of keys) {
    const direct = toFiniteNumber(record[key]);
    if (direct !== null) {
      return direct;
    }
  }

  const nestedUsage =
    (record.usage && typeof record.usage === "object" ? record.usage : null)
    || (record.tokenUsage && typeof record.tokenUsage === "object" ? record.tokenUsage : null);

  if (nestedUsage) {
    for (const key of keys) {
      const nested = toFiniteNumber(nestedUsage[key]);
      if (nested !== null) {
        return nested;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Interaction-log helpers
// ---------------------------------------------------------------------------

export function truncateText(value, maxLength = 2000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof text !== "string") {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

export function buildClientResponseLogOutput(agentResponse, tokenUsage = null) {
  const hasStringResponse = typeof agentResponse === "string";
  const totalTokens =
    tokenUsage && typeof tokenUsage === "object"
      ? normalizeTokenUsage(tokenUsage).total_tokens
      : null;

  return {
    response: hasStringResponse ? agentResponse : null,
    responseLength: hasStringResponse ? agentResponse.length : 0,
    totalTokens,
  };
}

export function makeInteractionLog(
  actor,
  message,
  input = null,
  output = null,
  type = "interaction",
  metadata = {},
) {
  const interactionLog = {
    actor,
    timestamp: new Date().toISOString(),
    type,
    message,
    input,
    output,
  };

  if (metadata && typeof metadata === "object") {
    if (typeof metadata.agent === "string" && metadata.agent.trim().length > 0) {
      interactionLog.agent = metadata.agent.trim();
    }

    if (typeof metadata.target === "string" && metadata.target.trim().length > 0) {
      interactionLog.target = metadata.target.trim();
    }

    if (typeof metadata.mcpServer === "string" && metadata.mcpServer.trim().length > 0) {
      interactionLog.mcpServer = metadata.mcpServer.trim();
    }

    if (typeof metadata.mcpTool === "string" && metadata.mcpTool.trim().length > 0) {
      interactionLog.mcpTool = metadata.mcpTool.trim();
    }
  }

  return interactionLog;
}

function isPlanOnlyToolIntentResponse(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return false;
  }

  const normalized = text.toLowerCase();
  const planOnlyPatterns = [
    /\bi\s+(would|will|can|could)\s+(run|use|execute|query|search)\b/,
    /\bhere('?s| is)\s+(the\s+)?(jql|query)\s+i\s+(would|will)\s+(run|use)\b/,
    /\b(you\s+can|please)\s+run\s+(this|the)\s+(jql|query)\b/,
    /\bto\s+do\s+this,\s+i\s+(would|will)\b/,
  ];

  const hasPlanLanguage = planOnlyPatterns.some((pattern) => pattern.test(normalized));
  if (!hasPlanLanguage) {
    return false;
  }

  const hasResultSignals = /(found\s+\d+|results?:|issues?:|tickets?:|here\s+are|i\s+found|source)/.test(normalized);
  return !hasResultSignals;
}

/**
 * Enforces mandatory delegation to atlassian-agent for Atlassian queries.
 * Prevents orchestrator from attempting to use web search for Jira/Confluence requests.
 */
function enforceAtlassianDelegation(userPrompt, currentAgentName, config) {
  if (currentAgentName === config.atlassianName) {
    return { shouldDelegateTo: null, reason: null };
  }

  // Mandatory Atlassian keywords that always require delegation
  const mandatoryAtlassianPatterns = [
    /\bjira\b/i,
    /\bconfluence\b/i,
    /\bjql\b/i,
    /\b(create|find|search|query|update|link)\s+\w*\s*(jira|ticket|issue|epic)\b/i,
    /\b(jira|ticket|issue|epic)\s+(query|search|create|update|link)/i,
  ];

  const hasAtlassianKeyword = mandatoryAtlassianPatterns.some((pattern) => pattern.test(userPrompt));

  if (hasAtlassianKeyword) {
    return {
      shouldDelegateTo: config.atlassianName,
      reason: "Mandatory Atlassian delegation enforced: query contains Jira/Confluence keywords",
    };
  }

  return { shouldDelegateTo: null, reason: null };
}

// ---------------------------------------------------------------------------
// LLM model builder
// ---------------------------------------------------------------------------

function buildModel(tools, llmConfig) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY in environment.");
  }

  return new ChatOpenAI({
    model: llmConfig.model,
    temperature: llmConfig.temperature,
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
      baseURL: llmConfig.baseUrl,
      defaultHeaders: {
        ...(llmConfig.httpReferer ? { "HTTP-Referer": llmConfig.httpReferer } : {}),
        ...(llmConfig.xTitle ? { "X-Title": llmConfig.xTitle } : {}),
      },
    },
  }).bindTools(tools);
}

// ---------------------------------------------------------------------------
// Main agent interaction loop
// ---------------------------------------------------------------------------

export async function runAgentInteraction({ sessionId, userPrompt, onProgress, model }) {
  const emitProgress = (event, payload = {}) => {
    if (typeof onProgress !== "function") {
      return;
    }

    try {
      onProgress({ event, ...payload });
    } catch {
      // Progress emission errors must not interrupt agent execution.
    }
  };

  const emitFinalResponseDeltas = (text) => {
    if (typeof text !== "string" || text.length === 0) {
      return;
    }

    // Emit coarse token-like chunks so the UI can render an incremental final response.
    const chunks = text.match(/\S+\s*/g) || [text];
    let accumulated = "";
    for (const chunk of chunks) {
      accumulated += chunk;
      emitProgress("final_delta", { delta: chunk, accumulated });
    }
  };

  const emitTransparencyStatus = (message, metadata = {}) => {
    if (typeof message !== "string" || message.trim().length === 0) {
      return;
    }

    emitProgress("status", {
      message: message.trim(),
      ...metadata,
    });
  };

  const requestedAgentName = routingConfig.orchestratorName;
  const requestedSystemPrompt = routingConfig.orchestratorPrompt;
  const requestedMcpConfig = undefined;

  const routePlan = await routingGraph.invoke({
    userPrompt,
    requestedAgentName,
    requestedSystemPrompt,
    requestedMcpConfig,
  });

  let selectedAgentName =
    typeof routePlan.selectedAgentName === "string" && routePlan.selectedAgentName.trim().length > 0
      ? routePlan.selectedAgentName
      : routingConfig.orchestratorName;
  let routeReason =
    typeof routePlan.routeReason === "string" ? routePlan.routeReason : "none";
  let routeConfidence =
    typeof routePlan.routeConfidence === "number" ? routePlan.routeConfidence : 0;

  // ENFORCEMENT: If query contains mandatory Atlassian keywords but wasn't delegated, override
  const enforceAtlassian = enforceAtlassianDelegation(userPrompt, selectedAgentName, routingConfig);
  if (enforceAtlassian.shouldDelegateTo) {
    selectedAgentName = enforceAtlassian.shouldDelegateTo;
    routeReason = "enforcement-atlassian-mandatory";
    routeConfidence = 0.95; // High confidence due to keyword match
  }

  const delegatedBy =
    selectedAgentName === routingConfig.orchestratorName
      ? null
      : routingConfig.orchestratorName;
  const routeMatchedRuleTarget =
    typeof routePlan.routeMatchedRuleTarget === "string"
      ? routePlan.routeMatchedRuleTarget
      : null;
  const selectedSystemPrompt =
    typeof routePlan.selectedSystemPrompt === "string" && routePlan.selectedSystemPrompt.trim().length > 0
      ? routePlan.selectedSystemPrompt.trim()
      : routingConfig.orchestratorPrompt;
  const selectedMcpConfig =
    routePlan.selectedMcpConfig && typeof routePlan.selectedMcpConfig === "object"
      ? routePlan.selectedMcpConfig
      : null;

  // Select tools: MCP tools for Atlassian agent, web search for orchestrator.
  let selectedAgentTools;
  let mcpToolExecutors = {};
  let mcpToolDefinitions = {};
  if (selectedAgentName === routingConfig.atlassianName) {
    const { tools, toolExecutors, toolDefinitions } = await buildMcpToolsFromDiscovery(selectedMcpConfig);
    selectedAgentTools = tools;
    mcpToolExecutors = toolExecutors;
    mcpToolDefinitions = toolDefinitions;
    if (selectedAgentTools.length === 0) {
      logEvent({
        status: "WARNING",
        endpoint: "/agent-api",
        message: "No MCP tools available for Atlassian agent; proceeding without tools.",
        userData: { sessionId },
      });
    }
  } else {
    selectedAgentTools = [webSearchTool];
  }

  logEvent({
    status: "INFO",
    event: "agent.route",
    endpoint: "/agent-api",
    message: "LangGraph routing decision computed",
    userData: {
      sessionId,
      selectedAgentName,
      delegatedBy,
      routeReason,
      routeConfidence,
      routeMatchedRuleTarget,
    },
  });

  const selectedLlmConfig =
    selectedAgentName === routingConfig.atlassianName
      ? routingConfig.atlassianLlmConfig
      : selectedAgentName === routingConfig.orchestratorName
        ? routingConfig.orchestratorLlmConfig
        : routingConfig.defaultLlmConfig;

  // Override model if provided
  const finalLlmConfig = model && typeof model === "string" && model.trim().length > 0
    ? { ...selectedLlmConfig, model: model.trim() }
    : selectedLlmConfig;

  const modelInstance = buildModel(selectedAgentTools, finalLlmConfig);
  const previous = sessions.get(sessionId) || [];
  let autoWebContext = "";
  let autoLookupAttempted = false;
  const toolUsageLog = [];
  const logs = [];
  const addLog = (actor, message, input = null, output = null, type = "interaction", metadata = {}) => {
    const effectiveMetadata = { ...(metadata && typeof metadata === "object" ? metadata : {}) };
    if (
      (actor === "agent" || actor === "tool")
      && (typeof effectiveMetadata.agent !== "string" || effectiveMetadata.agent.trim().length === 0)
    ) {
      effectiveMetadata.agent = selectedAgentName;
    }

    const logEntry = makeInteractionLog(actor, message, input, output, type, effectiveMetadata);
    logs.push(logEntry);
    emitProgress("log", { log: logEntry });
  };

  emitProgress("status", {
    message: "Agent execution started.",
    selectedAgentName,
    delegatedBy,
    routeReason,
    routeConfidence,
  });

  if (delegatedBy && selectedAgentName) {
    emitTransparencyStatus(
      `Delegation: ${delegatedBy} routed this request to ${selectedAgentName}.`,
      {
        delegatedBy,
        selectedAgentName,
        routeReason,
        routeConfidence,
      },
    );
  } else {
    emitTransparencyStatus(
      `No delegation needed: ${selectedAgentName} will handle this request directly.`,
      {
        selectedAgentName,
        routeReason,
        routeConfidence,
      },
    );
  }

  const availableToolNames = selectedAgentTools.map((toolDef) => toolDef.name).filter(Boolean);
  emitTransparencyStatus(
    availableToolNames.length > 0
      ? `Tools available to ${selectedAgentName}: ${availableToolNames.join(", ")}.`
      : `No tools available to ${selectedAgentName}; model-only response mode is active.`,
    {
      selectedAgentName,
      availableTools: availableToolNames,
    },
  );

  addLog("user", "Received user prompt.", { sessionId, prompt: userPrompt }, null);
  addLog(
    "api",
    "Sent user prompt to agent model.",
    {
      sessionId,
      prompt: userPrompt,
      requestedAgentName,
      selectedAgentName,
      delegatedBy: delegatedBy || null,
      routeReason: routeReason || null,
      routeConfidence,
      routeMatchedRuleTarget: routeMatchedRuleTarget || null,
    },
    { model: finalLlmConfig.model },
    "interaction",
    { target: `POST ${finalLlmConfig.baseUrl.replace(/\/$/, "")}/chat/completions` },
  );
  addLog(
    "agent",
    "LangGraph routing decision.",
    { selectedAgentName, delegatedBy, routeReason, routeConfidence, routeMatchedRuleTarget },
    null,
    "orchestration",
    { agent: routingConfig.orchestratorName, target: selectedAgentName },
  );

  if (delegatedBy && selectedAgentName) {
    addLog(
      "agent",
      `Delegated request from ${delegatedBy} to ${selectedAgentName}.`,
      { delegatedBy, selectedAgentName },
      null,
      "orchestration",
      { agent: delegatedBy, target: selectedAgentName },
    );

    logEvent({
      status: "INFO",
      event: "agent.delegate",
      endpoint: "/agent-api",
      message: "Agent handover executed",
      userData: {
        type: "orchestration",
        sessionId,
        fromAgent: delegatedBy,
        toAgent: selectedAgentName,
        routeReason,
        routeConfidence,
      },
    });
  }

  logEvent({
    status: "INFO",
    endpoint: "/agent-api",
    message: "User prompt received",
    userData: {
      sessionId,
      promptLength: userPrompt.length,
      requestedAgentName,
      selectedAgentName,
      delegatedBy: delegatedBy || null,
      routeReason: routeReason || null,
      routeConfidence,
      routeMatchedRuleTarget: routeMatchedRuleTarget || null,
    },
  });

  // Automatic web pre-fetch for orchestrator when prompt hints at current data.
  if (selectedAgentName === routingConfig.orchestratorName && shouldAutoWebLookup(userPrompt)) {
    autoLookupAttempted = true;
    try {
      const autoLookupApis = [];
      addLog("agent", "Call tool web_search.", { tool: "web_search", query: userPrompt }, null);
      emitTransparencyStatus("Executing tool: web_search (automatic prefetch).", {
        selectedAgentName,
        toolName: "web_search",
        mode: "automatic",
      });

      logEvent({
        status: "INFO",
        endpoint: "/agent-api",
        message: "Automatic web lookup initiated",
        userData: { sessionId, toolName: "web_search", queryLength: userPrompt.length },
      });

      autoWebContext = await runWebSearch(userPrompt, autoLookupApis);
      addLog(
        "tool",
        "Tool web_search completed.",
        { tool: "web_search", query: userPrompt },
        { API: autoLookupApis, result: truncateText(autoWebContext, 3000) },
      );
      emitTransparencyStatus("Tool completed: web_search.", {
        selectedAgentName,
        toolName: "web_search",
        mode: "automatic",
      });

      logEvent({
        status: "INFO",
        endpoint: "/agent-api",
        message: "Automatic web lookup completed",
        userData: { sessionId, toolName: "web_search", resultsLength: autoWebContext.length },
      });

      toolUsageLog.push({
        toolName: "web_search",
        type: "automatic",
        query: userPrompt.substring(0, 200),
        resultsLength: autoWebContext.length,
      });
    } catch (error) {
      logEvent({
        status: "WARNING",
        endpoint: "/agent-api",
        message: "Automatic web lookup failed; continuing without preloaded web context.",
        error,
      });
    }
  }

  const hasMcpConfig = Boolean(
    selectedMcpConfig
      && typeof selectedMcpConfig === "object"
      && Object.keys(selectedMcpConfig).length > 0,
  );

  const messages = [
    new SystemMessage(
      `${selectedSystemPrompt}\n`
      + `Current date: ${new Date().toISOString().slice(0, 10)}.\n`
      + (selectedAgentName === routingConfig.atlassianName
        ? "Use the atlassian_mcp tool for Jira and Confluence requests. Do not use web search for Atlassian tasks.\n"
        : "Use the web_search tool for any question that depends on current events, recent updates, or factual verification.\n")
      + "Execution policy: do not describe planned tool calls (for example, 'I would run this query'). If a relevant tool is available, call it and return the executed result.\n"
      + "Only ask the user for input when blocked by missing required values, missing permissions, or an explicit confirmation requirement for a sensitive/destructive action.\n"
      + "If information is optional or can be reasonably inferred, proceed with best-effort assumptions and state assumptions briefly in the final response.\n"
      + "If web lookup context is provided, prioritize it over model memory and include a Sources section with URLs.",
    ),
    ...(hasMcpConfig
      ? [
          new SystemMessage(
            "MCP server configuration available to this agent:\n"
              + `${JSON.stringify(selectedMcpConfig, null, 2)}\n\n`
              + "Use this MCP context when it is relevant to the user request.",
          ),
        ]
      : []),
    ...(autoWebContext
      ? [
          new SystemMessage(
            "Preloaded web lookup results for the latest user question:\n"
              + `${autoWebContext}\n\n`
              + "Use this evidence in the answer and add source URLs when available."
              + " If the lookup says no relevant results were found, clearly state that you cannot verify from web sources right now.",
          ),
        ]
      : []),
    ...previous,
    new HumanMessage(userPrompt),
  ];

  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let finalResponse = "";
  let totalCostUsd = 0;
  let hasCost = false;
  const maxToolExecutionRetries = Number.isInteger(routingConfig.toolExecutionRetries)
    ? Math.max(0, routingConfig.toolExecutionRetries)
    : 1;
  let forcedToolExecutionRetryCount = 0;
  const toolCallHistory = new Set();
  const jiraWorkflow = detectJiraJqlWorkflow(mcpToolDefinitions);
  const jiraWorkflowState = { converted: false, validated: false };

  if (selectedAgentName === routingConfig.atlassianName && jiraWorkflow.hasOrderedWorkflow) {
    messages.splice(
      1,
      0,
      new SystemMessage(
        "For Jira issue retrieval, follow this strict sequence using available tools: "
          + `1) ${jiraWorkflow.convertTool} (convert natural language to JQL), `
          + `2) ${jiraWorkflow.validateTool} (validate JQL), `
          + `3) ${jiraWorkflow.queryTool} (run the Jira issue query with valid JQL). `
          + "Do not skip steps. If a tool schema marks fields as required, always provide them.",
      ),
    );
  }

  for (let step = 0; step < 5; step += 1) {
    let aiMessage;
    try {
      logEvent({
        status: "INFO",
        event: "agent.invoke",
        endpoint: "/agent-api",
        message: `Model invocation starting (step ${step})`,
        userData: { sessionId, selectedAgentName, step, messageCount: messages.length },
      });
      aiMessage = await modelInstance.invoke(messages);
      logEvent({
        status: "INFO",
        event: "agent.invoke.complete",
        endpoint: "/agent-api",
        message: `Model invocation completed (step ${step})`,
        userData: {
          sessionId,
          selectedAgentName,
          step,
          hasContent: Boolean(aiMessage.content),
          contentType: typeof aiMessage.content,
          hasToolCalls: Array.isArray(aiMessage.tool_calls) && aiMessage.tool_calls.length > 0,
          toolCallCount: Array.isArray(aiMessage.tool_calls) ? aiMessage.tool_calls.length : 0,
        },
      });
    } catch (error) {
      logEvent({
        status: "ERROR",
        endpoint: "/agent-api",
        message: "Model invocation failed",
        error,
        userData: { sessionId, step },
      });
      throw error;
    }

    messages.push(aiMessage);

    const stepUsage = aiMessage.response_metadata?.tokenUsage || aiMessage.usage_metadata;
    totalUsage = mergeUsage(totalUsage, stepUsage);
    const stepCostUsd = extractCostUsd(aiMessage.response_metadata);
    if (stepCostUsd !== null) {
      totalCostUsd += stepCostUsd;
      hasCost = true;
    }

    if (Array.isArray(aiMessage.tool_calls) && aiMessage.tool_calls.length > 0) {
      for (const call of aiMessage.tool_calls) {
        addLog(
          "agent",
          `Call tool ${call.name}.`,
          { tool: call.name, step, args: call.args || {} },
          null,
        );
        emitTransparencyStatus(`Executing tool: ${call.name}.`, {
          selectedAgentName,
          toolName: call.name,
          step,
        });

        const previousCallKey = `${call.name}:${JSON.stringify(call.args || {})}`;
        const isRetry = toolCallHistory.has(previousCallKey);
        toolCallHistory.add(previousCallKey);

        if (isRetry) {
          logEvent({
            status: "WARNING",
            event: "tool.retry",
            endpoint: "/agent-api",
            message: `Tool ${call.name} called again with identical args — possible retry loop`,
            userData: { sessionId, selectedAgentName, toolName: call.name, step, args: call.args },
          });
        } else {
          logEvent({
            status: "INFO",
            event: "tool.call",
            endpoint: "/agent-api",
            message: `Tool invoked: ${call.name}`,
            userData: { sessionId, selectedAgentName, toolName: call.name, step, args: call.args },
          });
        }

        const toolQuery = typeof call.args?.query === "string"
          ? call.args.query
          : JSON.stringify(call.args || {});
        let result;
        const toolApis = [];
        const toolMetadata = {};

        const selectedToolDefinition = mcpToolDefinitions[call.name];
        const missingRequiredArgs = selectedToolDefinition
          ? getMissingRequiredToolArgs(selectedToolDefinition, call.args)
          : [];

        if (missingRequiredArgs.length > 0) {
          result = [
            `ERROR: Missing required arguments for tool ${call.name}.`,
            `Missing fields: ${missingRequiredArgs.join(", ")}.`,
            "Call the same tool again and include all required fields from its schema.",
          ].join(" ");
        } else if (
          selectedAgentName === routingConfig.atlassianName
          && jiraWorkflow.hasOrderedWorkflow
          && call.name === jiraWorkflow.queryTool
          && (!jiraWorkflowState.converted || !jiraWorkflowState.validated)
        ) {
          result = [
            "ERROR: Jira query workflow order violated.",
            `Required sequence: ${jiraWorkflow.convertTool} -> ${jiraWorkflow.validateTool} -> ${jiraWorkflow.queryTool}.`,
            "Please call the missing prior tool step(s) first, then retry the query tool.",
          ].join(" ");
        }

        if (result === undefined && call.name === "web_search") {
          result = await runWebSearch(toolQuery, toolApis);
        } else if (result === undefined && mcpToolExecutors[call.name]) {
          result = await mcpToolExecutors[call.name](call.args || {});
        } else if (result === undefined) {
          result = `Unknown tool: ${call.name}`;
        }

        if (
          selectedAgentName === routingConfig.atlassianName
          && jiraWorkflow.hasOrderedWorkflow
          && !isErrorResultText(result)
        ) {
          if (call.name === jiraWorkflow.convertTool) {
            jiraWorkflowState.converted = true;
          }
          if (call.name === jiraWorkflow.validateTool) {
            jiraWorkflowState.validated = true;
          }
        }

        const resultString = String(result);
        const isToolError = /^error\b/i.test(resultString.trimStart());
        logEvent({
          status: isToolError ? "WARNING" : "INFO",
          event: isToolError ? "tool.error" : "tool.result",
          endpoint: "/agent-api",
          message: isToolError
            ? `Tool ${call.name} returned an error`
            : `Tool ${call.name} result received`,
          userData: {
            sessionId,
            selectedAgentName,
            toolName: call.name,
            step,
            resultLength: resultString.length,
          },
        });

        messages.push(
          new ToolMessage({
            tool_call_id: call.id,
            content: resultString,
          }),
        );
        addLog(
          "tool",
          `Tool ${call.name} completed.`,
          { tool: call.name, step, args: call.args || {} },
          { API: toolApis, result: truncateText(resultString, 3000) },
          "interaction",
          toolMetadata,
        );
        emitTransparencyStatus(
          isToolError
            ? `Tool failed: ${call.name}. Review execution details for the error.`
            : `Tool completed: ${call.name}.`,
          {
            selectedAgentName,
            toolName: call.name,
            step,
            outcome: isToolError ? "error" : "success",
          },
        );

        toolUsageLog.push({
          toolName: call.name,
          type: "explicit",
          step,
          argsLength: JSON.stringify(call.args || {}).length,
          resultLength: resultString.length,
        });
      }
      continue;
    }

    finalResponse =
      typeof aiMessage.content === "string"
        ? aiMessage.content
        : Array.isArray(aiMessage.content)
          ? aiMessage.content
              .map((part) => (typeof part === "string" ? part : part?.text || ""))
              .join("\n")
              .trim()
          : "";

    const explicitToolCallsMade = toolUsageLog.some((entry) => entry.type === "explicit");
    if (
      forcedToolExecutionRetryCount < maxToolExecutionRetries
      && selectedAgentTools.length > 0
      && !explicitToolCallsMade
      && isPlanOnlyToolIntentResponse(finalResponse)
      && step < 4
    ) {
      forcedToolExecutionRetryCount += 1;

      messages.push(
        new SystemMessage(
          "Your prior message described a plan instead of executing tools. Execute the relevant tool call(s) now and return the actual result."
            + " Do not ask for user interaction unless a required argument or permission is genuinely missing.",
        ),
      );

      addLog(
        "api",
        "Detected plan-only tool intent response; forcing tool execution retry.",
        {
          step,
          selectedAgentName,
          retryAttempt: forcedToolExecutionRetryCount,
          maxToolExecutionRetries,
          responseLength: finalResponse.length,
        },
        null,
        "orchestration",
        { agent: selectedAgentName },
      );

      logEvent({
        status: "INFO",
        event: "agent.enforce_tool_execution",
        endpoint: "/agent-api",
        message: "Plan-only response detected; forcing tool execution retry",
        userData: {
          sessionId,
          selectedAgentName,
          step,
          retryAttempt: forcedToolExecutionRetryCount,
          maxToolExecutionRetries,
          responseLength: finalResponse.length,
        },
      });

      continue;
    }

    if (!finalResponse) {
      logEvent({
        status: "WARNING",
        event: "agent.empty_content",
        endpoint: "/agent-api",
        message: "Model returned empty response content",
        userData: {
          sessionId,
          selectedAgentName,
          step,
          contentType: typeof aiMessage.content,
          contentIsArray: Array.isArray(aiMessage.content),
          messageKeys: Object.keys(aiMessage).slice(0, 10),
        },
      });
    }
    break;
  }

  if (!finalResponse) {
    logEvent({
      status: "WARNING",
      event: "agent.loop_exhausted",
      endpoint: "/agent-api",
      message: "Agent loop exhausted all steps without producing a final response — tool errors likely caused infinite tool-call loop",
      userData: {
        sessionId,
        selectedAgentName,
        totalSteps: 5,
        toolCallsMade: toolUsageLog.length,
        uniqueToolCalls: toolCallHistory.size,
        toolCallHistory: Array.from(toolCallHistory).slice(0, 5),
      },
    });
  }

  const trimmedResponse = finalResponse || "I could not generate a response.";
  const sourceUrls = extractUrls(autoWebContext);

  const responseWithSources = (() => {
    if (!autoLookupAttempted) {
      return trimmedResponse;
    }

    if (sourceUrls.length > 0) {
      const hasStaleMemoryPhrasing = /as of my last update|i cannot browse|i can't browse|language model/i.test(trimmedResponse);
      if (hasStaleMemoryPhrasing) {
        const sourceList = sourceUrls.slice(0, 5).map((url) => `- ${url}`).join("\n");
        return "I verified this using current web sources." + `\n\nSources:\n${sourceList}`;
      }

      const hasSourceSection = /\bsources?\b/i.test(trimmedResponse) || /https?:\/\//i.test(trimmedResponse);
      if (hasSourceSection) {
        return trimmedResponse;
      }

      const sourceList = sourceUrls.slice(0, 5).map((url) => `- ${url}`).join("\n");
      return `${trimmedResponse}\n\nSources:\n${sourceList}`;
    }

    if (
      /no relevant web results found/i.test(autoWebContext)
      && !/cannot verify|could not verify|unable to verify/i.test(trimmedResponse)
    ) {
      return `${trimmedResponse}\n\nI could not verify this from current web sources.`;
    }

    return trimmedResponse;
  })();

  emitFinalResponseDeltas(responseWithSources);

  addLog(
    "agent",
    "Generated final response.",
    null,
    { response: truncateText(responseWithSources, 3000) },
  );

  emitProgress("status", {
    message: "Agent execution completed.",
    selectedAgentName,
  });

  const nextHistory = [
    ...previous,
    new HumanMessage(userPrompt),
    new AIMessage(responseWithSources),
  ].slice(-20);

  sessions.set(sessionId, nextHistory);

  logEvent({
    status: "INFO",
    event: "agent.usage",
    endpoint: "/agent-api",
    message: "Agent interaction completed with token usage",
    userData: {
      sessionId,
      selectedAgentName,
      tokenUsage: totalUsage,
      toolCallsMade: toolUsageLog.length,
      uniqueToolResults: new Set(toolUsageLog.map((t) => `${t.toolName}:${t.step}`)).size,
      toolsUsed: toolUsageLog.length > 0 ? toolUsageLog.map((t) => t.toolName).join(", ") : "none",
    },
  });

  const isFallbackResponse = responseWithSources === "I could not generate a response.";
  logEvent({
    status: isFallbackResponse ? "WARNING" : "INFO",
    event: isFallbackResponse ? "agent.response.fallback" : "agent.response",
    endpoint: "/agent-api",
    message: isFallbackResponse
      ? "Agent returned fallback response — likely caused by repeated tool errors"
      : "Agent response generated",
    userData: {
      sessionId,
      selectedAgentName,
      responseLength: responseWithSources.length,
      isFallback: isFallbackResponse,
      toolUsageDetails: toolUsageLog,
    },
  });

  return {
    agentResponse: responseWithSources,
    tokenUsage: totalUsage,
    logs,
    costs: {
      tokenUsage: totalUsage,
      totalCostUsd: hasCost ? Number(totalCostUsd.toFixed(6)) : null,
      model: finalLlmConfig.model,
    },
  };
}
