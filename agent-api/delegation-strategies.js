/**
 * Agent Delegation Strategies Module
 * Provides logic for routing tasks to appropriate specialist agents
 * and managing task coordination.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Defines available agents and their capabilities
 */
const DEFAULT_AGENT_REGISTRY = {
  "orchestrator-agent": {
    role: "orchestrator",
    capabilities: ["planning", "routing", "general-qa", "coordination"],
    domains: ["general"],
    priority: 0,
    description: "Strategic coordination and general tasks",
  },
  "atlassian-agent": {
    role: "specialist",
    capabilities: ["jira-query", "issue-creation", "confluence-search", "workflow-management"],
    domains: ["atlassian", "jira", "confluence"],
    priority: 100,
    description: "Jira and Confluence operations",
    mcp_config: "atlassian-mcp-docker",
  },
  "workato-dev": {
    role: "specialist",
    capabilities: ["workflow-creation", "integration-setup", "automation-design"],
    domains: ["workato", "automation", "integration"],
    priority: 100,
    description: "Workato workflow and automation",
  },
  "code-agent": {
    role: "specialist",
    capabilities: ["code-implementation", "debugging", "refactoring", "testing"],
    domains: ["coding", "implementation"],
    priority: 100,
    description: "Code development and debugging",
  },
  "doc-agent": {
    role: "specialist",
    capabilities: ["documentation-writing", "content-creation", "guide-writing"],
    domains: ["documentation", "content"],
    priority: 100,
    description: "Documentation and technical writing",
  },
};

const CONFIG_PATH = path.resolve(process.cwd(), "src", "resources", "agent-config.json");

let cachedDelegationSettings = null;

const DELEGATION_CONTRACT_VERSION = "1.0.0";

const WORK_TYPES = {
  ATLASSIAN: "atlassian-operations",
  AUTOMATION: "automation-workflow",
  CODE: "code-implementation",
  DOCS: "documentation",
  ORCHESTRATION: "orchestration",
  GENERAL: "general-task",
};

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
}

