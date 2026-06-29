/**
 * Task Planner Module
 * Analyzes user requests, breaks down tasks, determines complexity,
 * and recommends delegation strategies.
 */

/**
 * Complexity levels for tasks
 */
const COMPLEXITY_LEVELS = {
  SIMPLE: "simple",
  MODERATE: "moderate",
  COMPLEX: "complex",
};

/**
 * Task categories for routing
 */
const TASK_CATEGORIES = {
  ATLASSIAN: "atlassian",
  WORKATO: "workato",
  CODING: "coding",
  DOCUMENTATION: "documentation",
  GENERAL: "general",
};

/**
 * Analyzes a user request and returns a task plan
 * @param {string} userRequest - The user's request
 * @returns {object} Task plan with complexity, breakdown, and delegation recommendation
 */
export function planTask(userRequest) {
  const analysis = {
    original_request: userRequest,
    timestamp: new Date().toISOString(),
    complexity: determineComplexity(userRequest),
    category: categorizeTask(userRequest),
    subtasks: breakDownTask(userRequest),
    open_questions: identifyOpenQuestions(userRequest),
    recommended_agents: recommendAgents(userRequest),
    approach: selectApproach(userRequest),
  };

  return analysis;
}

/**
 * Determines the complexity level of a task
 * @param {string} request - The user request
 * @returns {string} Complexity level
 */
function determineComplexity(request) {
  const complexity_indicators = {
    simple: [
      "how many",
      "what is",
      "list",
      "show me",
      "find",
      "search",
      "get",
      "fetch",
    ],
    complex: [
      "integrate",
      "configure",
      "setup",
      "refactor",
      "redesign",
      "automate",
      "optimize",
      "migrate",
      "multiple",
      "several",
      "and then",
    ],
  };

  const requestLower = request.toLowerCase();

  // Count complexity signals
  let complexityScore = 0;

  // Check for simple indicators
  complexity_indicators.simple.forEach((indicator) => {
    if (requestLower.includes(indicator)) complexityScore -= 1;
  });

  // Check for complex indicators
  complexity_indicators.complex.forEach((indicator) => {
    if (requestLower.includes(indicator)) complexityScore += 2;
  });

  // Check for multiple sentences or steps
  const sentences = request.split(/[.!?]/).filter((s) => s.trim());
  if (sentences.length > 2) complexityScore += 2;

  // Check for conditional or dependent steps
  if (
    requestLower.includes("if ") ||
    requestLower.includes("then ") ||
    requestLower.includes("depending on")
  ) {
    complexityScore += 3;
  }

  // Determine final complexity
  if (complexityScore <= 0) return COMPLEXITY_LEVELS.SIMPLE;
  if (complexityScore <= 3) return COMPLEXITY_LEVELS.MODERATE;
  return COMPLEXITY_LEVELS.COMPLEX;
}

/**
 * Categorizes the task into a domain
 * @param {string} request - The user request
 * @returns {string} Task category
 */
function categorizeTask(request) {
  const requestLower = request.toLowerCase();

  const categoryKeywords = {
    [TASK_CATEGORIES.ATLASSIAN]: [
      "jira",
      "confluence",
      "epic",
      "backlog",
      "sprint",
      "issue",
      "ticket",
      "jql",
      "workflow",
    ],
    [TASK_CATEGORIES.WORKATO]: [
      "workato",
      "automation",
      "workflow",
      "integration",
      "trigger",
      "action",
    ],
    [TASK_CATEGORIES.CODING]: [
      "code",
      "function",
      "refactor",
      "debug",
      "test",
      "implement",
      "fix bug",
      "feature",
      "component",
    ],
    [TASK_CATEGORIES.DOCUMENTATION]: [
      "document",
      "write",
      "readme",
      "guide",
      "explain",
      "describe",
    ],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((keyword) => requestLower.includes(keyword))) {
      return category;
    }
  }

  return TASK_CATEGORIES.GENERAL;
}

/**
 * Breaks down a complex task into subtasks
 * @param {string} request - The user request
 * @returns {array} Array of subtasks
 */
