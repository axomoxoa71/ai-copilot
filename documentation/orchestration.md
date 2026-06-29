# Orchestration Agent Design & Implementation Guide

## Table of Contents

- [Orchestration Agent Design & Implementation Guide](#orchestration-agent-design--implementation-guide)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Architecture](#architecture)
  - [Core Components](#core-components)
  - [Orchestration Workflow](#orchestration-workflow)
  - [Task Planning](#task-planning)
  - [Complexity Analysis](#complexity-analysis)
  - [Dialog Management](#dialog-management)
  - [Execution Policy](#execution-policy)
  - [Delegation Strategies](#delegation-strategies)
  - [Agent Registry](#agent-registry)
  - [Execution Models](#execution-models)
  - [Examples](#examples)
  - [Integration Guide](#integration-guide)
  - [Best Practices](#best-practices)

## Overview

The Orchestration Agent is the strategic coordinator of the multi-agent system. It analyzes user requests, breaks down complex work, identifies clarification needs, and intelligently delegates tasks to specialist agents.

**Key Capabilities:**

- 🔍 **Request Analysis**: Determine task complexity and category
- 📋 **Task Breakdown**: Decompose complex requests into manageable subtasks
- ❓ **Clarification**: Identify and resolve ambiguities through dialog
- 🎯 **Intelligent Delegation**: Route tasks to optimal specialist agents
- 🔗 **Coordination**: Manage dependencies and sequencing
- 📊 **Reporting**: Summarize plans and results clearly

## Execution Policy

The runtime uses a tool-first, non-blocking execution policy:

- Execute available tools immediately instead of replying with plan-only text such as "I would run this JQL query".
- Return executed results in chat and continue the workflow without user interaction.
- Ask the user for input only when blocked by missing required values, missing permissions, or explicit confirmation requirements for sensitive/destructive actions.
- When context is optional or can be inferred safely, proceed with best-effort assumptions and state those assumptions briefly in the response.

## Architecture

```
User Request
    ↓
[Orchestration Agent]
    ├─→ Task Planner (complexity, category, breakdown)
    ├─→ Dialog Manager (identifies open questions)
    ├─→ Delegation Strategies (recommends agents)
    └─→ Routing Logic
        ├─→ Direct Response (simple queries)
        ├─→ Dialog First (open questions)
        ├─→ Plan & Confirm (moderate complexity)
        └─→ Complex Coordination (multi-agent)
            ├─→ [Specialist Agent 1]
            ├─→ [Specialist Agent 2]
            └─→ [Specialist Agent N]
```

## Core Components

### 1. Task Planner (`task-planner.js`)

Analyzes user requests and creates a structured task plan.

**Key Functions:**

- `planTask(userRequest)` - Main planning function
- `determineComplexity(request)` - Evaluates task complexity
- `categorizeTask(request)` - Identifies domain/category
- `breakDownTask(request)` - Decomposes into subtasks
- `identifyOpenQuestions(request)` - Finds ambiguities
- `recommendAgents(request)` - Suggests appropriate agents
- `selectApproach(request)` - Chooses execution strategy

**Output:**

```javascript
{
  original_request: "...",
  timestamp: "2024-01-15T10:30:00Z",
  complexity: "complex|moderate|simple",
  category: "atlassian|workato|coding|documentation|general",
  subtasks: [
    { order: 1, description: "...", dependencies: [] },
    { order: 2, description: "...", dependencies: [0] }
  ],
  open_questions: [
    { type: "conditional", question: "..." }
  ],
  recommended_agents: [
    { name: "atlassian-agent", priority: 100, confidence: 0.95 }
  ],
  approach: {
    strategy: "planning-delegation|guided-delegation|direct-execution|dialog-first",
    steps: [...],
    rationale: "..."
  }
}
```

### 2. Dialog Manager (`dialog-manager.js`)

Handles clarification dialogs and open question resolution.

**Key Functions:**

- `createClarificationDialog(openQuestions)` - Formats questions for user
- `formatDialogForUser(dialog)` - Creates user-friendly dialog
- `processDialogAnswers(dialog, answers)` - Processes user responses
- `createContextFromAnswers(dialog)` - Extracts structured context
- `validateDialogCompletion(dialog)` - Checks if ready to proceed

**Question Types:**

- `EXPLICIT` - Direct questions from user
- `CONDITIONAL` - "if X, then Y" scenarios
- `AMBIGUOUS` - Unclear references
- `CONTEXT` - Missing execution context
- `SCOPE` - Boundary/scope questions

**Output Example:**

```
❓ I need clarification to create the best plan:

🔴 Critical Questions (must answer):
1. How should the team be notified?
   *This affects how we implement notifications.*
   Options: Email • Slack • In-app • Multiple channels

💡 Quick Answers Available:
- Options: Email, Slack, In-app, Multiple channels

📝 Please answer these questions so I can create the perfect plan!
```

### 3. Delegation Strategies (`delegation-strategies.js`)

Determines optimal agent(s) for task execution.

**Key Functions:**

- `determineAgent(taskPlan)` - Recommends agent(s) for task
- `hasCapability(agent, capability)` - Checks agent capabilities
- `getAvailableAgents(category)` - Lists agents for category
- `createCoordinationPlan(delegations)` - Plans multi-agent execution
- `createDelegationInstructions(taskPlan, agent, role)` - Prepares delegation

**Agent Registry:**

Defines available agents and their capabilities:

```javascript
{
  "orchestrator-agent": {
    role: "orchestrator",
    capabilities: ["planning", "routing", "coordination"],
    domains: ["general"],
    priority: 0
  },
  "atlassian-agent": {
    role: "specialist",
    capabilities: ["jira-query", "issue-creation", "workflow-management"],
    domains: ["atlassian", "jira", "confluence"],
    priority: 100,
    mcp_config: "atlassian-mcp-docker"
  },
  // ... other agents
}
```

## Orchestration Workflow

### Step 1: Request Analysis

```
User: "Set up a new support workflow that auto-creates tasks and notifies teams"
    ↓
Task Planner analyzes:
  - Complexity: COMPLEX (multiple systems, multiple agents needed)
  - Category: WORKATO + ATLASSIAN
  - Subtasks: 3 identified
  - Open Questions: 2 identified
    → "How should notifications be delivered?"
    → "Which teams need to be notified?"
```

### Step 2: Dialog (if needed)

```
Orchestrator → User:
  "❓ I found 2 open questions that will affect the plan..."
  
User → Orchestrator:
  "Email and Slack notifications, notify Support and Dev teams"
  
Orchestrator: [Dialog resolved, proceed to planning]
```

### Step 3: Task Breakdown

```
Phase 1: Design & Validation
  - Subtask 1: Define issue detection criteria
  - Subtask 2: Plan automation flow

Phase 2: Atlassian Setup
  - Subtask 3: Configure Jira automation
  - Agent: atlassian-agent

Phase 3: Integration & Testing
  - Subtask 4: Set up Workato workflow
  - Agent: workato-dev
  - Subtask 5: End-to-end testing
```

### Step 4: Delegation

```
Orchestrator → Atlassian Agent:
  "Create automation to detect new support tickets and create tasks"
  
Orchestrator → Workato Dev:
  "Set up notifications to Support (email) and Dev (Slack) teams"
```

### Step 5: Coordination

```
Monitor phase completion:
  Phase 1 ✓ Complete
  Phase 2 ✓ Complete
  Phase 3 → In Progress
  
Once Phase 3 completes:
  Validate all pieces working together
  Report: "✅ Support workflow set up successfully"
```

## Task Planning

### Complexity Determination

**Scoring Algorithm:**

```
SIMPLE (-1 point each):
  - how many, what is, list, show me, find, search, get, fetch

COMPLEX (+2 points each):
  - integrate, configure, setup, refactor, redesign, automate

MODIFIERS:
  - Multiple sentences: +2 points
  - Conditionals (if, then, depending on): +3 points
  - Loop through and accumulate

Final Score:
  ≤ 0    → SIMPLE
  1-3    → MODERATE
  > 3    → COMPLEX
```

**Examples:**

| Request | Scoring | Result |
|---------|---------|--------|
| "Find all issues assigned to me" | find (-1) | SIMPLE |
| "Create a ticket and link it to an epic" | create (-1) + link (-1) | SIMPLE |
| "Set up an automation that monitors issues..." | setup (+2) + multiple sentences (+2) | COMPLEX |
| "When issues are created, auto-assign and notify" | conditional (+3) + multiple (+2) | COMPLEX |

### Category Detection

Pattern matching on domain keywords:

```javascript
Category: ATLASSIAN
  Keywords: jira, confluence, epic, backlog, sprint, issue, ticket
  Agent: atlassian-agent

Category: WORKATO
  Keywords: workato, automation, workflow, integration
  Agent: workato-dev

Category: CODING
  Keywords: code, function, refactor, debug, test, implement
  Agent: code-agent

Category: GENERAL
  No clear keywords
  Agent: orchestrator-agent (or collect more info)
```

### Task Breakdown

Identifies subtasks and dependencies:

```javascript
Input: "First, search for blocking issues. Then create a summary. Finally, notify the team."

Output:
[
  { order: 1, description: "Search for blocking issues", dependencies: [] },
  { order: 2, description: "Create a summary", dependencies: [0] },
  { order: 3, description: "Notify the team", dependencies: [1] }
]
```

## Complexity Analysis

### Simple Tasks

**Characteristics:**
- Single action
- No dependencies
- Clear success criteria
- Single agent can handle

**Approach:**
1. Acknowledge request
2. Delegate directly OR execute
3. Return result

**Example:**
```
User: "Show me all open Jira tickets assigned to me"
Orchestrator: "Let me get those for you..."
[Delegates to atlassian-agent]
Result: [List of tickets]
```

### Moderate Tasks

**Characteristics:**
- 2-3 related steps
- Some dependencies
- Needs confirmation
- May involve multiple sub-actions

**Approach:**
1. Create breakdown
2. Present plan
3. Get user confirmation
4. Execute sequentially
5. Report results

**Example:**
```
User: "Create a Jira ticket for this bug and link it to the Backend project"
Orchestrator: "📋 Here's my plan:
  1. Create ticket in Backend project
  2. Link to appropriate epic
Proceed? [Y/N]"
```

### Complex Tasks

**Characteristics:**
- 4+ steps
- Multiple dependencies
- Interdependent actions
- Multi-agent coordination needed
- Decisions required at each phase

**Approach:**
1. Analyze completely
2. Create detailed plan with phases
3. Present for approval
4. Get confirmation on approach
5. Delegate to agents with coordination
6. Monitor phase transitions
7. Validate final output

**Example:**
```
User: "Set up a support workflow automation..."
Orchestrator: "⏱️ Complexity: Complex

📅 Detailed Plan:
  Phase 1: Design & Validation
    - Define automation criteria
  
  Phase 2: Atlassian Setup
    - Configure Jira rules → [atlassian-agent]
  
  Phase 3: Integration
    - Set up Workato workflow → [workato-dev]

🔗 Dependencies:
  - Phase 2 must complete before Phase 3
  
Approve? [Y/N]"
```

## Dialog Management

### When to Ask Questions

**Rule: Ask before planning if any of these exist:**

1. **Conditional statements** ("if X, then Y")
   ```
   Question: "How should we handle [condition]?"
   ```

2. **Ambiguous pronouns** ("it", "that", used multiple times)
   ```
   Question: "Can you clarify what [pronoun] refers to?"
   ```

3. **Missing context** (no timeline, success criteria, etc.)
   ```
   Question: "What's the expected outcome?"
   ```

4. **Multiple valid interpretations**
   ```
   Question: "Did you mean [Option A] or [Option B]?"
   ```

5. **Unclear dependencies**
   ```
   Question: "What triggers the next step?"
   ```

### Question Priority

```
Priority 9-10 (CRITICAL - must answer):
  - Scope and boundaries
  - Success criteria
  - Blocking dependencies
  
Priority 6-8 (IMPORTANT):
  - Timeline/urgency
  - Notification preferences
  - Team involvement
  
Priority 1-5 (OPTIONAL):
  - Additional context
  - Preferences
  - Nice-to-haves
```

### Dialog Flow

```
User Request
    ↓
Orchestrator: Has open questions?
    ├─ YES → createClarificationDialog()
    │         Display to user
    │         Wait for answers
    │         processDialogAnswers()
    │         createContextFromAnswers()
    │         validateDialogCompletion()
    │         If complete → Continue to planning
    │         If missing → Re-prompt
    │
    └─ NO → Skip dialog, proceed to planning
```

## Delegation Strategies

### Single-Agent Delegation

**When:** SIMPLE or MODERATE complexity, single category

```javascript
delegations = [
  {
    agent: "atlassian-agent",
    role: "primary",
    subtasks: [...],
    instructions: { ... }
  }
]
```

### Multi-Agent Sequential

**When:** MODERATE complexity, multiple categories with clear sequence

```javascript
delegations = [
  {
    agent: "atlassian-agent",
    role: "primary",
    subtasks: [task1],
    wait_for_phases: []
  },
  {
    agent: "workato-dev",
    role: "supporting",
    subtasks: [task2],
    wait_for_phases: [1]  // Waits for phase 1
  }
]
```

### Multi-Agent Coordinated

**When:** COMPLEX with multiple dependencies

```javascript
phases = {
  1: [
    { agent: "atlassian-agent", subtasks: [...] }
  ],
  2: [
    { agent: "workato-dev", subtasks: [...] }
  ],
  3: [
    { agent: "atlassian-agent", subtasks: [...] }
  ]
}
```

Each phase waits for previous completion.

## Agent Registry

### Available Agents

**Orchestrator Agent**
- Role: Orchestrator
- Capabilities: Planning, routing, coordination, general QA
- Domains: General
- Use when: No specialist available or general inquiries

**Atlassian Agent**
- Role: Specialist
- Capabilities: Jira queries, issue creation/updates, Confluence search, workflow management
- Domains: Atlassian, Jira, Confluence
- MCP Config: atlassian-mcp-docker
- Use when: Working with Jira or Confluence

**Workato Dev**
- Role: Specialist
- Capabilities: Workflow creation, integration setup, automation design
- Domains: Workato, automation, integration
- Use when: Building automated workflows or integrations

**Code Agent** (when available)
- Role: Specialist
- Capabilities: Code implementation, debugging, refactoring, testing
- Domains: Coding, implementation
- Use when: Implementing features or fixing code

**Doc Agent** (when available)
- Role: Specialist
- Capabilities: Documentation writing, content creation
- Domains: Documentation, content
- Use when: Creating or updating documentation

## Execution Models

### Direct Execution Model

```
Simple Request
    ↓
Acknowledge
    ↓
Execute OR Delegate directly
    ↓
Return Result
```

### Dialog-First Model

```
Request with Open Questions
    ↓
Create Dialog
    ↓
Present to User
    ↓
Process Answers
    ↓
Enrich Context
    ↓
Proceed to Planning
```

### Planning-Confirmation Model

```
Request
    ↓
Analyze & Break Down
    ↓
Create Plan
    ↓
Present to User
    ↓
Get Confirmation
    ↓
Execute
```

### Coordination Model

```
Complex Multi-Agent Task
    ↓
Analyze All Requirements
    ↓
Create Detailed Plan with Phases
    ↓
Present for Approval
    ↓
Get Confirmation
    ↓
Execute Phase 1
    ↓
Coordinate Between Agents
    ↓
Execute Phase 2-N
    ↓
Validate Output
```

## Examples

### Example 1: Simple Task

```
User: "What Jira issues are in the Mobile project?"

Orchestrator:
  - Complexity: SIMPLE
  - Category: ATLASSIAN
  - Action: Direct delegation
  - Delegate to: atlassian-agent
  
Response: [List of issues with links]
```

### Example 2: Moderate Task with Dialog

```
User: "Create a new bug ticket with these details"

Orchestrator:
  - Open Question: "What project should this go in?"
  - Ask User
  
User Response: "Backend project"

Orchestrator:
  - Plan:
    1. Create ticket in Backend project
    2. Set fields to bug type
    3. Add description
  - Delegate to: atlassian-agent
  
Response: "✅ Ticket created: BACKEND-123"
```

### Example 3: Complex Multi-Agent Task

```
User: "Automate our daily standup: create issues for blockers
       found in last 24 hours and post summary to Slack"

Orchestrator Analysis:
  - Complexity: COMPLEX
  - Categories: ATLASSIAN + WORKATO
  - Open Questions:
    1. "What JQL defines 'blocker'?"
    2. "Which Slack channel for summary?"
  
Create Dialog:
  Q1: How to identify blockers?
  Q2: Which Slack channel?
  
User Answers:
  A1: "status = 'blocked' AND updated >= -24h"
  A2: "standup-summary channel"
  
Create Plan:
  Phase 1: Search
    - Subtask 1: Query Jira for blockers
    → atlassian-agent
    
  Phase 2: Create
    - Subtask 2: Create issue summaries
    → atlassian-agent (depends on Phase 1)
    
  Phase 3: Notify
    - Subtask 3: Post to Slack with summaries
    → workato-dev (depends on Phase 2)
  
Present Plan: Get Confirmation

Execute:
  Phase 1 ✓ Complete (found 3 blockers)
  Phase 2 ✓ Complete (created summary issue)
  Phase 3 ✓ Complete (posted to Slack)
  
Response: "✅ Daily standup automated:
  - 3 blockers identified
  - Summary issue created
  - Team notified in Slack"
```

## Integration Guide

### Using in Server.js

```javascript
import { planTask } from "./task-planner.js";
import { createClarificationDialog } from "./dialog-manager.js";
import { determineAgent } from "./delegation-strategies.js";

// In message handling:
const taskPlan = planTask(userMessage);

if (taskPlan.open_questions.length > 0) {
  // Ask user for clarification
  const dialog = createClarificationDialog(taskPlan.open_questions);
  return sendDialogToUser(dialog);
}

// Otherwise, proceed with delegation
const agents = determineAgent(taskPlan);
// ... handle delegation
```

### System Prompt Integration

Update agent-config.json orchestrator system-prompt:

```json
{
  "system-prompt": "[content of ORCHESTRATOR_SYSTEM_PROMPT.md]"
}
```

### Environment Setup

Ensure these modules are imported in server.js:

```javascript
import { planTask, COMPLEXITY_LEVELS, TASK_CATEGORIES } from "./task-planner.js";
import { 
  createClarificationDialog, 
  formatDialogForUser,
  processDialogAnswers 
} from "./dialog-manager.js";
import { 
  determineAgent,
  createCoordinationPlan,
  AGENT_REGISTRY 
} from "./delegation-strategies.js";
```

## Best Practices

### Planning

1. ✅ **Always analyze before executing**
   - Use `planTask()` for every request
   - Assess complexity level
   - Identify open questions early

2. ✅ **Break down complex tasks**
   - Use `breakDownTask()` to decompose
   - Identify dependencies
   - Create clear phases

3. ✅ **Ask before guessing**
   - Use `identifyOpenQuestions()` to find ambiguities
   - Create dialog early
   - Wait for clarification before planning

### Delegation

1. ✅ **Match task to agent capability**
   - Use `determineAgent()` for routing
   - Check `hasCapability()` for verification
   - Default to "orchestrator-agent" if unsure

2. ✅ **Provide complete context**
   - Include original request
   - Share task breakdown
   - Pass relevant configurations

3. ✅ **Set clear success criteria**
   - Define what "done" means
   - Specify validation requirements
   - Include acceptance criteria

### Communication

1. ✅ **Be transparent about decisions**
   - Explain why you chose this approach
   - Show the breakdown
   - Justify routing decisions

2. ✅ **Use structured formatting**
   - Clear headings
   - Bullet points for lists
   - Emoji for visual clarity

3. ✅ **Ask for confirmation on complex work**
   - Present plan before executing
   - Get user approval
   - Confirm constraints and preferences

### Coordination

1. ✅ **Monitor phase transitions**
   - Wait for phase completion
   - Validate outputs
   - Handle errors appropriately

2. ✅ **Maintain context across agents**
   - Share relevant information
   - Preserve dependencies
   - Report progress to user

3. ✅ **Validate final results**
   - Check all criteria met
   - Summarize accomplishments
   - Provide next steps if needed

---

This orchestration framework ensures that complex, multi-step tasks are broken down intelligently, ambiguities are resolved through dialog, and work is delegated to the most appropriate specialist agents. The result is clear planning, efficient execution, and predictable outcomes.