function readAgentConfig() {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildRegistryFromConfig(config) {
  const agents = Array.isArray(config?.agents) ? config.agents : [];
  if (agents.length === 0) {
    return { ...DEFAULT_AGENT_REGISTRY };
  }

  const registry = {};

  agents.forEach((agent) => {
    if (!agent || typeof agent !== "object" || typeof agent.name !== "string") {
      return;
    }

    const mcpConfig = agent["mcp-config"] && typeof agent["mcp-config"] === "object"
      ? Object.keys(agent["mcp-config"])[0] || null
      : null;

    registry[agent.name] = {
      role: typeof agent.role === "string" ? agent.role : "specialist",
      capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : [],
      domains: Array.isArray(agent.domains)
        ? agent.domains.map((domain) => String(domain).toLowerCase())
        : ["general"],
      priority: Number.isFinite(Number(agent.priority)) ? Number(agent.priority) : 100,
      description: typeof agent.description === "string" ? agent.description : "",
      mcp_config: mcpConfig,
    };
  });

  return Object.keys(registry).length > 0 ? registry : { ...DEFAULT_AGENT_REGISTRY };
}

function getOrchestratorConfig(config) {
  const agents = Array.isArray(config?.agents) ? config.agents : [];
  return (
    agents.find((agent) => agent?.name === config?.defaultAgentName)
    || agents.find((agent) => agent?.role === "orchestrator")
    || agents.find((agent) => agent?.name === "orchestrator-agent")
    || null
  );
}

function buildRuleIndex(config) {
  const orchestrator = getOrchestratorConfig(config);
  const rules = Array.isArray(orchestrator?.["delegation-rules"])
    ? orchestrator["delegation-rules"].filter((rule) => rule && typeof rule === "object")
    : [];

  const categoryToAgent = {};
  const categoryKeywords = {};

  rules.forEach((rule) => {
    const category = typeof rule.category === "string" ? rule.category.toLowerCase() : null;
    const targetAgent = typeof rule["target-agent"] === "string" ? rule["target-agent"] : null;
    if (!category || !targetAgent) {
      return;
    }

    categoryToAgent[category] = targetAgent;
    categoryKeywords[category] = [
      ...normalizeStringArray(rule.keywords),
      ...normalizeStringArray(rule["semantic-keywords"]),
    ];
  });

  return { rules, categoryToAgent, categoryKeywords };
}

function createFallbackContracts() {
  return {
    input_schema: {
      type: "object",
      required: [
        "task_id",
        "target_agent",
        "role",
        "work_type",
        "objective",
        "subtasks",
        "constraints",
        "expected_deliverables",
      ],
    },
    output_schema: {
      type: "object",
      required: [
        "task_id",
        "agent",
        "work_type",
        "status",
        "summary",
        "subtask_results",
        "deliverables",
        "handoff",
      ],
    },
  };
}

function buildDelegationSettings() {
  const config = readAgentConfig();
  const agentRegistry = buildRegistryFromConfig(config);
  const { rules, categoryToAgent, categoryKeywords } = buildRuleIndex(config);

  const workTypesConfig = config?.["multi-agent"]?.["work-types"];
  const workTypeByCategory =
    workTypesConfig && typeof workTypesConfig?.["by-category"] === "object"
      ? workTypesConfig["by-category"]
      : {};
  const workTypeByAgent =
    workTypesConfig && typeof workTypesConfig?.["by-agent"] === "object"
      ? workTypesConfig["by-agent"]
      : {};
  const defaultWorkType =
    typeof workTypesConfig?.default === "string"
      ? workTypesConfig.default
      : WORK_TYPES.GENERAL;

  const contractsConfig = config?.["multi-agent"]?.contracts;
  const contractsByWorkType =
    contractsConfig && typeof contractsConfig?.["by-work-type"] === "object"
      ? contractsConfig["by-work-type"]
      : {};
  const defaultContract =
    contractsConfig && typeof contractsConfig?.default === "object"
      ? contractsConfig.default
      : createFallbackContracts();

  return {
    agentRegistry,
    rules,
    categoryToAgent,
    categoryKeywords,
    workTypeByCategory,
    workTypeByAgent,
    defaultWorkType,
    contractsByWorkType,
    defaultContract,
  };
}

function getDelegationSettings() {
  if (!cachedDelegationSettings) {
    cachedDelegationSettings = buildDelegationSettings();
  }
  return cachedDelegationSettings;
}

/**
 * Determines the best agent(s) for a task
 * @param {object} taskPlan - Task plan from planTask()
 * @returns {array} Recommended agents with routing details
 */
export function determineAgent(taskPlan) {
  const settings = getDelegationSettings();
  const { category, complexity, subtasks } = taskPlan;

  // For simple tasks, use single agent
  if (complexity === "simple") {
    const agent = findBestAgent(category, settings);
    return [
      {
        agent: agent,
        role: "primary",
        subtasks: subtasks,
        instructions: createDelegationInstructions(taskPlan, agent, "primary"),
        constraints: createConstraints(taskPlan),
      },
    ];
  }

  // For moderate tasks, potentially multiple agents
  if (complexity === "moderate") {
    const uniqueCategories = new Set([category]);
    subtasks.forEach((subtask) => {
      const inferredCategory = inferCategory(subtask.description, settings);
      if (inferredCategory) uniqueCategories.add(inferredCategory);
    });

    const agentList = Array.from(uniqueCategories).map((cat) => findBestAgent(cat, settings));
    const uniqueAgents = [...new Set(agentList)];

    if (uniqueAgents.length === 1) {
      return [
        {
          agent: uniqueAgents[0],
          role: "primary",
          subtasks: subtasks,
          instructions: createDelegationInstructions(taskPlan, uniqueAgents[0], "primary"),
        },
      ];
    }

    // Multiple agents needed for different subtasks
    return subtasks.map((subtask, index) => {
      const inferredCategory = inferCategory(subtask.description, settings);
      const agent = findBestAgent(inferredCategory, settings);
      return {
        agent: agent,
        role: index === 0 ? "primary" : "supporting",
        subtasks: [subtask],
        dependencies: subtask.dependencies,
        instructions: createDelegationInstructions(
          { ...taskPlan, subtasks: [subtask] },
          agent,
          "supporting"
        ),
      };
    });
  }

  // For complex tasks, coordinate between multiple agents
  if (complexity === "complex") {
    return planComplexDelegation(taskPlan, settings);
  }

  // Fallback
  return [
    {
      agent: "orchestrator-agent",
      role: "primary",
      subtasks: subtasks,
      instructions: createDelegationInstructions(taskPlan, "orchestrator-agent", "primary"),
    },
  ];
}

/**
 * Finds the best agent for a category
 * @param {string} category - Task category
 * @returns {string} Best agent name
 */
function findBestAgent(category, settings = getDelegationSettings()) {
  const knownAgent = category ? settings.categoryToAgent[String(category).toLowerCase()] : null;
  if (knownAgent) {
    return knownAgent;
  }

  if (!category) return "orchestrator-agent";

  const categoryLower = category.toLowerCase();

  // Direct category matches
  if (categoryLower.includes("atlassian") || categoryLower.includes("jira") || categoryLower.includes("confluence")) {
    return "atlassian-agent";
  }
  if (categoryLower.includes("workato") || categoryLower.includes("automation")) {
    return "workato-dev";
  }
  if (categoryLower.includes("code") || categoryLower.includes("implementation")) {
    return "code-agent";
  }
  if (categoryLower.includes("documentation")) {
    return "doc-agent";
  }

  const matchedAgent = Object.entries(settings.agentRegistry).find(([, info]) =>
    Array.isArray(info.domains) && info.domains.includes(categoryLower)
  );
  if (matchedAgent) {
    return matchedAgent[0];
  }

  return "orchestrator-agent";
}

/**
 * Infers the category from task description
 * @param {string} description - Task description
 * @returns {string} Inferred category or null
 */
function inferCategory(description, settings = getDelegationSettings()) {
  const keywords = Object.keys(settings.categoryKeywords).length > 0
    ? settings.categoryKeywords
    : {
      atlassian: [
        "jira",
        "confluence",
        "epic",
        "backlog",
        "sprint",
        "issue",
        "ticket",
        "workflow",
      ],
      workato: ["workato", "automation", "integration", "workflow", "trigger", "action"],
      coding: ["code", "function", "refactor", "debug", "test", "implement", "component"],
      documentation: ["document", "write", "guide", "readme", "explain", "describe"],
    };

  const descLower = description.toLowerCase();

  for (const [category, words] of Object.entries(keywords)) {
    if (words.some((word) => descLower.includes(word))) {
      return category;
    }
  }

  return null;
}

/**
 * Creates detailed delegation instructions for an agent
 * @param {object} taskPlan - Task plan
 * @param {string} agent - Target agent name
 * @param {string} role - Agent role (primary/supporting)
 * @returns {object} Delegation instructions
 */
function createDelegationInstructions(taskPlan, agent, role) {
  const settings = getDelegationSettings();
  const agentInfo = settings.agentRegistry[agent] || DEFAULT_AGENT_REGISTRY[agent] || {
    capabilities: [],
    mcp_config: null,
  };
  const workType = determineWorkType(taskPlan, agent, settings);
  const expectedDeliverables = createExpectedDeliverables(workType, taskPlan);
  const dependencies = extractDependencies(taskPlan.subtasks);
  const requestPayload = createSubAgentRequestPayload(
    taskPlan,
    agent,
    role,
    workType,
    dependencies,
    expectedDeliverables,
    agentInfo
  );

  return {
    contract_version: DELEGATION_CONTRACT_VERSION,
    work_type: workType,
    agent_name: agent,
    agent_role: role,
    agent_capabilities: agentInfo.capabilities,
    original_request: taskPlan.original_request,
    complexity: taskPlan.complexity,
    subtasks: taskPlan.subtasks,
    expected_deliverables: expectedDeliverables,
    contracts: createSubAgentContracts(workType, settings),
    request_payload: requestPayload,
    instructions: {
      primary_objective: createObjective(taskPlan),
      constraints: createConstraints(taskPlan, agent),
      success_criteria: createSuccessCriteria(taskPlan),
      context: {
        original_complexity: taskPlan.complexity,
        category: taskPlan.category,
        dependencies,
      },
      mcp_config: agentInfo.mcp_config || null,
      response_format:
        "Return only JSON that matches contracts.output_schema.required fields. Do not return free-form text outside the JSON envelope.",
    },
  };
}

function determineWorkType(taskPlan, agent, settings = getDelegationSettings()) {
  const byAgent = settings.workTypeByAgent || {};
  if (typeof byAgent[agent] === "string" && byAgent[agent].length > 0) {
    return byAgent[agent];
  }

  const byCategory = settings.workTypeByCategory || {};
  if (typeof byCategory[taskPlan.category] === "string" && byCategory[taskPlan.category].length > 0) {
    return byCategory[taskPlan.category];
  }

  if (taskPlan.category === "atlassian" || agent === "atlassian-agent") {
    return WORK_TYPES.ATLASSIAN;
  }
  if (taskPlan.category === "workato" || agent === "workato-dev") {
    return WORK_TYPES.AUTOMATION;
  }
  if (taskPlan.category === "coding" || agent === "code-agent") {
    return WORK_TYPES.CODE;
  }
  if (taskPlan.category === "documentation" || agent === "doc-agent") {
    return WORK_TYPES.DOCS;
  }
  if (agent === "orchestrator-agent") {
    return WORK_TYPES.ORCHESTRATION;
  }
  return settings.defaultWorkType || WORK_TYPES.GENERAL;
}

function createExpectedDeliverables(workType, taskPlan) {
  const settings = getDelegationSettings();
  const configuredDeliverables = settings.contractsByWorkType?.[workType]?.expected_deliverables;
  if (Array.isArray(configuredDeliverables) && configuredDeliverables.length > 0) {
    return [
      ...configuredDeliverables,
      `Subtask count: ${taskPlan.subtasks.length}`,
    ];
  }

  const base = [
    "Execution summary mapped to each assigned subtask",
    "Status for each step (completed, blocked, skipped)",
    "Evidence and references for all claims",
  ];

  const byType = {
    [WORK_TYPES.ATLASSIAN]: [
      "Jira and Confluence operation results with issue/page keys",
      "JQL or query details used for retrieval",
    ],
    [WORK_TYPES.AUTOMATION]: [
      "Workflow design and trigger/action mapping",
      "Integration dependencies and configuration requirements",
    ],
    [WORK_TYPES.CODE]: [
      "File-level change list and implementation notes",
      "Validation output from tests or checks",
    ],
    [WORK_TYPES.DOCS]: [
      "Updated document sections with affected paths",
      "Content coverage against requested scope",
    ],
    [WORK_TYPES.ORCHESTRATION]: [
      "Phase-level coordination status",
      "Next-step routing recommendation",
    ],
    [WORK_TYPES.GENERAL]: ["Task result with concrete output"],
  };

  return [
    ...base,
    ...(byType[workType] || byType[WORK_TYPES.GENERAL]),
    `Subtask count: ${taskPlan.subtasks.length}`,
  ];
}

function createSubAgentRequestPayload(
  taskPlan,
  agent,
  role,
  workType,
  dependencies,
  expectedDeliverables,
  agentInfo
) {
  return {
    task_id: `delegation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    target_agent: agent,
    role,
    work_type: workType,
    objective: createObjective(taskPlan),
    original_request: taskPlan.original_request,
    complexity: taskPlan.complexity,
    category: taskPlan.category,
    mcp_config: agentInfo.mcp_config || null,
    constraints: createConstraints(taskPlan, agent),
    subtasks: taskPlan.subtasks.map((subtask, index) => ({
      id: `S${index + 1}`,
      order: subtask.order ?? index + 1,
      description: subtask.description,
      dependencies: Array.isArray(subtask.dependencies) ? subtask.dependencies : [],
      expected_output: `Result payload for subtask ${index + 1}`,
    })),
    dependencies,
    expected_deliverables: expectedDeliverables,
  };
}

function createSubAgentContracts(workType, settings = getDelegationSettings()) {
  const configured = settings.contractsByWorkType?.[workType];
  if (
    configured
    && typeof configured === "object"
    && typeof configured.input_schema === "object"
    && typeof configured.output_schema === "object"
  ) {
    return configured;
  }

  if (
    settings.defaultContract
    && typeof settings.defaultContract === "object"
    && typeof settings.defaultContract.input_schema === "object"
    && typeof settings.defaultContract.output_schema === "object"
  ) {
    return settings.defaultContract;
  }

  const inputSchema = {
    type: "object",
    required: [
      "task_id",
      "target_agent",
      "role",
      "work_type",
      "objective",
      "subtasks",
      "constraints",
      "expected_deliverables",
    ],
    properties: {
      task_id: { type: "string", description: "Unique delegation task identifier" },
      target_agent: { type: "string", description: "Agent name expected to execute this task" },
      role: { type: "string", enum: ["primary", "supporting"] },
      work_type: { type: "string", description: "Task class used to enforce domain-specific outputs" },
      objective: { type: "string" },
      original_request: { type: "string" },
      complexity: { type: "string", enum: ["simple", "moderate", "complex"] },
      category: { type: "string" },
      mcp_config: { type: ["string", "null"] },
      constraints: { type: "array", items: { type: "string" } },
      subtasks: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "order", "description", "dependencies", "expected_output"],
          properties: {
            id: { type: "string" },
            order: { type: "number" },
            description: { type: "string" },
            dependencies: { type: "array", items: { type: "number" } },
            expected_output: { type: "string" },
          },
        },
      },
      dependencies: { type: "object" },
      expected_deliverables: { type: "array", items: { type: "string" } },
    },
  };

  const outputSchema = {
    type: "object",
    required: [
      "task_id",
      "agent",
      "work_type",
      "status",
      "summary",
      "subtask_results",
      "deliverables",
      "handoff",
    ],
    properties: {
      task_id: { type: "string" },
      agent: { type: "string" },
      work_type: { type: "string", const: workType },
      status: { type: "string", enum: ["completed", "partial", "blocked", "failed"] },
      summary: { type: "string" },
      subtask_results: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "status", "result"],
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["completed", "partial", "blocked", "failed", "skipped"] },
            result: { type: "string" },
            evidence: { type: "array", items: { type: "string" } },
            blockers: { type: "array", items: { type: "string" } },
          },
        },
      },
      deliverables: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "value"],
          properties: {
            type: { type: "string" },
            value: { type: "string" },
          },
        },
      },
      handoff: {
        type: "object",
        required: ["next_action", "needs_clarification"],
        properties: {
          next_action: { type: "string" },
          needs_clarification: { type: "boolean" },
          clarification_questions: { type: "array", items: { type: "string" } },
        },
      },
    },
  };

  return {
    input_schema: inputSchema,
    output_schema: outputSchema,
  };
}

/**
 * Creates primary objective statement
 * @param {object} taskPlan - Task plan
 * @returns {string} Objective
 */
function createObjective(taskPlan) {
  const subtaskCount = taskPlan.subtasks.length;

  if (subtaskCount === 1) {
    return `Execute: ${taskPlan.subtasks[0].description}`;
  }

  return `Complete the following ${subtaskCount} tasks in sequence:\n${taskPlan.subtasks
    .map((t, i) => `${i + 1}. ${t.description}`)
    .join("\n")}`;
}

/**
 * Creates constraints for execution
 * @param {object} taskPlan - Task plan
 * @returns {array} Array of constraints
 */
function createConstraints(taskPlan) {
  const constraints = [
    "Respect all existing architectural patterns and conventions",
    "Maintain code/documentation consistency",
    "Preserve security and compliance standards",
  ];

  if (taskPlan.complexity === "complex") {
    constraints.push("Validate each subtask before proceeding to the next");
    constraints.push("Report any blocking issues immediately");
  }

  if (taskPlan.category === "atlassian") {
    constraints.push("Use appropriate JQL for all Jira queries");
    constraints.push("Maintain issue linking and epic relationships");
  }

  return constraints;
}

/**
 * Creates success criteria
 * @param {object} taskPlan - Task plan
 * @returns {array} Success criteria
 */
function createSuccessCriteria(taskPlan) {
  const criteria = [];

  taskPlan.subtasks.forEach((subtask, index) => {
    criteria.push({
      subtask: index + 1,
      description: subtask.description,
      validation: `Subtask ${index + 1} completed successfully`,
    });
  });

  criteria.push({
    subtask: "overall",
    description: "All subtasks completed",
    validation: "All outputs validated and ready for use",
  });

  return criteria;
}

/**
 * Extracts task dependencies
 * @param {array} subtasks - Subtasks array
 * @returns {object} Dependency map
 */
function extractDependencies(subtasks) {
  const dependencies = {};

  subtasks.forEach((subtask, index) => {
    if (subtask.dependencies && subtask.dependencies.length > 0) {
      dependencies[index] = subtask.dependencies.map((depIndex) => ({
        blocked_task: index,
        depends_on_task: depIndex,
        must_complete_first: subtasks[depIndex].description,
      }));
    }
  });

  return dependencies;
}

/**
 * Plans delegation for complex multi-agent tasks
 * @param {object} taskPlan - Task plan
 * @returns {array} Complex delegation plan
 */
function planComplexDelegation(taskPlan, settings = getDelegationSettings()) {
  const delegations = [];
  const phasedSubtasks = groupSubtasksByPhase(taskPlan.subtasks);

  phasedSubtasks.forEach((phase, phaseIndex) => {
    const agentsInPhase = identifyAgentsForPhase(phase, settings);

    agentsInPhase.forEach((agent) => {
      const phaseTasks = phase.filter((subtask) => {
        const inferredCategory = inferCategory(subtask.description, settings);
        return findBestAgent(inferredCategory, settings) === agent;
      });

      if (phaseTasks.length > 0) {
        delegations.push({
          phase: phaseIndex + 1,
          agent: agent,
          role: phaseIndex === 0 ? "primary" : "supporting",
          subtasks: phaseTasks,
          wait_for_phases: phaseIndex > 0 ? Array.from({ length: phaseIndex }, (_, i) => i + 1) : [],
          instructions: createDelegationInstructions(
            { ...taskPlan, subtasks: phaseTasks },
            agent,
            phaseIndex === 0 ? "primary" : "supporting"
          ),
        });
      }
    });
  });

  return delegations;
}

/**
 * Groups subtasks by phase/dependency level
 * @param {array} subtasks - Subtasks
 * @returns {array} Phased subtasks
 */
function groupSubtasksByPhase(subtasks) {
  if (subtasks.length <= 1) return [subtasks];

  const phases = [];
  let currentPhase = [];
  const processedIndices = new Set();

  subtasks.forEach((subtask, index) => {
    const dependencies = subtask.dependencies || [];
    const allDependenciesMet = dependencies.every((depIndex) => processedIndices.has(depIndex));

    if (dependencies.length === 0 || allDependenciesMet) {
      currentPhase.push(subtask);
      processedIndices.add(index);
    } else if (currentPhase.length > 0) {
      phases.push([...currentPhase]);
      currentPhase = [subtask];
      processedIndices.add(index);
    }
  });

  if (currentPhase.length > 0) {
    phases.push(currentPhase);
  }

  return phases;
}

/**
 * Identifies which agents are needed for a phase
 * @param {array} subtasks - Subtasks in phase
 * @returns {array} Agent names needed
 */
function identifyAgentsForPhase(subtasks, settings = getDelegationSettings()) {
  const agents = new Set();

  subtasks.forEach((subtask) => {
    const category = inferCategory(subtask.description, settings);
    const agent = findBestAgent(category, settings);
    agents.add(agent);
  });

  // Remove orchestrator if other agents are available
  if (agents.size > 1) {
    agents.delete("orchestrator-agent");
  }

  return Array.from(agents);
}

/**
 * Validates if agent has capability for task
 * @param {string} agent - Agent name
 * @param {string} capability - Required capability
 * @returns {boolean} True if agent has capability
 */
export function hasCapability(agent, capability) {
  const settings = getDelegationSettings();
  const agentInfo = settings.agentRegistry[agent];
  if (!agentInfo) return false;

  return agentInfo.capabilities.includes(capability);
}

/**
 * Gets available agents for a category
 * @param {string} category - Task category
 * @returns {array} Available agents
 */
export function getAvailableAgents(category) {
  const settings = getDelegationSettings();
  return Object.entries(settings.agentRegistry)
    .filter(([, agentInfo]) => agentInfo.domains.includes(category))
    .sort((a, b) => b[1].priority - a[1].priority)
    .map(([name, info]) => ({
      name,
      ...info,
    }));
}

/**
 * Creates a coordination plan for multi-agent execution
 * @param {array} delegations - Array of delegations
 * @returns {object} Coordination plan
 */
export function createCoordinationPlan(delegations) {
  return {
    total_phases: Math.max(...delegations.map((d) => d.phase || 1)),
    parallel_capable: canExecuteInParallel(delegations),
    phases: groupDelegationsByPhase(delegations),
    coordination_points: identifyCoordinationPoints(delegations),
    communication_plan: createCommunicationPlan(delegations),
  };
}

/**
 * Checks if delegations can run in parallel
 * @param {array} delegations - Delegations
 * @returns {boolean} Can run in parallel
 */
function canExecuteInParallel(delegations) {
  return delegations.every((d) => (!d.wait_for_phases || d.wait_for_phases.length === 0));
}

/**
 * Groups delegations by phase
 * @param {array} delegations - Delegations
 * @returns {object} Phases with delegations
 */
function groupDelegationsByPhase(delegations) {
  const phases = {};

  delegations.forEach((delegation) => {
    const phase = delegation.phase || 1;
    if (!phases[phase]) {
      phases[phase] = [];
    }
    phases[phase].push(delegation);
  });

  return phases;
}

/**
 * Identifies where coordination is needed
 * @param {array} delegations - Delegations
 * @returns {array} Coordination points
 */
function identifyCoordinationPoints(delegations) {
  const coordinationPoints = [];
  const phases = new Set(delegations.map((d) => d.phase || 1));

  phases.forEach((phase) => {
    const phaseCount = delegations.filter((d) => d.phase === phase).length;
    if (phaseCount > 1) {
      coordinationPoints.push({
        phase,
        type: "multi-agent-sync",
        agents: delegations
          .filter((d) => d.phase === phase)
          .map((d) => d.agent),
      });
    }

    // Check if next phase depends on this phase
    const nextPhase = phase + 1;
    const hasNextPhase = delegations.some((d) => d.phase === nextPhase);
    if (hasNextPhase) {
      coordinationPoints.push({
        phase,
        type: "phase-completion-validation",
        trigger_next_phase: nextPhase,
      });
    }
  });

  return coordinationPoints;
}

/**
 * Creates inter-agent communication plan
 * @param {array} delegations - Delegations
 * @returns {array} Communication points
 */
function createCommunicationPlan(delegations) {
  const communications = [];
  const phases = new Set(delegations.map((d) => d.phase || 1));

  Array.from(phases).forEach((phase) => {
    const phaseDelegations = delegations.filter((d) => d.phase === phase);
    const agents = phaseDelegations.map((d) => d.agent);

    if (agents.length > 1) {
      communications.push({
        phase,
        type: "synchronization",
        message: `Phase ${phase}: Coordinate between ${agents.join(", ")}`,
        handoff_protocol: "await-all-complete",
      });
    }

    const nextPhase = phase + 1;
    const nextDelegations = delegations.filter((d) => d.phase === nextPhase);
    if (nextDelegations.length > 0) {
      communications.push({
        phase,
        type: "handoff",
        from: phaseDelegations.map((d) => d.agent),
        to: nextDelegations.map((d) => d.agent),
        message: `Handoff from Phase ${phase} to Phase ${nextPhase}`,
      });
    }
  });

  return communications;
}

export { DEFAULT_AGENT_REGISTRY };
