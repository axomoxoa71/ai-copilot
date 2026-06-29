/**
 * SDLM (Software Development Lifecycle Management) Orchestrator Module
 * 
 * Specialized orchestration for managing complete development lifecycle:
 * 1. Collect requirements from Jira and linked Confluence resources
 * 2. Validate against Design & Implementation Standards
 * 3. Break down into work items
 * 4. Delegate to implementation teams
 */

import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * SDLM Project Phases
 */
const SDLM_PHASES = {
  REQUIREMENTS_COLLECTION: "requirements-collection",
  REQUIREMENTS_REFINEMENT: "requirements-refinement",
  DESIGN_VALIDATION: "design-validation",
  WORK_BREAKDOWN: "work-breakdown",
  IMPLEMENTATION_PLANNING: "implementation-planning",
  IMPLEMENTATION: "implementation",
  VALIDATION: "validation",
  DEPLOYMENT: "deployment",
};

/**
 * Requirement clarity levels
 */
const CLARITY_LEVELS = {
  CLEAR: "clear",
  UNCLEAR: "unclear",
  AMBIGUOUS: "ambiguous",
  INCOMPLETE: "incomplete",
  NEEDS_REFINEMENT: "needs-refinement",
};

/**
 * SDLM workflow status
 */
const WORKFLOW_STATUS = {
  INITIATED: "initiated",
  IN_PROGRESS: "in-progress",
  BLOCKED: "blocked",
  COMPLETED: "completed",
  FAILED: "failed",
};

/**
 * Canonical orchestration graph steps.
 */
const GRAPH_STEPS = {
  REQUIREMENTS: "requirements",
  PLAN: "plan",
  CODE: "code",
  TESTS: "tests",
  RESULTS: "results",
};

const CONFLUENCE_CONTENT_MODES = {
  STATE: "state",
  FILE_REF: "file-ref",
  HYBRID: "hybrid",
};

/**
 * Creates canonical graph state used by orchestrator coordination.
 * Mirrors the requested structure:
 * {
 *   requirements: string,
 *   plan: string,
 *   code: string,
 *   tests: string,
 *   results: string,
 *   current_step: string
 * }
 * @returns {object} Graph state
 */
function createInitialGraphState() {
  return {
    requirements: "",
    plan: "",
    code: "",
    tests: "",
    results: "",
    current_step: GRAPH_STEPS.REQUIREMENTS,
  };
}

/**
 * Initiates SDLM workflow for an Epic or Feature
 * @param {string} jiraEpicKey - Jira epic key (e.g., "PROJ-123")
 * @param {object} options - Configuration options
 * @returns {object} SDLM workflow context
 */
export async function initiateSdlmWorkflow(jiraEpicKey, options = {}) {
  const workflow = {
    workflow_id: generateWorkflowId(),
    jira_epic_key: jiraEpicKey,
    initiated_at: new Date().toISOString(),
    graph_state: createInitialGraphState(),
    phases: [],
    requirements: null,
    refined_requirements: null,
    design_validation: null,
    work_items: [],
    standards_reference: options.standards_url || null,
    status: WORKFLOW_STATUS.INITIATED,
  };

  // Phase 1: Requirements Collection
  workflow.phases.push({
    phase: SDLM_PHASES.REQUIREMENTS_COLLECTION,
    status: WORKFLOW_STATUS.INITIATED,
    description: "Collect and aggregate requirements from Jira and Confluence",
  });

  // Phase 2: Requirements Refinement
  workflow.phases.push({
    phase: SDLM_PHASES.REQUIREMENTS_REFINEMENT,
    status: WORKFLOW_STATUS.INITIATED,
    description: "Identify unclear requirements and refine through dialog",
  });

  // Phase 3: Design Validation
  workflow.phases.push({
    phase: SDLM_PHASES.DESIGN_VALIDATION,
    status: WORKFLOW_STATUS.INITIATED,
    description: "Validate requirements against design standards",
  });

  return workflow;
}

/**
 * Generates unique workflow ID
 * @returns {string} Workflow ID
 */
