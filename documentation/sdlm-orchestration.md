# SDLM (Software Development Lifecycle Management) Orchestrator

## Table of Contents

- [SDLM (Software Development Lifecycle Management) Orchestrator](#sdlm-software-development-lifecycle-management-orchestrator)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [SDLM Workflow Phases](#sdlm-workflow-phases)
  - [Phase 1: Requirements Collection](#phase-1-requirements-collection)
  - [Phase 2: Requirements Refinement](#phase-2-requirements-refinement)
  - [Phase 3: Design Validation](#phase-3-design-validation)
  - [Phase 4: Work Breakdown](#phase-4-work-breakdown)
  - [Phase 5: Implementation Planning](#phase-5-implementation-planning)
  - [Phase 6: Implementation & Validation](#phase-6-implementation--validation)
  - [Orchestration Flow](#orchestration-flow)
  - [Example Workflows](#example-workflows)
  - [API Reference](#api-reference)
  - [Best Practices](#best-practices)

## Overview

The SDLM Orchestrator manages the complete Software Development Lifecycle from requirements collection through deployment. It ensures that:

1. ✅ **All requirements are collected** from Jira epics and linked Confluence pages
2. ✅ **Unclear requirements are refined** through structured dialog
3. ✅ **Standards are enforced** against the Design & Implementation Standards
4. ✅ **Work is properly broken down** into epics, stories, and tasks
5. ✅ **Teams are guided** through implementation with clear acceptance criteria
6. ✅ **Quality is maintained** through validation and testing tasks

**Key Components:**

```
SDLM Orchestrator
  ├─ Requirements Collector
  │  └─ Fetches from Jira + linked Confluence
  ├─ Clarity Analyzer  
  │  └─ Identifies unclear requirements
  ├─ Refinement Dialog Manager
  │  └─ Creates clarification dialogs
  ├─ Design Standards Validator
  │  └─ Validates against FLICORE standards
  ├─ Work Breakdown Engine
  │  └─ Creates epics, stories, tasks
  └─ Implementation Planner
     └─ Creates phases and delegation instructions
```

## SDLM Workflow Phases

```
Jira Epic
    ↓
[Phase 1: Requirements Collection]
    ├─ Fetch epic details
    ├─ Get all child issues
    └─ Extract linked Confluence pages
    ↓
[Phase 2: Requirements Refinement] ← USER DIALOG HERE
    ├─ Analyze clarity of each requirement
    ├─ Identify ambiguous/incomplete items
    ├─ Create refinement dialog if needed
    └─ Process user answers
    ↓
[Phase 3: Design Validation]
    ├─ Fetch Design & Implementation Standards
    ├─ Validate requirements against standards
    └─ Generate compliance recommendations
    ↓
[Phase 4: Work Breakdown]
    ├─ Create stories from functional requirements
    ├─ Create tasks (Design, Implementation, Review, Test)
    ├─ Create testing tasks
    └─ Create compliance tasks
    ↓
[Phase 5: Implementation Planning]
    ├─ Organize into phases (Design, Implementation, Testing, Deployment)
    ├─ Create delegation instructions
    └─ Identify dependencies
    ↓
[Phase 6: Implementation & Validation]
    ├─ → Delegate to design-agent
    ├─ → Delegate to code-agent
    ├─ → Delegate to test-agent
    └─ → Coordinate with orchestrator-agent
```

## Phase 1: Requirements Collection

### Purpose
Gather all requirements from Jira epic and linked Confluence documentation.

### Process

```javascript
const requirements = await collectRequirements(
  "PROJ-123",        // Jira epic key
  atlassianClient    // API client with Jira/Confluence access
);
```

### Output

```javascript
{
  epic_key: "PROJ-123",
  collected_at: "2024-01-15T10:30:00Z",
  sources: [
    { type: "jira-epic", key: "PROJ-123", title: "..." }
  ],
  aggregated_requirements: [
    { source: "PROJ-123", type: "Epic", summary: "...", description: "..." },
    { source: "PROJ-456", type: "Story", summary: "...", description: "..." }
  ],
  functional_requirements: [
    { source: "PROJ-456", text: "...", priority: "High", type: "functional" }
  ],
  non_functional_requirements: [
    { source: "PROJ-789", text: "...", category: "Performance" }
  ],
  constraints: [...],
  acceptance_criteria: [...],
  linked_pages: [
    { title: "Design Pattern A", url: "...", type: "confluence", linked_from: "PROJ-456" }
  ],
  status: "completed",
  total_issues: 15,
  total_requirements: 42
}
```

### Sources

- **Jira Issues**: Summary, description, priority, acceptance criteria
- **Confluence Pages**: Design standards, implementation rules, architectural decisions
- **Issue Relationships**: Child issues, epic links, documentation links

---

## Phase 2: Requirements Refinement

### Purpose
Identify unclear, ambiguous, or incomplete requirements and refine them through dialog before design work begins.

### Process

```
Step 1: Analyze Requirements
  ↓
  [Clarity Assessment]
  Each requirement scored 0-100 on clarity

Step 2: Identify Issues
  ↓
  - Ambiguous language (maybe, perhaps, possibly)
  - Incomplete lists (etc., and so on)
  - Vague terms (soon, quickly, complex)
  - Missing fields (no description, no acceptance criteria)
  - No metrics (NFRs without measurable targets)

Step 3: Create Dialog
  ↓
  [User Interaction]
  Questions formatted for easy understanding
  Prioritized by importance

Step 4: Process Answers
  ↓
  [Update Requirements]
  Answers incorporated into requirement details
  Ready for design validation
```

### Clarity Scoring

```
Requirement Clarity Score = 100 - Penalties

Penalties Applied:
  - Vague language (-20 points per occurrence)
  - Incomplete lists (-20 points)
  - No acceptance criteria (-25 points)
  - Missing description (-15 points)
  - No success metrics (-10 points)

Clarity Levels:
  ≥ 80    → CLEAR (no refinement needed)
  60-79   → NEEDS_REFINEMENT (minor clarifications)
  40-59   → UNCLEAR (significant issues)
  < 40    → AMBIGUOUS or INCOMPLETE
```

### Example: Clarity Analysis

```javascript
const analysis = identifyUnclearRequirements(requirements);
```

**Result:**
```javascript
{
  analyzed_at: "2024-01-15T11:00:00Z",
  requirements_count: 42,
  clarity_assessment: [
    {
      requirement_id: "PROJ-456",
      clarity_level: "NEEDS_REFINEMENT",
      clarity_score: 72,
      issues: [
        "Contains uncertain language: 'maybe', 'might'",
        "No specific acceptance criteria defined"
      ]
    }
  ],
  unclear_requirements: [
    {
      requirement: {...},
      reason: "Contains vague performance terms"
    }
  ],
  ambiguous_items: [
    {
      requirement: {...},
      issues: ["Incomplete list: 'and others'", "No success metrics"]
    }
  ],
  missing_details: [
    {
      requirement: {...},
      missing_fields: ["description", "acceptance_criteria"]
    }
  ],
  refinement_dialog_needed: true,
  total_unclear: 8,
  questions_to_ask: [...]
}
```

### Refinement Dialog Format

```javascript
const dialog = createRefinementDialog(analysis);
const formatted = formatRefinementDialogForUser(dialog);
```

**User sees:**
```
📋 Requirements Refinement Needed

Found 8 requirement(s) that need clarification

Status Overview:
- ✅ Clear: 34
- ⚠️  Needs Refinement: 8
- ❓ Ambiguous: 2
- 🔲 Incomplete: 4

Why This Matters:
Refining these requirements now will prevent misunderstandings and rework later

Benefits:
- Clearer acceptance criteria
- Better work estimates
- Reduced implementation surprises
- Faster code reviews

Please Answer These Questions:

1. For requirement: "System should perform well"
Can you clarify what you mean by "perform well"? What are the specific acceptance criteria?
*Context: Contains vague performance terms*

2. Requirement "Support multiple environments" has unclear elements: Incomplete list, No specific targets
Can you provide more specific details?

...
```

### Processing Refinement Answers

```javascript
const refined = refineRequirementsWithAnswers(
  analysis,
  requirements,
  {
    "Q-1": "Response time < 200ms at 95th percentile",
    "Q-2": "Production, Staging, Development, QA environments"
  }
);
```

**Result:**
```javascript
{
  ...original_requirements,
  refined_at: "2024-01-15T11:30:00Z",
  refinement: {
    answers_received: 8,
    total_questions: 8,
    changes: [
      {
        requirement_id: "PROJ-456",
        question_type: "clarification",
        original_text: "System should perform well",
        refinement: "Response time < 200ms at 95th percentile"
      }
    ],
    status: "completed",
    ready_for_planning: true
  }
}
```

---

## Phase 3: Design Validation

### Purpose
Validate refined requirements against Design & Implementation Standards to ensure compliance before implementation.

### Design Standards Reference
**[AI-Design and Implementation Rules - FLI - Core (FLICORE) - Confluence](https://confluence.build.ingka.ikea.com/spaces/FLICORE/pages/1338146844/AI-Design+and+Implementation+Rules)**

### Standards Sections

The standards document covers:

- **Design Principles**: Architecture, patterns, and design decisions
- **Coding Standards**: Language conventions, style guides, best practices
- **Testing Requirements**: Unit tests, integration tests, coverage targets
- **Security**: Authentication, authorization, data protection
- **Performance**: Response times, throughput, resource usage
- **Documentation**: Code comments, API docs, runbooks
- **Deployment**: Release process, configuration management
- **Monitoring**: Logging, metrics, alerting

### Validation Process

```javascript
const standards = await fetchDesignStandards(
  "https://confluence.build.ingka.ikea.com/spaces/FLICORE/pages/...",
  atlassianClient
);

const validation = validateRequirementsAgainstStandards(
  refined,
  standards
);
```

### Validation Report

```javascript
{
  validated_at: "2024-01-15T12:00:00Z",
  requirements_count: 42,
  standards_url: "...",
  validation_results: [
    {
      requirement: "API must support pagination",
      source: "PROJ-456",
      checks: [
        { rule: "API Standards", status: "required", severity: "high" },
        { rule: "Testing", status: "required", severity: "high" }
      ]
    }
  ],
  issues: [
    {
      type: "uncovered-nfr",
      requirement: "Must support 10,000 concurrent users",
      recommendation: "Add performance testing standards"
    }
  ],
  recommendations: [
    {
      type: "uncovered-nfr",
      action: "Add performance testing standards for scalability",
      priority: "high"
    }
  ],
  compliant: true
}
```

---

## Phase 4: Work Breakdown

### Purpose
Convert validated requirements into actionable work items (epics, stories, tasks) with clear structure and dependencies.

### Work Items Generated

```javascript
const workItems = createWorkBreakdown(
  refined,
  standards,
  validation
);
```

**Output structure:**

```javascript
{
  generated_at: "2024-01-15T12:30:00Z",
  epics: [
    {
      title: "Implementation of PROJ-123",
      description: "Complete implementation aligned with standards",
      key_requirements: [...],
      standards_applied: "..."
    }
  ],
  stories: [
    {
      id: "STORY-1",
      title: "User can login with credentials",
      description: "...",
      source_issue: "PROJ-456",
      priority: "High",
      acceptance_criteria: [...],
      validation_requirements: [...],
      effort_estimate: "Medium"
    }
  ],
  tasks: [
    {
      id: "STORY-1-DESIGN",
      type: "Design",
      title: "Design authentication flow",
      depends_on: []
    },
    {
      id: "STORY-1-IMPL",
      type: "Implementation",
      title: "Implement login endpoint",
      depends_on: ["STORY-1-DESIGN"]
    },
    {
      id: "STORY-1-REVIEW",
      type: "Review",
      title: "Code review for login endpoint",
      depends_on: ["STORY-1-IMPL"]
    },
    {
      id: "STORY-1-TEST",
      type: "Testing",
      title: "Test authentication flow",
      depends_on: ["STORY-1-REVIEW"]
    }
  ],
  testing_tasks: [
    {
      id: "TEST-UNIT",
      type: "Testing",
      title: "Unit testing",
      coverage_target: "80%"
    },
    {
      id: "TEST-SECURITY",
      type: "Testing",
      title: "Security testing",
      checklist: [...]
    }
  ],
  total_work_items: 87
}
```

### Task Types

| Type | Purpose | Depends On | Owner |
|------|---------|-----------|-------|
| Design | Create technical design | Requirements | design-agent |
| Implementation | Write code | Design | code-agent |
| Review | Peer code review | Implementation | code-agent |
| Testing | Execute tests | Review | test-agent |
| Compliance | Verify standards compliance | All | orchestrator-agent |

---

## Phase 5: Implementation Planning

### Purpose
Organize work into phases and create delegation instructions for implementation teams.

### Implementation Phases

```javascript
const plan = formatImplementationPlan(workItems);
```

**Phases:**

1. **Design & Planning** (1-2 weeks)
   - Design documents
   - Architecture diagrams
   - Standards alignment validation

2. **Implementation** (2-4 weeks)
   - Source code development
   - Unit tests
   - Code reviews

3. **Testing & Validation** (1-2 weeks)
   - Test reports
   - Coverage metrics
   - Performance results

4. **Compliance & Deployment** (1 week)
   - Compliance checklist review
   - Deployment guide
   - Release notes

### Delegation Instructions

```javascript
const delegations = prepareDelegationInstructions(workItems, standards);
```

**Each team receives:**

```javascript
{
  agent: "code-agent",
  phase: "Implementation",
  tasks: [...],
  code_standards: "...",
  testing_requirements: "...",
  deliverables: ["Source code", "Unit tests"],
  success_criteria: [
    "Code review approval",
    "Test coverage > 80%"
  ]
}
```

---

## Orchestration Flow

### Complete SDLM Workflow

```
1. USER: "Process epic PROJ-123"
   ↓
2. ORCHESTRATOR: Initiate SDLM workflow
   - Create workflow context
   - Set up 6 phases
   ↓
3. PHASE 1: Collect Requirements
   - Fetch Jira epic PROJ-123
   - Get 15 child issues
   - Extract 5 linked Confluence pages
   - Result: 42 aggregated requirements
   ↓
4. PHASE 2: Refine Requirements
   - Analyze clarity: 34 clear, 8 need refinement
   - Create dialog with 8 questions
   - DIALOG: → USER ANSWERS
   - Update requirements with answers
   - Result: 42 refined requirements
   ↓
5. PHASE 3: Validate Design
   - Fetch FLICORE standards
   - Validate all 42 requirements
   - Check compliance: 100% compliant
   - Generate recommendations
   ↓
6. PHASE 4: Break Down Work
   - Create 1 epic
   - Create 12 stories from functional requirements
   - Create 48 tasks (Design, Impl, Review, Test)
   - Create 6 testing tasks
   - Create 2 compliance tasks
   - Total: 69 work items
   ↓
7. PHASE 5: Plan Implementation
   - Phase 1 (Design): 10 tasks
   - Phase 2 (Implementation): 30 tasks
   - Phase 3 (Testing): 24 tasks
   - Phase 4 (Compliance): 5 tasks
   ↓
8. PHASE 6: Execute & Coordinate
   - Delegate Phase 1 → design-agent
   - Delegate Phase 2 → code-agent
   - Delegate Phase 3 → test-agent
   - Orchestrator monitors coordination
   ↓
9. COMPLETE: All phases executed, ready for deployment
```

---

## Example Workflows

### Example 1: Simple Feature (No Refinement Needed)

```
Epic: "Add user profile page"
├─ 3 child stories
├─ All requirements clear (80+ clarity score)
├─ No refinement dialog
├─ 8 work items created
└─ Ready for implementation
```

### Example 2: Complex Feature (Refinement Required)

```
Epic: "API redesign for performance"
├─ 8 child stories
├─ 6 requirements need clarification
│  ├─ Q1: "What's the performance target?" → "< 100ms P95"
│  ├─ Q2: "Which endpoints must support caching?" → "All GET endpoints"
│  └─ Q3: "What's the cache invalidation strategy?" → "TTL + manual invalidation"
├─ Refined requirements updated
├─ 32 work items created
├─ Full design validation passed
└─ Ready for implementation
```

### Example 3: Compliance-Heavy Project

```
Epic: "Data privacy compliance"
├─ 5 child stories
├─ 12 non-functional requirements (Security, Privacy, Audit)
├─ Design validation identifies 3 new compliance tasks
├─ Work breakdown includes:
│  ├─ Design: 8 tasks
│  ├─ Implementation: 16 tasks
│  ├─ Testing: 12 tasks (including security testing)
│  └─ Compliance: 5 tasks (GDPR, audit logging, etc.)
└─ Rigorous review process
```

---

## API Reference

### Core Functions

#### `initiateSdlmWorkflow(jiraEpicKey, options)`
Initiates SDLM workflow for an epic.

**Parameters:**
- `jiraEpicKey` (string): Jira epic key (e.g., "PROJ-123")
- `options` (object): Configuration options
  - `standards_url` (string): URL to design standards page

**Returns:** Workflow context with 6 phases initialized

#### `collectRequirements(jiraEpicKey, atlassianClient)`
Collects requirements from Jira and linked Confluence pages.

**Parameters:**
- `jiraEpicKey` (string): Epic key
- `atlassianClient` (object): Atlassian API client

**Returns:** Requirements object with 42+ fields

#### `identifyUnclearRequirements(requirements)`
Analyzes requirements for clarity issues.

**Parameters:**
- `requirements` (object): Requirements object

**Returns:** Clarity analysis with unclear items and refinement questions

#### `createRefinementDialog(clarityAnalysis)`
Creates dialog for unclear requirements.

**Parameters:**
- `clarityAnalysis` (object): Results from `identifyUnclearRequirements()`

**Returns:** Dialog object with questions, or null if all clear

#### `formatRefinementDialogForUser(dialog)`
Formats dialog as user-friendly markdown.

**Parameters:**
- `dialog` (object): Dialog object

**Returns:** Markdown string for user presentation

#### `refineRequirementsWithAnswers(clarityAnalysis, requirements, answers)`
Processes user answers and updates requirements.

**Parameters:**
- `clarityAnalysis` (object): Original analysis
- `requirements` (object): Original requirements
- `answers` (object): User answers keyed by question ID

**Returns:** Refined requirements with changes tracked

#### `fetchDesignStandards(confluencePageUrl, atlassianClient)`
Fetches and parses design standards.

**Parameters:**
- `confluencePageUrl` (string): Standards page URL
- `atlassianClient` (object): Atlassian API client

**Returns:** Standards document with validation rules

#### `validateRequirementsAgainstStandards(requirements, standards)`
Validates requirements compliance.

**Parameters:**
- `requirements` (object): Requirements
- `standards` (object): Standards document

**Returns:** Validation report with issues and recommendations

#### `createWorkBreakdown(requirements, standards, validation)`
Breaks down requirements into work items.

**Parameters:**
- `requirements` (object): Requirements
- `standards` (object): Standards
- `validation` (object): Validation results

**Returns:** Work items with epics, stories, and tasks

#### `formatImplementationPlan(workItems)`
Formats work items as implementation plan.

**Parameters:**
- `workItems` (object): Work items

**Returns:** Implementation plan organized by phases

#### `prepareDelegationInstructions(workItems, standards)`
Creates delegation instructions for teams.

**Parameters:**
- `workItems` (object): Work items
- `standards` (object): Standards

**Returns:** Array of delegation instructions per agent

---

## Best Practices

### Requirements Collection
1. ✅ **Include linked documentation**: Always check for Confluence links in Jira issues
2. ✅ **Capture all issue types**: Stories, tasks, sub-tasks, bugs
3. ✅ **Extract acceptance criteria**: Look for "AC:", "Given/When/Then" patterns
4. ✅ **Note constraints**: Collect platform, environment, or compliance constraints

### Requirements Refinement
1. ✅ **Ask before assuming**: Use refinement dialog for unclear terms
2. ✅ **Quantify NFRs**: Always ask for metrics (performance, load, etc.)
3. ✅ **Clarify ambiguous scope**: "All" vs. "Some" vs. "Subset"
4. ✅ **Get timeline**: When is this needed? By when should it be done?

### Design Validation
1. ✅ **Review standards thoroughly**: Don't skip compliance checks
2. ✅ **Document exceptions**: If violating a standard, document why and get approval
3. ✅ **Add new standards**: If needed standards don't exist, create them
4. ✅ **Security first**: Always include security validation

### Work Breakdown
1. ✅ **Stories before tasks**: Create user stories before breaking into tasks
2. ✅ **Identify dependencies**: Mark what depends on what
3. ✅ **Include testing tasks**: Testing is not an afterthought
4. ✅ **Add compliance tasks**: Include validation and compliance checks

### Implementation Planning
1. ✅ **Clear phases**: Design → Implementation → Testing → Deployment
2. ✅ **Explicit success criteria**: Each phase has clear deliverables
3. ✅ **Realistic timelines**: Estimate based on complexity
4. ✅ **Team assignments**: Know who does what

### Orchestration
1. ✅ **Validate at each phase**: Don't proceed to next phase if blocked
2. ✅ **Track progress**: Monitor what's done, what's pending
3. ✅ **Communicate changes**: If plans change, update all stakeholders
4. ✅ **Learn and improve**: Track actual vs. estimated, adjust for next project

---

This SDLM orchestration ensures that software development projects follow a structured, standards-aligned process from requirements through deployment, with emphasis on clarity, compliance, and team coordination.