function breakDownTask(request) {
  const subtasks = [];

  // Split by common connectors
  const taskSentences = request.split(/[.!?]/).filter((s) => s.trim());

  taskSentences.forEach((sentence, index) => {
    const cleanSentence = sentence.trim();
    if (cleanSentence) {
      subtasks.push({
        order: index + 1,
        description: cleanSentence,
        dependencies: identifyDependencies(sentence, taskSentences),
      });
    }
  });

  // If single sentence, try to break into logical steps
  if (subtasks.length === 1) {
    const steps = extractSteps(request);
    if (steps.length > 1) {
      return steps;
    }
  }

  return subtasks;
}

/**
 * Identifies dependencies between tasks
 * @param {string} currentTask - Current task
 * @param {array} allTasks - All tasks
 * @returns {array} Dependent task indices
 */
function identifyDependencies(currentTask, allTasks) {
  const dependencies = [];
  const currentLower = currentTask.toLowerCase();

  // Check for temporal/sequential keywords
  if (
    currentLower.includes("first ") ||
    currentLower.includes("initially ") ||
    currentLower.includes("start with")
  ) {
    return []; // No dependencies, it's first
  }

  if (
    currentLower.includes("then ") ||
    currentLower.includes("next ") ||
    currentLower.includes("after that") ||
    currentLower.includes("once ")
  ) {
    // Depends on previous task
    return [allTasks.length - 1];
  }

  return dependencies;
}

/**
 * Extracts sequential steps from a request
 * @param {string} request - The user request
 * @returns {array} Steps
 */
function extractSteps(request) {
  const stepPatterns = [
    /(?:first|1\.)[\s]*([^.!?]+)/gi,
    /(?:second|then|2\.)[\s]*([^.!?]+)/gi,
    /(?:third|next|3\.)[\s]*([^.!?]+)/gi,
    /(?:finally|lastly|4\.)[\s]*([^.!?]+)/gi,
  ];

  const steps = [];
  let order = 1;

  stepPatterns.forEach((pattern) => {
    const matches = request.matchAll(pattern);
    for (const match of matches) {
      steps.push({
        order: order++,
        description: match[1].trim(),
        dependencies: order > 1 ? [order - 2] : [],
      });
    }
  });

  return steps;
}

/**
 * Identifies open questions in the request
 * @param {string} request - The user request
 * @returns {array} Array of open questions
 */
function identifyOpenQuestions(request) {
  const questions = [];

  // Pattern 1: Explicit questions
  const explicitQuestions = request.match(/\?/g) || [];
  if (explicitQuestions.length > 0) {
    const qSentences = request.split("?").slice(0, -1);
    qSentences.forEach((q) => {
      const cleanQ = q.split(/[.!]/).pop().trim();
      if (cleanQ) {
        questions.push({
          type: "explicit",
          question: cleanQ + "?",
        });
      }
    });
  }

  // Pattern 2: Conditional statements (need clarification)
  const conditionalPatterns = /(?:if|depending on|based on|when)\s+([^.!?]+)/gi;
  const conditionalMatches = request.matchAll(conditionalPatterns);
  for (const match of conditionalMatches) {
    const condition = match[1].trim();
    // Only add if not enough info to decide
    if (!hasEnoughContext(request, condition)) {
      questions.push({
        type: "conditional",
        question: `How should we handle: ${condition}?`,
        context: condition,
      });
    }
  }

  // Pattern 3: Ambiguous references
  const ambiguousTerms = [
    "it",
    "that",
    "this",
    "them",
    "those",
    "these",
  ];
  ambiguousTerms.forEach((term) => {
    const pattern = new RegExp(`\\b${term}\\b`, "gi");
    if (pattern.test(request)) {
      // Heuristic: might be ambiguous if used multiple times
      const count = (request.match(pattern) || []).length;
      if (count > 2) {
        questions.push({
          type: "ambiguous",
          question: `Can you clarify what "${term}" refers to?`,
          term,
        });
      }
    }
  });

  return questions;
}

/**
 * Checks if there's enough context for a condition
 * @param {string} request - Full request
 * @param {string} condition - Condition text
 * @returns {boolean} True if enough context
 */