function generateWorkflowId() {
  return `sdlm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Collects requirements from Jira epic and linked Confluence pages
 * @param {string} jiraEpicKey - Epic key
 * @param {object} atlassianClient - Atlassian API client
 * @returns {object} Aggregated requirements
 */
export async function collectRequirements(jiraEpicKey, atlassianClient, options = {}) {
  const confluenceMode = normalizeConfluenceStorageMode(options.confluence_content_mode);
  const confluenceStorageDir = options.confluence_storage_dir || ".sdlm/confluence";

  const requirements = {
    epic_key: jiraEpicKey,
    collected_at: new Date().toISOString(),
    graph_state: {
      requirements: "collecting",
      plan: "",
      code: "",
      tests: "",
      results: "",
      current_step: GRAPH_STEPS.REQUIREMENTS,
    },
    sources: [],
    hierarchy: {
      epic: {
        key: jiraEpicKey,
        title: "",
        description: "",
        confluence_links: [],
      },
      tickets: [],
    },
    aggregated_requirements: [],
    functional_requirements: [],
    non_functional_requirements: [],
    constraints: [],
    acceptance_criteria: [],
    issues: [],
    linked_pages: [],
    confluence_content: {
      mode: confluenceMode,
      storage_dir: confluenceStorageDir,
      stored_files: [],
    },
  };

  try {
    // Step 1: Fetch epic details from Jira
    const epicData = await atlassianClient.getEpic(jiraEpicKey);
    requirements.epic = epicData;
    requirements.hierarchy.epic.title = epicData.fields?.summary || "";
    requirements.hierarchy.epic.description = epicData.fields?.description || "";
    requirements.sources.push({
      type: "jira-epic",
      key: jiraEpicKey,
      title: epicData.fields.summary,
    });

    const epicConfluenceLinks = extractConfluenceLinksFromIssue(epicData);
    requirements.hierarchy.epic.confluence_links = epicConfluenceLinks;
    requirements.linked_pages.push(...epicConfluenceLinks.map((link) => ({
      title: link.title,
      url: link.url,
      type: "confluence",
      linked_from: jiraEpicKey,
    })));

    // Step 2: Get all child issues
    const childIssues = await atlassianClient.getEpicChildIssues(jiraEpicKey);
    requirements.issues = childIssues;

    // Build canonical requirements hierarchy: epic -> tickets -> sub_tasks
    requirements.hierarchy.tickets = buildRequirementsHierarchy(childIssues);

    // Step 3: Extract requirements from issue descriptions and linked pages
    for (const issue of childIssues) {
      extractIssueRequirements(issue, requirements);

      // Keep linked pages in global list while preserving per-ticket confluence_links in hierarchy.
      const issueConfluenceLinks = extractConfluenceLinksFromIssue(issue);
      requirements.linked_pages.push(...issueConfluenceLinks.map((link) => ({
        title: link.title,
        url: link.url,
        type: "confluence",
        linked_from: issue.key,
      })));
    }

    requirements.linked_pages = dedupeLinksByUrl(requirements.linked_pages);

    // Step 4: Fetch linked Confluence pages
    if (requirements.linked_pages.length > 0) {
      for (const page of requirements.linked_pages) {
        try {
          const pageContent = await atlassianClient.getConfluencePage(page.url);
          const normalizedContent = normalizeConfluencePageContent(pageContent, page.url, page.title);
          const persisted = await persistConfluenceContent(normalizedContent, {
            mode: confluenceMode,
            storageDir: confluenceStorageDir,
            epicKey: jiraEpicKey,
          });

          page.content = persisted.state_content;
          page.storage = persisted.storage;
          page.summary = persisted.summary;

          if (persisted.storage?.path) {
            requirements.confluence_content.stored_files.push(persisted.storage.path);
          }

          extractPageRequirements(
            {
              ...pageContent,
              body: {
                plain_text: normalizedContent.text,
              },
            },
            requirements
          );
        } catch (err) {
          requirements.linked_pages[requirements.linked_pages.indexOf(page)].error =
            err.message;
        }
      }
    }

    requirements.status = "completed";
    requirements.graph_state.requirements = JSON.stringify(
      {
        epic_key: requirements.epic_key,
        hierarchy: requirements.hierarchy,
        totals: {
          tickets: requirements.hierarchy.tickets.length,
          requirements: requirements.aggregated_requirements.length,
          confluence_links: requirements.linked_pages.length,
        },
        confluence_content: {
          mode: requirements.confluence_content.mode,
          stored_files_count: requirements.confluence_content.stored_files.length,
        },
      },
      null,
      2
    );
    requirements.graph_state.current_step = GRAPH_STEPS.PLAN;
    requirements.total_issues = childIssues.length;
    requirements.total_requirements = requirements.aggregated_requirements.length;

    return requirements;
  } catch (error) {
    requirements.status = "failed";
    requirements.graph_state.requirements = "failed";
    requirements.graph_state.results = JSON.stringify({ error: error.message });
    requirements.graph_state.current_step = GRAPH_STEPS.RESULTS;
    requirements.error = error.message;
    return requirements;
  }
}

function normalizeConfluenceStorageMode(mode) {
  if (mode === CONFLUENCE_CONTENT_MODES.STATE) {
    return CONFLUENCE_CONTENT_MODES.STATE;
  }
  if (mode === CONFLUENCE_CONTENT_MODES.FILE_REF) {
    return CONFLUENCE_CONTENT_MODES.FILE_REF;
  }
  return CONFLUENCE_CONTENT_MODES.HYBRID;
}

function normalizeConfluencePageContent(pageContent, fallbackUrl, fallbackTitle) {
  const title = pageContent?.title || fallbackTitle || "Confluence page";
  const url = pageContent?.url || fallbackUrl;
  const body = pageContent?.body || {};

  const plain =
    typeof body.plain_text === "string"
      ? body.plain_text
      : typeof body.view === "string"
        ? body.view
        : JSON.stringify(body.view || body.storage || "", null, 2);

  const text = (plain || "").trim();
  const contentHash = crypto.createHash("sha256").update(text).digest("hex");

  return {
    title,
    url,
    text,
    content_hash: contentHash,
  };
}

async function persistConfluenceContent(content, options) {
  const { mode, storageDir, epicKey } = options;
  const summary = {
    title: content.title,
    url: content.url,
    content_hash: content.content_hash,
    excerpt: content.text.substring(0, 400),
    total_characters: content.text.length,
  };

  if (mode === CONFLUENCE_CONTENT_MODES.STATE) {
    return {
      summary,
      storage: { mode: CONFLUENCE_CONTENT_MODES.STATE, path: null },
      state_content: {
        ...summary,
        text: content.text,
      },
    };
  }

  const safeEpic = (epicKey || "epic").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTitle = (content.title || "confluence")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const fileName = `${safeEpic}_${safeTitle || "page"}_${content.content_hash.slice(0, 12)}.json`;
  const absoluteDir = path.resolve(process.cwd(), storageDir);
  const absolutePath = path.join(absoluteDir, fileName);
  const relativePath = path.join(storageDir, fileName).replaceAll("\\", "/");

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(
    absolutePath,
    JSON.stringify(
      {
        captured_at: new Date().toISOString(),
        title: content.title,
        url: content.url,
        content_hash: content.content_hash,
        text: content.text,
      },
      null,
      2
    ),
    "utf8"
  );

  if (mode === CONFLUENCE_CONTENT_MODES.FILE_REF) {
    return {
      summary,
      storage: { mode: CONFLUENCE_CONTENT_MODES.FILE_REF, path: relativePath },
      state_content: null,
    };
  }

  return {
    summary,
    storage: { mode: CONFLUENCE_CONTENT_MODES.HYBRID, path: relativePath },
    state_content: {
      ...summary,
      text: content.text.substring(0, 1200),
    },
  };
}

/**
 * Builds structured requirement hierarchy with dedicated confluence link arrays.
 * @param {array} issues - Jira issues from epic
 * @returns {array} Hierarchical tickets
 */
function buildRequirementsHierarchy(issues) {
  const ticketsByKey = new Map();

  // First pass: create ticket entries.
  issues.forEach((issue) => {
    ticketsByKey.set(issue.key, {
      ticket_key: issue.key,
      ticket_type: issue.fields?.issuetype?.name || "Task",
      title: issue.fields?.summary || "",
      description: issue.fields?.description || "",
      status: issue.fields?.status?.name || "Unknown",
      priority: issue.fields?.priority?.name || "Medium",
      confluence_links: extractConfluenceLinksFromIssue(issue),
      sub_tasks: [],
    });
  });

  const topLevel = [];

  // Second pass: attach subtasks to parent when possible.
  issues.forEach((issue) => {
    const current = ticketsByKey.get(issue.key);
    const parentKey = issue.fields?.parent?.key || null;

    if (parentKey && ticketsByKey.has(parentKey)) {
      ticketsByKey.get(parentKey).sub_tasks.push(current);
      return;
    }

    topLevel.push(current);
  });

  return topLevel;
}

/**
 * Extracts confluence links from Jira issue link structures.
 * @param {object} issue - Jira issue
 * @returns {array} Confluence links array
 */
function extractConfluenceLinksFromIssue(issue) {
  const links = [];
  const fields = issue?.fields || {};

  const candidates = [];

  if (Array.isArray(fields.links)) {
    candidates.push(...fields.links);
  }
  if (Array.isArray(fields.issuelinks)) {
    candidates.push(...fields.issuelinks);
  }
  if (Array.isArray(fields.remotelink)) {
    candidates.push(...fields.remotelink);
  }

  candidates.forEach((link) => {
    const objectUrl = link?.object?.url;
    const objectTitle = link?.object?.title;
    if (typeof objectUrl === "string" && objectUrl.toLowerCase().includes("confluence")) {
      links.push({
        url: objectUrl,
        title: objectTitle || "Confluence page",
      });
    }
  });

  return dedupeLinksByUrl(links);
}

/**
 * De-duplicates links by URL while preserving first occurrence.
 * @param {array} links - Links with url fields
 * @returns {array} De-duplicated links
 */
function dedupeLinksByUrl(links) {
  const seen = new Set();
  const result = [];

  links.forEach((link) => {
    if (!link?.url || seen.has(link.url)) {
      return;
    }
    seen.add(link.url);
    result.push(link);
  });

  return result;
}

/**
 * Extracts requirements from a Jira issue
 * @param {object} issue - Jira issue
 * @param {object} requirements - Requirements object to populate
 */
function extractIssueRequirements(issue, requirements) {
  const description = issue.fields.description || "";
  const summary = issue.fields.summary || "";

  // Parse requirement indicators
  if (description.toLowerCase().includes("must") || summary.toLowerCase().includes("shall")) {
    requirements.functional_requirements.push({
      source: issue.key,
      text: `${summary}: ${description.substring(0, 200)}...`,
      priority: issue.fields.priority?.name || "Medium",
      type: "functional",
    });
  }

  if (description.toLowerCase().includes("performance") ||
      description.toLowerCase().includes("scalability") ||
      description.toLowerCase().includes("security")) {
    requirements.non_functional_requirements.push({
      source: issue.key,
      text: description.substring(0, 200),
      category: extractNfrCategory(description),
    });
  }

  if (description.toLowerCase().includes("constraint") ||
      description.toLowerCase().includes("limitation")) {
    requirements.constraints.push({
      source: issue.key,
      text: description.substring(0, 200),
    });
  }

  // Extract acceptance criteria
  const acMatch = description.match(/acceptance criteria:?([\s\S]*?)(?:notes:|$)/i);
  if (acMatch) {
    requirements.acceptance_criteria.push({
      source: issue.key,
      criteria: acMatch[1].trim(),
    });
  }

  // Add all as aggregated requirements
  requirements.aggregated_requirements.push({
    source: issue.key,
    type: issue.fields.issuetype.name,
    summary,
    description,
    status: issue.fields.status.name,
  });
}

/**
 * Extracts requirements from Confluence page content
 * @param {object} pageContent - Confluence page data
 * @param {object} requirements - Requirements object to populate
 */
function extractPageRequirements(pageContent, requirements) {
  const text = pageContent.body?.plain_text || pageContent.body?.view || "";

  // Look for standard sections
  if (text.includes("Design Standards") || text.includes("Implementation Rules")) {
    requirements.design_standards_found = true;
    requirements.design_standards_url = pageContent.url;
  }

  // Extract key sections
  const sections = {
    "Functional Requirements": [],
    "Non-Functional Requirements": [],
    "Security Requirements": [],
    "Performance Requirements": [],
    "Constraints": [],
    "Acceptance Criteria": [],
  };

  Object.keys(sections).forEach((section) => {
    const regex = new RegExp(`${section}[:\\s]*([\s\S]*?)(?=\\n#+|$)`, "i");
    const match = text.match(regex);
    if (match) {
      sections[section] = match[1].trim().split("\n").filter((line) => line.trim());
    }
  });

  // Populate requirements
  if (sections["Functional Requirements"].length > 0) {
    sections["Functional Requirements"].forEach((req) => {
      requirements.functional_requirements.push({
        source: pageContent.url,
        text: req,
        type: "functional",
      });
    });
  }

  if (sections["Non-Functional Requirements"].length > 0) {
    sections["Non-Functional Requirements"].forEach((req) => {
      requirements.non_functional_requirements.push({
        source: pageContent.url,
        text: req,
      });
    });
  }

  if (sections["Security Requirements"].length > 0) {
    sections["Security Requirements"].forEach((req) => {
      requirements.non_functional_requirements.push({
        source: pageContent.url,
        text: req,
        category: "Security",
      });
    });
  }

  if (sections["Constraints"].length > 0) {
    sections["Constraints"].forEach((constraint) => {
      requirements.constraints.push({
        source: pageContent.url,
        text: constraint,
      });
    });
  }
}

