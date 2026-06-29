import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

function normalizePromptForRouting(value) {
  return typeof value === "string" ? value.toLowerCase().trim() : "";
}

function computeAtlassianIntent(routingConfig, prompt) {
  const normalizedPrompt = normalizePromptForRouting(prompt);
  const keywordMatches = routingConfig.atlassianKeywords.filter((keyword) =>
    normalizedPrompt.includes(keyword),
  );
  const semanticMatches = routingConfig.atlassianSemanticKeywords.filter((keyword) =>
    normalizedPrompt.includes(keyword),
  );
  const regexMatches = routingConfig.atlassianRegexPatterns.filter((pattern) =>
    pattern.test(normalizedPrompt),
  );

  if (normalizedPrompt.length === 0) {
    return {
      requiresAtlassian: false,
      routeReason: "none",
      routeConfidence: 0,
      routeMatchedRuleTarget: null,
    };
  }

  let confidence = 0;
  if (regexMatches.length > 0) {
    confidence = Math.max(confidence, 0.85);
  }
  if (keywordMatches.length > 0) {
    confidence = Math.max(confidence, Math.min(0.9, 0.55 + keywordMatches.length * 0.1));
  }
  if (semanticMatches.length > 0) {
    confidence = Math.max(confidence, Math.min(0.82, 0.48 + semanticMatches.length * 0.09));
  }
  if (
    (regexMatches.length > 0 && keywordMatches.length > 0)
    || (keywordMatches.length > 0 && semanticMatches.length > 0)
  ) {
    confidence = Math.min(0.99, confidence + 0.08);
  }

  const requiresAtlassian = confidence >= routingConfig.atlassianMinConfidence;
  const routeReason = regexMatches.length > 0
    ? "rule-regex"
    : keywordMatches.length > 0
      ? "rule-keyword"
      : "semantic-fallback";

  return {
    requiresAtlassian,
    routeReason: requiresAtlassian ? routeReason : "none",
    routeConfidence: Number(confidence.toFixed(3)),
    routeMatchedRuleTarget: requiresAtlassian ? routingConfig.atlassianRuleTarget : null,
  };
}

/**
 * Builds and compiles the LangGraph routing state machine for a given
 * routing configuration. The graph evaluates each incoming prompt and
 * selects the appropriate agent (orchestrator vs. Atlassian specialist).
 */
export function buildRoutingGraph(routingConfig) {
  const routingGraphState = Annotation.Root({
    userPrompt: Annotation(),
    requestedAgentName: Annotation(),
    requestedSystemPrompt: Annotation(),
    requestedMcpConfig: Annotation(),
    requiresAtlassian: Annotation(),
    routeReason: Annotation(),
    routeConfidence: Annotation(),
    routeMatchedRuleTarget: Annotation(),
    selectedAgentName: Annotation(),
    selectedSystemPrompt: Annotation(),
    selectedMcpConfig: Annotation(),
    delegatedBy: Annotation(),
  });

  const graph = new StateGraph(routingGraphState)
    .addNode("intent_router", (state) => {
      const intent = computeAtlassianIntent(routingConfig, state.userPrompt);
      return { ...intent };
    })
    .addNode("select_agent", (state) => {
      const selectedAgentName = state.requiresAtlassian
        ? routingConfig.atlassianName
        : routingConfig.orchestratorName;

      if (selectedAgentName === routingConfig.atlassianName) {
        return {
          selectedAgentName,
          selectedSystemPrompt: routingConfig.atlassianPrompt,
          selectedMcpConfig: routingConfig.atlassianMcpConfig,
          delegatedBy: routingConfig.orchestratorName,
        };
      }

      return {
        selectedAgentName,
        selectedSystemPrompt:
          typeof state.requestedSystemPrompt === "string" && state.requestedSystemPrompt.trim().length > 0
            ? state.requestedSystemPrompt.trim()
            : routingConfig.orchestratorPrompt,
        selectedMcpConfig: state.requestedMcpConfig,
        delegatedBy: null,
      };
    })
    .addEdge(START, "intent_router")
    .addEdge("intent_router", "select_agent")
    .addEdge("select_agent", END);

  return graph.compile();
}