function hasEnoughContext(request, condition) {
  const requestLower = request.toLowerCase();
  const conditionLower = condition.toLowerCase();

  // Check if condition is answered elsewhere in request
  const keyTerms = conditionLower.split(/\s+/);
  return keyTerms.filter((term) => term.length > 3).some((term) => {
    const pattern = new RegExp(`${term}[^.!?]*(?:is|are|will|should|can)`, "i");
    return pattern.test(requestLower);
  });
}

/**
 * Recommends which agents should be involved
 * @param {string} request - The user request
 * @returns {array} Recommended agents with priority
 */
function recommendAgents(request) {
  const category = categorizeTask(request);

  const categoryToAgents = {
    [TASK_CATEGORIES.ATLASSIAN]: [
      { name: "atlassian-agent", priority: 100, confidence: 0.95 },
      { name: "orchestrator-agent", priority: 50, confidence: 0.3 },
    ],
    [TASK_CATEGORIES.WORKATO]: [
      { name: "workato-dev", priority: 100, confidence: 0.9 },
      { name: "orchestrator-agent", priority: 50, confidence: 0.3 },
    ],
    [TASK_CATEGORIES.CODING]: [
      { name: "code-agent", priority: 100, confidence: 0.85 },
      { name: "orchestrator-agent", priority: 60, confidence: 0.4 },
    ],
    [TASK_CATEGORIES.DOCUMENTATION]: [
      { name: "doc-agent", priority: 100, confidence: 0.9 },
      { name: "orchestrator-agent", priority: 50, confidence: 0.2 },
    ],
    [TASK_CATEGORIES.GENERAL]: [
      { name: "orchestrator-agent", priority: 100, confidence: 0.8 },
    ],
  };

  const recommendedList = categoryToAgents[category] || categoryToAgents[TASK_CATEGORIES.GENERAL];
  return recommendedList.sort((a, b) => b.priority - a.priority);
}

/**
 * Selects the approach based on complexity and category
 * @param {string} request - The user request
 * @returns {object} Approach strategy
 */
function selectApproach(request) {
  const complexity = determineComplexity(request);
  const category = categorizeTask(request);
  const openQuestions = identifyOpenQuestions(request);

  let approach;

  if (openQuestions.length > 0) {
    approach = "dialog-first";
  } else if (complexity === COMPLEXITY_LEVELS.SIMPLE) {
    approach = "direct-execution";
  } else if (complexity === COMPLEXITY_LEVELS.MODERATE) {
    approach = "guided-delegation";
  } else {
    approach = "planning-delegation";
  }

  return {
    strategy: approach,
    steps: getApproachSteps(approach),
    rationale: getApproachRationale(complexity, category, openQuestions),
  };
}

/**
 * Gets the steps for an approach
 * @param {string} approach - The approach strategy
 * @returns {array} Steps to follow
 */
function getApproachSteps(approach) {
  const steps = {
    "dialog-first": [
      "Clarify open questions with user",
      "Reanalyze task after answers",
      "Create detailed plan",
      "Delegate to appropriate agents",
    ],
    "direct-execution": [
      "Acknowledge request",
      "Execute immediately",
      "Report results",
    ],
    "guided-delegation": [
      "Create breakdown",
      "Present plan to user",
      "Get confirmation",
      "Delegate with clear instructions",
    ],
    "planning-delegation": [
      "Analyze all requirements",
      "Create detailed task breakdown",
      "Present comprehensive plan",
      "Get approval for approach",
      "Delegate sequentially with dependencies",
      "Coordinate between agents",
      "Validate final output",
    ],
  };

  return steps[approach] || steps["guided-delegation"];
}

/**
 * Gets rationale for approach selection
 * @param {string} complexity - Task complexity
 * @param {string} category - Task category
 * @param {array} openQuestions - Open questions
 * @returns {string} Rationale explanation
 */
function getApproachRationale(complexity, category, openQuestions) {
  let rationale = [];

  if (openQuestions.length > 0) {
    rationale.push(`You have ${openQuestions.length} open question(s) that need clarification.`);
  }

  rationale.push(`Task complexity is ${complexity}.`);
  rationale.push(`Category: ${category}.`);

  if (complexity === COMPLEXITY_LEVELS.COMPLEX) {
    rationale.push("Breaking down into smaller tasks will ensure better execution.");
  }

  return rationale.join(" ");
}

export { COMPLEXITY_LEVELS, TASK_CATEGORIES };