/**
 * Extracts NFR category
 * @param {string} text - Text to analyze
 * @returns {string} NFR category
 */
function extractNfrCategory(text) {
  const textLower = text.toLowerCase();

  if (textLower.includes("performance") || textLower.includes("latency")) return "Performance";
  if (textLower.includes("security") || textLower.includes("encryption")) return "Security";
  if (textLower.includes("scalability") || textLower.includes("load")) return "Scalability";
  if (textLower.includes("availability") || textLower.includes("uptime")) return "Availability";
  if (textLower.includes("usability") || textLower.includes("ux")) return "Usability";
  if (textLower.includes("maintainability") || textLower.includes("code quality"))
    return "Maintainability";

  return "General";
}

/**
 * Analyzes requirements and identifies those that need refinement
 * @param {object} requirements - Collected requirements
 * @returns {object} Refinement analysis
 */
export function identifyUnclearRequirements(requirements) {
  const analysis = {
    analyzed_at: new Date().toISOString(),
    requirements_count: requirements.aggregated_requirements.length,
    clarity_assessment: [],
    unclear_requirements: [],
    ambiguous_items: [],
    missing_details: [],
    refinement_dialog_needed: false,
    questions_to_ask: [],
  };

  // Assess each requirement for clarity
  requirements.aggregated_requirements.forEach((req) => {
    const assessment = assessRequirementClarity(req);
    analysis.clarity_assessment.push(assessment);

    if (assessment.clarity_level !== CLARITY_LEVELS.CLEAR) {
      if (assessment.clarity_level === CLARITY_LEVELS.AMBIGUOUS) {
        analysis.ambiguous_items.push({
          requirement: req,
          issues: assessment.issues,
        });
      } else if (assessment.clarity_level === CLARITY_LEVELS.INCOMPLETE) {
        analysis.missing_details.push({
          requirement: req,
          missing_fields: assessment.missing_fields,
        });
      } else {
        analysis.unclear_requirements.push({
          requirement: req,
          reason: assessment.reason,
          score: assessment.clarity_score,
        });
      }
    }
  });

  // Assess non-functional requirements
  requirements.non_functional_requirements.forEach((nfr) => {
    const assessment = assessNfrClarity(nfr);
    if (assessment.needs_clarification) {
      analysis.unclear_requirements.push({
        requirement: nfr,
        reason: "Non-functional requirement lacks specific metrics",
        type: "nfr",
      });
    }
  });

  // Generate questions for unclear requirements
  analysis.questions_to_ask = generateRefinementQuestions(
    analysis.unclear_requirements,
    analysis.ambiguous_items,
    analysis.missing_details
  );

  analysis.refinement_dialog_needed = analysis.questions_to_ask.length > 0;
  analysis.total_unclear = analysis.unclear_requirements.length +
    analysis.ambiguous_items.length +
    analysis.missing_details.length;

  return analysis;
}

/**
 * Assesses clarity of a single requirement
 * @param {object} requirement - Requirement to assess
 * @returns {object} Clarity assessment
 */
function assessRequirementClarity(requirement) {
  const assessment = {
    requirement_id: requirement.source,
    text: requirement.description || requirement.summary,
    clarity_level: CLARITY_LEVELS.CLEAR,
    clarity_score: 100,
    issues: [],
    missing_fields: [],
  };

  const text = (requirement.description || requirement.summary || "").toLowerCase();

  // Check for clarity indicators
  const unclearPatterns = [
    { pattern: /\b(maybe|perhaps|might|could|possibly|seems)\b/gi, issue: "Contains uncertain language" },
    { pattern: /\b(etc\.|and so on|and others)\b/gi, issue: "Incomplete list (uses 'etc.' or similar)" },
    { pattern: /\b(soon|quickly|fast|slow|complex)\b/gi, issue: "Contains vague time/complexity terms" },
    { pattern: /\btbd\b/gi, issue: "Contains TBD (To Be Determined)" },
    { pattern: /\btk\b/gi, issue: "Contains TK (To Come)" },
  ];

  unclearPatterns.forEach((item) => {
    if (item.pattern.test(text)) {
      assessment.issues.push(item.issue);
      assessment.clarity_score -= 20;
    }
  });

  // Check for missing critical fields
  const requiredFields = ["summary", "description"];
  requiredFields.forEach((field) => {
    if (!requirement[field] || requirement[field].trim().length < 20) {
      assessment.missing_fields.push(field);
      assessment.clarity_score -= 15;
    }
  });

  // Check for acceptance criteria
  if (!requirement.acceptance_criteria || requirement.acceptance_criteria.length === 0) {
    assessment.issues.push("No acceptance criteria defined");
    assessment.clarity_score -= 25;
  }

  // Check for success metrics
  if (text.length < 50) {
    assessment.issues.push("Description too short, may lack detail");
    assessment.clarity_score -= 10;
  }

  // Determine clarity level
  if (assessment.clarity_score >= 80) {
    assessment.clarity_level = CLARITY_LEVELS.CLEAR;
  } else if (assessment.clarity_score >= 60) {
    assessment.clarity_level = CLARITY_LEVELS.NEEDS_REFINEMENT;
  } else if (assessment.clarity_score >= 40) {
    assessment.clarity_level = CLARITY_LEVELS.UNCLEAR;
  } else {
    assessment.clarity_level = assessment.issues.length > 2 ? CLARITY_LEVELS.AMBIGUOUS : CLARITY_LEVELS.INCOMPLETE;
  }

  return assessment;
}

/**
 * Assesses clarity of non-functional requirements
 * @param {object} nfr - Non-functional requirement
 * @returns {object} NFR clarity assessment
 */
function assessNfrClarity(nfr) {
  const assessment = {
    text: nfr.text,
    category: nfr.category,
    has_metrics: false,
    has_targets: false,
    needs_clarification: false,
    issues: [],
  };

  const textLower = nfr.text.toLowerCase();

  // Look for specific metrics/targets
  const numberPattern = /\b\d+(\.\d+)?([%ms|seconds|minutes|days|threads|concurrent|requests|users])/gi;
  if (numberPattern.test(textLower)) {
    assessment.has_metrics = true;
  } else {
    assessment.issues.push("No specific metrics defined");
    assessment.needs_clarification = true;
  }

  // Check for clear targets
  const targetKeywords = ["must", "should", "shall", "at least", "minimum", "maximum", "target"];
  if (targetKeywords.some((kw) => textLower.includes(kw))) {
    assessment.has_targets = true;
  } else {
    assessment.issues.push("No clear performance targets");
    assessment.needs_clarification = true;
  }

  // Check for testing criteria
  if (!textLower.includes("test") && !textLower.includes("measure") && !textLower.includes("validate")) {
    assessment.issues.push("No clear validation/testing criteria");
    assessment.needs_clarification = true;
  }

  return assessment;
}

/**
 * Generates refinement questions for unclear requirements
 * @param {array} unclearRequirements - Unclear requirements
 * @param {array} ambiguousItems - Ambiguous items
 * @param {array} missingDetails - Items with missing details
 * @returns {array} Refinement questions
 */
function generateRefinementQuestions(unclearRequirements, ambiguousItems, missingDetails) {
  const questions = [];
  const seen = new Set();

  // Questions for unclear requirements
  unclearRequirements.forEach((item) => {
    const req = item.requirement;
    const key = `${req.source}-unclear`;

    if (!seen.has(key)) {
      questions.push({
        id: `Q-${questions.length + 1}`,
        type: "clarification",
        requirement_source: req.source,
        question: `For requirement: "${(req.text || req.summary || "").substring(0, 80)}"
Can you clarify what you mean by "${item.reason || "this requirement"}"? What are the specific acceptance criteria?`,
        priority: "high",
        context: item.reason,
        required: true,
      });
      seen.add(key);
    }
  });

  // Questions for ambiguous items
  ambiguousItems.forEach((item) => {
    const req = item.requirement;
    const key = `${req.source}-ambiguous`;

    if (!seen.has(key) && item.issues.length > 0) {
      questions.push({
        id: `Q-${questions.length + 1}`,
        type: "ambiguity",
        requirement_source: req.source,
        question: `Requirement "${(req.summary || "").substring(0, 60)}" has unclear elements: ${item.issues.join(", ")}. 
Can you provide more specific details?`,
        priority: "high",
        context: item.issues,
        required: true,
      });
      seen.add(key);
    }
  });

  // Questions for missing details
  missingDetails.forEach((item) => {
    const req = item.requirement;
    const key = `${req.source}-missing`;

    if (!seen.has(key) && item.missing_fields.length > 0) {
      questions.push({
        id: `Q-${questions.length + 1}`,
        type: "missing-details",
        requirement_source: req.source,
        question: `Requirement "${(req.summary || "").substring(0, 60)}" is incomplete. 
Please provide: ${item.missing_fields.join(", ")}`,
        priority: "high",
        context: `Missing: ${item.missing_fields.join(", ")}`,
        required: true,
      });
      seen.add(key);
    }
  });

  return questions;
}

/**
 * Creates a refinement dialog from clarity analysis
 * @param {object} clarityAnalysis - Results from identifyUnclearRequirements()
 * @returns {object} Refinement dialog for user
 */
export function createRefinementDialog(clarityAnalysis) {
  if (!clarityAnalysis.refinement_dialog_needed) {
    return null;
  }

  const dialog = {
    dialog_id: `refinement-${Date.now()}`,
    created_at: new Date().toISOString(),
    title: "Requirements Refinement Needed",
    summary: `Found ${clarityAnalysis.total_unclear} requirement(s) that need clarification`,
    stats: {
      total_requirements: clarityAnalysis.requirements_count,
      unclear: clarityAnalysis.unclear_requirements.length,
      ambiguous: clarityAnalysis.ambiguous_items.length,
      incomplete: clarityAnalysis.missing_details.length,
      clear: clarityAnalysis.requirements_count - clarityAnalysis.total_unclear,
    },
    questions: clarityAnalysis.questions_to_ask,
    impact: {
      message: "Refining these requirements now will prevent misunderstandings and rework later",
      benefits: [
        "Clearer acceptance criteria",
        "Better work estimates",
        "Reduced implementation surprises",
        "Faster code reviews",
      ],
    },
    user_instructions: "Please answer each question to clarify the requirements. Your answers will be used to refine the work breakdown structure.",
  };

  return dialog;
}

/**
 * Formats refinement dialog for user presentation
 * @param {object} dialog - Refinement dialog
 * @returns {string} Formatted markdown
 */
export function formatRefinementDialogForUser(dialog) {
  if (!dialog) {
    return null;
  }

  let output = `📋 **${dialog.title}**\n\n`;
  output += `${dialog.summary}\n\n`;

  // Statistics
  output += `**Status Overview:**\n`;
  output += `- ✅ Clear: ${dialog.stats.clear}\n`;
  output += `- ⚠️  Needs Refinement: ${dialog.stats.unclear}\n`;
  output += `- ❓ Ambiguous: ${dialog.stats.ambiguous}\n`;
  output += `- 🔲 Incomplete: ${dialog.stats.incomplete}\n\n`;

  // Impact
  output += `**Why This Matters:**\n`;
  output += `${dialog.impact.message}\n`;
  dialog.impact.benefits.forEach((benefit) => {
    output += `- ${benefit}\n`;
  });
  output += "\n";

  // Questions
  output += `**Please Answer These Questions:**\n\n`;
  dialog.questions.forEach((q, index) => {
    output += `**${index + 1}. ${q.question}**\n`;
    if (q.context) {
      output += `*Context: ${q.context}*\n`;
    }
    output += "\n";
  });

  output += dialog.user_instructions + "\n";

  return output;
}

/**
 * Processes refinement answers and updates requirements
 * @param {object} clarityAnalysis - Original clarity analysis
 * @param {object} requirements - Original requirements
 * @param {object} answers - User answers keyed by question ID
 * @returns {object} Refined requirements
 */
export function refineRequirementsWithAnswers(clarityAnalysis, requirements, answers) {
  const refined = JSON.parse(JSON.stringify(requirements)); // Deep copy
  refined.refinement = {
    refined_at: new Date().toISOString(),
    answers_received: Object.keys(answers).length,
    total_questions: clarityAnalysis.questions_to_ask.length,
    changes: [],
  };

  // Process each answer
  clarityAnalysis.questions_to_ask.forEach((question) => {
    const answer = answers[question.id];

    if (answer) {
      // Find and update the related requirement
      const sourceKey = question.requirement_source;
      let updated = false;

      // Update in aggregated requirements
      refined.aggregated_requirements = refined.aggregated_requirements.map((req) => {
        if (req.source === sourceKey) {
          const change = {
            requirement_id: sourceKey,
            question_type: question.type,
            original_text: req.description,
            refinement: answer,
          };

          // Enhance description with refinement
          req.description = `${req.description}\n\n[REFINED] ${answer}`;
          req.refined = true;
          req.refinement_answer = answer;

          refined.refinement.changes.push(change);
          updated = true;
        }
        return req;
      });

      // Update in specific requirement lists
      if (question.type === "unclear" || question.type === "ambiguity") {
        refined.functional_requirements = refined.functional_requirements.map((req) => {
          if (req.source === sourceKey) {
            req.text = `${req.text} [REFINED: ${answer}]`;
            req.refined = true;
          }
          return req;
        });
      }

      refined.refinement.changes_count = refined.refinement.changes.length;
    }
  });

  refined.refinement.status = "completed";
  refined.refinement.ready_for_planning = refined.refinement.changes.length > 0;

  return refined;
}

/**
 * Validates refinement is complete
 * @param {object} dialog - Refinement dialog
 * @param {object} answers - User answers
 * @returns {object} Validation result
 */
export function validateRefinementCompletion(dialog, answers) {
  const validation = {
    total_questions: dialog.questions.length,
    answered_questions: Object.keys(answers).length,
    unanswered: [],
    is_complete: false,
    quality_score: 0,
  };

  dialog.questions.forEach((question) => {
    if (!answers[question.id]) {
      if (question.required) {
        validation.unanswered.push(question);
      }
    } else {
      // Score based on answer quality (simple heuristic)
      const answerLength = answers[question.id].length;
      if (answerLength > 100) {
        validation.quality_score += 2;
      } else if (answerLength > 50) {
        validation.quality_score += 1;
      }
    }
  });

  validation.is_complete = validation.unanswered.length === 0;
  validation.quality_score = Math.min(100, Math.round((validation.quality_score / dialog.questions.length) * 100));

  return validation;
}

/**
 * Fetches and validates Design & Implementation Standards
 * @param {string} confluencePageUrl - URL to standards page
 * @param {object} atlassianClient - Atlassian API client
 * @returns {object} Standards document with validation rules
 */
export async function fetchDesignStandards(confluencePageUrl, atlassianClient) {
  const standards = {
    page_url: confluencePageUrl,
    fetched_at: new Date().toISOString(),
    sections: {},
    validation_rules: [],
    design_patterns: [],
    code_standards: [],
    testing_requirements: [],
    documentation_requirements: [],
    security_checklist: [],
    performance_targets: [],
  };

  try {
    const pageContent = await atlassianClient.getConfluencePage(confluencePageUrl);
    const text = pageContent.body?.plain_text || pageContent.body?.view || "";

    // Extract major sections
    standards.sections = {
      design_principles: extractSection(text, "Design Principles"),
      coding_standards: extractSection(text, "Coding Standards"),
      testing_requirements: extractSection(text, "Testing Requirements"),
      security: extractSection(text, "Security"),
      performance: extractSection(text, "Performance"),
      documentation: extractSection(text, "Documentation"),
      deployment: extractSection(text, "Deployment"),
      monitoring: extractSection(text, "Monitoring"),
    };

    // Create validation rules
    standards.validation_rules = createValidationRules(standards.sections);

    // Extract checklists
    standards.security_checklist = extractChecklist(text, "Security Checklist");
    standards.code_standards = extractStandardsList(text, "Code Standards");
    standards.testing_requirements = extractStandardsList(text, "Testing Requirements");

    standards.status = "loaded";
    return standards;
  } catch (error) {
    standards.status = "failed";
    standards.error = error.message;
    return standards;
  }
}

/**
 * Extracts a section from text
 * @param {string} text - Full text
 * @param {string} sectionName - Section to extract
 * @returns {string} Section content
 */
function extractSection(text, sectionName) {
  const regex = new RegExp(`${sectionName}[:\s]*([\s\S]*?)(?=\\n#+|$)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extracts checklist items
 * @param {string} text - Full text
 * @param {string} checklistName - Checklist name
 * @returns {array} Checklist items
 */
function extractChecklist(text, checklistName) {
  const regex = new RegExp(`${checklistName}[:\s]*([\s\S]*?)(?=\\n#+|$)`, "i");
  const match = text.match(regex);

  if (!match) return [];

  return match[1]
    .split("\n")
    .filter((line) => line.includes("☐") || line.includes("□") || line.includes("- "))
    .map((line) => ({
      item: line.replace(/[☐□-]/g, "").trim(),
      required: true,
    }));
}

/**
 * Extracts list of standards
 * @param {string} text - Full text
 * @param {string} listName - List name
 * @returns {array} Standards/requirements
 */
function extractStandardsList(text, listName) {
  const section = extractSection(text, listName);
  if (!section) return [];

  return section
    .split("\n")
    .filter((line) => line.trim().startsWith("-") || line.trim().match(/^\d+\./))
    .map((line) => line.replace(/^[-•\d.]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * Creates validation rules from standards
 * @param {object} sections - Extracted sections
 * @returns {array} Validation rules
 */
function createValidationRules(sections) {
  const rules = [];

  if (sections.coding_standards) {
    rules.push({
      category: "Code Quality",
      rules: [
        "Follow language style guide",
        "Maintain code coverage > 80%",
        "Use linting tools",
        "Document complex functions",
      ],
      severity: "high",
    });
  }

  if (sections.testing_requirements) {
    rules.push({
      category: "Testing",
      rules: [
        "Unit tests for all functions",
        "Integration tests for workflows",
        "E2E tests for user journeys",
        "Performance tests for critical paths",
      ],
      severity: "high",
    });
  }

  if (sections.security) {
    rules.push({
      category: "Security",
      rules: [
        "No hardcoded secrets",
        "Input validation on all entries",
        "Authorization checks",
        "Encryption for sensitive data",
      ],
      severity: "critical",
    });
  }

  if (sections.performance) {
    rules.push({
      category: "Performance",
      rules: [
        "Response time < defined threshold",
        "Memory usage within limits",
        "Database queries optimized",
        "Caching implemented where applicable",
      ],
      severity: "medium",
    });
  }

  return rules;
}

/**
 * Validates requirements against design standards
 * @param {object} requirements - Collected requirements
 * @param {object} standards - Design standards
 * @returns {object} Validation report
 */
export function validateRequirementsAgainstStandards(requirements, standards) {
  const validation = {
    validated_at: new Date().toISOString(),
    requirements_count: requirements.aggregated_requirements.length,
    standards_url: standards.page_url,
    validation_results: [],
    issues: [],
    recommendations: [],
    compliant: true,
  };

  // Validate functional requirements
  requirements.functional_requirements.forEach((req) => {
    const result = {
      requirement: req.text.substring(0, 100),
      source: req.source,
      checks: [],
    };

    // Check against standards rules
    standards.validation_rules.forEach((rule) => {
      if (requirementNeedsRule(req, rule)) {
        result.checks.push({
          rule: rule.category,
          status: "required",
          severity: rule.severity,
        });
      }
    });

    validation.validation_results.push(result);
  });

  // Validate non-functional requirements
  requirements.non_functional_requirements.forEach((req) => {
    const result = {
      requirement: req.text.substring(0, 100),
      category: req.category,
      source: req.source,
      covered: false,
    };

    // Check if standards address this category
    if (standards.sections[req.category?.toLowerCase()]) {
      result.covered = true;
    } else {
      validation.issues.push({
        type: "uncovered-nfr",
        requirement: req.text,
        recommendation: `Add standards for ${req.category}`,
      });
      validation.compliant = false;
    }

    validation.validation_results.push(result);
  });

  // Generate recommendations
  validation.recommendations = generateValidationRecommendations(validation.issues);

  return validation;
}

/**
 * Checks if requirement needs a specific rule
 * @param {object} requirement - Requirement
 * @param {object} rule - Rule
 * @returns {boolean} True if requirement needs rule
 */
function requirementNeedsRule(requirement, rule) {
  const text = requirement.text.toLowerCase();
  const ruleCategory = rule.category.toLowerCase();

  return text.includes(ruleCategory) || text.includes("must");
}

/**
 * Generates recommendations from validation issues
 * @param {array} issues - Validation issues
 * @returns {array} Recommendations
 */
function generateValidationRecommendations(issues) {
  const recommendations = [];

  issues.forEach((issue) => {
    if (issue.recommendation) {
      recommendations.push({
        type: issue.type,
        action: issue.recommendation,
        priority: "high",
      });
    }
  });

  return recommendations;
}

/**
 * Breaks down requirements into work items
 * @param {object} requirements - Requirements
 * @param {object} standards - Standards
 * @param {object} validation - Validation results
 * @returns {array} Work items (epics, stories, tasks)
 */
export function createWorkBreakdown(requirements, standards, validation) {
  const workItems = {
    generated_at: new Date().toISOString(),
    epics: [],
    stories: [],
    tasks: [],
    testing_tasks: [],
    total_work_items: 0,
  };

  // Create Epic for overall initiative
  workItems.epics.push({
    title: `Implementation of ${requirements.epic_key}`,
    description: `Complete implementation aligned with standards and requirements`,
    key_requirements: requirements.aggregated_requirements.slice(0, 5),
    standards_applied: standards.page_url,
    estimated_effort: "TBD",
  });

  // Create Stories from functional requirements
  requirements.functional_requirements.forEach((req, index) => {
    const story = {
      id: `STORY-${index + 1}`,
      title: req.text.substring(0, 80),
      description: req.text,
      source_issue: req.source,
      priority: req.priority || "Medium",
      acceptance_criteria: findRelatedAcceptanceCriteria(
        req.source,
        requirements.acceptance_criteria
      ),
      validation_requirements: findValidationRequirements(req, validation),
      effort_estimate: estimateEffort(req),
      dependent_tasks: [],
    };

    workItems.stories.push(story);
  });

  // Create implementation tasks
  workItems.stories.forEach((story) => {
    const tasks = createTasksFromStory(story, standards);
    workItems.tasks.push(...tasks);
  });

  // Create testing tasks
  workItems.testing_tasks = createTestingTasks(requirements, standards);

  // Add tasks from standards compliance
  workItems.tasks.push(...createComplianceTasks(validation, standards));

  workItems.total_work_items = workItems.epics.length +
    workItems.stories.length +
    workItems.tasks.length +
    workItems.testing_tasks.length;

  return workItems;
}

/**
 * Finds acceptance criteria related to a source
 * @param {string} source - Source issue key
 * @param {array} criteria - All criteria
 * @returns {array} Related criteria
 */
function findRelatedAcceptanceCriteria(source, criteria) {
  return criteria
    .filter((ac) => ac.source === source)
    .map((ac) => ac.criteria);
}

/**
 * Finds validation requirements
 * @param {object} requirement - Requirement
 * @param {object} validation - Validation results
 * @returns {array} Relevant validation requirements
 */
function findValidationRequirements(requirement, validation) {
  return validation.validation_results
    .filter((vr) => vr.requirement.includes(requirement.text.substring(0, 50)))
    .flatMap((vr) => vr.checks || []);
}

/**
 * Estimates effort for a requirement
 * @param {object} requirement - Requirement
 * @returns {string} Effort estimate (XS, S, M, L, XL)
 */
function estimateEffort(requirement) {
  const text = requirement.text.toLowerCase();
  const length = text.length;

  if (length < 100) return "XS";
  if (length < 250) return "S";
  if (length < 500) return "M";
  if (length < 1000) return "L";
  return "XL";
}

/**
 * Creates tasks from a story
 * @param {object} story - User story
 * @param {object} standards - Design standards
 * @returns {array} Tasks
 */
function createTasksFromStory(story, standards) {
  const tasks = [];

  // Design task
  tasks.push({
    id: `${story.id}-DESIGN`,
    title: `Design solution for: ${story.title}`,
    type: "Design",
    description: "Design implementation following standards",
    standards_reference: standards.page_url,
    checklist: standards.validation_rules.map((r) => r.category),
    depends_on: [],
  });

  // Implementation task
  tasks.push({
    id: `${story.id}-IMPL`,
    title: `Implement: ${story.title}`,
    type: "Implementation",
    description: story.description,
    acceptance_criteria: story.acceptance_criteria,
    code_standards: standards.sections.coding_standards,
    depends_on: [`${story.id}-DESIGN`],
  });

  // Code review task
  tasks.push({
    id: `${story.id}-REVIEW`,
    title: `Code review for: ${story.title}`,
    type: "Review",
    description: "Peer review following code standards",
    review_criteria: standards.sections.coding_standards,
    depends_on: [`${story.id}-IMPL`],
  });

  // Testing task
  tasks.push({
    id: `${story.id}-TEST`,
    title: `Test: ${story.title}`,
    type: "Testing",
    description: "Comprehensive testing of implementation",
    test_requirements: standards.sections.testing_requirements,
    depends_on: [`${story.id}-REVIEW`],
  });

  return tasks;
}

/**
 * Creates testing tasks
 * @param {object} requirements - Requirements
 * @param {object} standards - Design standards
 * @returns {array} Testing tasks
 */
function createTestingTasks(requirements, standards) {
  const tasks = [];

  // Unit testing
  tasks.push({
    id: "TEST-UNIT",
    title: "Unit testing",
    type: "Testing",
    description: "Create and run unit tests",
    coverage_target: "80%",
    standards: standards.sections.testing_requirements,
  });

  // Integration testing
  tasks.push({
    id: "TEST-INTEGRATION",
    title: "Integration testing",
    type: "Testing",
    description: "Test component interactions",
    depends_on: ["TEST-UNIT"],
  });

  // Performance testing
  if (requirements.non_functional_requirements.some((r) => r.category === "Performance")) {
    tasks.push({
      id: "TEST-PERFORMANCE",
      title: "Performance testing",
      type: "Testing",
      description: "Validate performance targets",
      standards: standards.sections.performance,
    });
  }

  // Security testing
  if (standards.sections.security) {
    tasks.push({
      id: "TEST-SECURITY",
      title: "Security testing",
      type: "Testing",
      description: "Security validation and scanning",
      checklist: standards.security_checklist,
    });
  }

  return tasks;
}

/**
 * Creates compliance tasks from validation
 * @param {object} validation - Validation results
 * @returns {array} Compliance tasks
 */
function createComplianceTasks(validation) {
  const tasks = [];

  // Add tasks for validation recommendations
  validation.recommendations.forEach((rec, index) => {
    if (rec.priority === "high") {
      tasks.push({
        id: `COMPLIANCE-${index + 1}`,
        title: rec.action,
        type: "Compliance",
        description: `Address validation issue: ${rec.type}`,
        priority: rec.priority,
      });
    }
  });

  return tasks;
}

/**
 * Formats work breakdown as implementation plan
 * @param {object} workItems - Work items
 * @returns {object} Implementation plan
 */
export function formatImplementationPlan(workItems) {
  const plan = {
    created_at: new Date().toISOString(),
    phases: [],
    total_items: workItems.total_work_items,
    summary: {},
  };

  // Phase 1: Design & Planning
  plan.phases.push({
    phase: 1,
    name: "Design & Planning",
    items: workItems.tasks.filter((t) => t.type === "Design"),
    duration_estimate: "1-2 weeks",
    deliverables: ["Design documents", "Architecture diagrams", "Standards alignment"],
  });

  // Phase 2: Implementation
  plan.phases.push({
    phase: 2,
    name: "Implementation",
    items: workItems.tasks.filter((t) => t.type === "Implementation"),
    duration_estimate: "2-4 weeks",
    deliverables: ["Source code", "Documentation", "Code reviews"],
  });

  // Phase 3: Testing & Validation
  plan.phases.push({
    phase: 3,
    name: "Testing & Validation",
    items: [
      ...workItems.testing_tasks,
      ...workItems.tasks.filter((t) => t.type === "Testing"),
    ],
    duration_estimate: "1-2 weeks",
    deliverables: ["Test reports", "Coverage metrics", "Performance results"],
  });

  // Phase 4: Compliance & Deployment
  plan.phases.push({
    phase: 4,
    name: "Compliance & Deployment",
    items: workItems.tasks.filter((t) => t.type === "Compliance"),
    duration_estimate: "1 week",
    deliverables: ["Compliance checklist", "Deployment guide", "Release notes"],
  });

  // Summary statistics
  plan.summary = {
    total_epics: 1,
    total_stories: workItems.stories.length,
    total_tasks: workItems.tasks.length,
    total_testing_tasks: workItems.testing_tasks.length,
    effort_distribution: {
      design: workItems.tasks.filter((t) => t.type === "Design").length,
      implementation: workItems.tasks.filter((t) => t.type === "Implementation").length,
      testing: workItems.testing_tasks.length,
      compliance: workItems.tasks.filter((t) => t.type === "Compliance").length,
    },
  };

  return plan;
}

/**
 * Prepares delegation instructions for implementation teams
 * @param {object} workItems - Work items
 * @param {object} standards - Design standards
 * @returns {array} Delegation instructions per agent/team
 */
export function prepareDelegationInstructions(workItems, standards) {
  const delegations = [];

  // Delegation to design agent
  delegations.push({
    agent: "design-agent",
    phase: "Design & Planning",
    tasks: workItems.tasks.filter((t) => t.type === "Design"),
    standards_reference: standards.page_url,
    deliverables: ["Design documents", "Architecture"],
    success_criteria: ["Alignment with standards", "Stakeholder approval"],
  });

  // Delegation to code agent
  delegations.push({
    agent: "code-agent",
    phase: "Implementation",
    tasks: workItems.tasks.filter((t) => t.type === "Implementation"),
    code_standards: standards.sections.coding_standards,
    testing_requirements: standards.sections.testing_requirements,
    deliverables: ["Source code", "Unit tests"],
    success_criteria: ["Code review approval", "Test coverage > 80%"],
  });

  // Delegation to test agent
  delegations.push({
    agent: "test-agent",
    phase: "Testing & Validation",
    tasks: workItems.testing_tasks,
    testing_standards: standards.sections.testing_requirements,
    security_checklist: standards.security_checklist,
    deliverables: ["Test reports", "Coverage metrics"],
    success_criteria: ["All tests passing", "Security checklist complete"],
  });

  // Delegation to orchestrator for compliance
  delegations.push({
    agent: "orchestrator-agent",
    phase: "Compliance & Deployment",
    tasks: workItems.tasks.filter((t) => t.type === "Compliance"),
    validation_requirements: standards.validation_rules,
    deliverables: ["Deployment guide", "Release notes"],
    success_criteria: ["All compliance checks passed", "Ready for production"],
  });

  return delegations;
}

export {
  SDLM_PHASES,
  WORKFLOW_STATUS,
  CLARITY_LEVELS,
  GRAPH_STEPS,
};
