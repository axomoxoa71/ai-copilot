/**
 * Dialog Manager Module
 * Handles clarification dialogs for open questions and ambiguities
 */

/**
 * Question types
 */
const QUESTION_TYPES = {
  EXPLICIT: "explicit",
  CONDITIONAL: "conditional",
  AMBIGUOUS: "ambiguous",
  CONTEXT: "context",
  SCOPE: "scope",
};

/**
 * Dialog states
 */
const DIALOG_STATES = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  RESOLVED: "resolved",
  ESCALATED: "escalated",
};

/**
 * Formats open questions for user dialog
 * @param {array} openQuestions - Array of open questions from task planner
 * @returns {object} Formatted dialog for presentation
 */
export function createClarificationDialog(openQuestions) {
  if (!openQuestions || openQuestions.length === 0) {
    return null;
  }

  const dialog = {
    state: DIALOG_STATES.PENDING,
    timestamp: new Date().toISOString(),
    questions: [],
    followups: [],
    context: {
      total_questions: openQuestions.length,
      critical: openQuestions.filter((q) => isCritical(q)).length,
      optional: openQuestions.filter((q) => !isCritical(q)).length,
    },
  };

  // Group and format questions by type
  const questionsByType = groupQuestionsByType(openQuestions);

  // Format each question with helpful context
  Object.entries(questionsByType).forEach(([type, questions]) => {
    questions.forEach((question) => {
      dialog.questions.push(formatQuestion(question, type));
    });
  });

  // Create followup chain if questions are related
  const relatedQuestions = findRelatedQuestions(dialog.questions);
  if (relatedQuestions.length > 0) {
    dialog.followups = createFollowupChain(relatedQuestions);
  }

  return dialog;
}

/**
 * Formats a single question for user presentation
 * @param {object} question - Question object
 * @param {string} type - Question type
 * @returns {object} Formatted question
 */
function formatQuestion(question, type) {
  const formatted = {
    id: generateQuestionId(),
    type,
    priority: calculatePriority(question, type),
    state: DIALOG_STATES.PENDING,
    user_message: "",
    context_message: "",
    suggested_answers: [],
    allow_freeform: true,
  };

  switch (type) {
    case QUESTION_TYPES.EXPLICIT:
      formatted.user_message = question.question;
      formatted.context_message = "This is a direct question that needs answering.";
      formatted.allow_freeform = true;
      break;

    case QUESTION_TYPES.CONDITIONAL:
      formatted.user_message = question.question;
      formatted.context_message = `This affects how we handle: ${question.context || "the workflow"}`;
      formatted.suggested_answers = generateConditionalAnswers(question.context);
      break;

    case QUESTION_TYPES.AMBIGUOUS:
      formatted.user_message = question.question;
      formatted.context_message =
        "This term appears multiple times; please clarify for consistency.";
      formatted.allow_freeform = true;
      break;

    case QUESTION_TYPES.CONTEXT:
      formatted.user_message = question.question;
      formatted.context_message = "This provides important context for execution.";
      formatted.suggested_answers = generateContextAnswers(question);
      break;

    case QUESTION_TYPES.SCOPE:
      formatted.user_message = question.question;
      formatted.context_message = "This defines the scope and boundaries.";
      formatted.suggested_answers = [
        "Just this part",
        "The whole thing",
        "Depends on [other condition]",
      ];
      break;
  }

  return formatted;
}

/**
 * Groups questions by type
 * @param {array} openQuestions - Questions array
 * @returns {object} Questions grouped by type
 */
function groupQuestionsByType(openQuestions) {
  const grouped = {};

  Object.values(QUESTION_TYPES).forEach((type) => {
    grouped[type] = [];
  });

  openQuestions.forEach((question) => {
    const type = question.type || QUESTION_TYPES.EXPLICIT;
    if (grouped[type]) {
      grouped[type].push(question);
    }
  });

  return grouped;
}

/**
 * Determines if a question is critical
 * @param {object} question - Question object
 * @returns {boolean} True if critical
 */
function isCritical(question) {
  const criticalKeywords = [
    "must",
    "required",
    "mandatory",
    "blocking",
    "critical",
    "dependency",
  ];
  const questionText = (question.question || "").toLowerCase();

  return criticalKeywords.some((keyword) => questionText.includes(keyword));
}

/**
 * Calculates priority for a question
 * @param {object} question - Question object
 * @param {string} type - Question type
 * @returns {number} Priority (1-10, higher = more important)
 */
function calculatePriority(question, type) {
  let priority = 5; // Default medium priority

  // Type-based priority
  const typePriorities = {
    [QUESTION_TYPES.SCOPE]: 9,
    [QUESTION_TYPES.CONDITIONAL]: 8,
    [QUESTION_TYPES.CONTEXT]: 6,
    [QUESTION_TYPES.AMBIGUOUS]: 5,
    [QUESTION_TYPES.EXPLICIT]: 7,
  };

  priority = typePriorities[type] || priority;

  // Boost if critical
  if (isCritical(question)) {
    priority = Math.min(10, priority + 2);
  }

  return priority;
}

/**
 * Generates suggested answers for conditional questions
 * @param {string} context - Condition context
 * @returns {array} Suggested answers
 */
function generateConditionalAnswers(context) {
  const contextLower = (context || "").toLowerCase();

  if (
    contextLower.includes("notify") ||
    contextLower.includes("alert") ||
    contextLower.includes("inform")
  ) {
    return [
      "Email notification",
      "Slack notification",
      "In-app notification",
      "Multiple channels",
    ];
  }

  if (contextLower.includes("when") || contextLower.includes("trigger")) {
    return [
      "Immediately",
      "On approval",
      "On completion",
      "On schedule",
      "Manual trigger",
    ];
  }

  if (contextLower.includes("scope") || contextLower.includes("what")) {
    return [
      "Just this item",
      "All matching items",
      "Selected items",
      "Everything",
    ];
  }

  return ["Yes", "No", "Conditionally", "Depends"];
}

/**
 * Generates context-appropriate answers
 * @param {object} question - Question object
 * @returns {array} Suggested answers
 */
function generateContextAnswers(question) {
  const defaults = [
    "Default behavior",
    "Custom configuration",
    "I'll provide specifics",
  ];

  if (question.question && question.question.includes("timeline")) {
    return ["ASAP", "Within 24 hours", "By end of week", "Custom deadline"];
  }

  if (question.question && question.question.includes("priority")) {
    return ["High", "Medium", "Low"];
  }

  if (question.question && question.question.includes("participants")) {
    return [
      "Just me",
      "My team",
      "Multiple teams",
      "Organization-wide",
    ];
  }

  return defaults;
}

/**
 * Finds related questions that should be asked sequentially
 * @param {array} questions - Formatted questions
 * @returns {array} Groups of related questions
 */
function findRelatedQuestions(questions) {
  const related = [];
  const processedIndices = new Set();

  questions.forEach((q1, i) => {
    if (processedIndices.has(i)) return;

    const group = [i];
    processedIndices.add(i);

    questions.forEach((q2, j) => {
      if (i !== j && !processedIndices.has(j)) {
        if (areQuestionsRelated(q1, q2)) {
          group.push(j);
          processedIndices.add(j);
        }
      }
    });

    if (group.length > 1) {
      related.push(group);
    }
  });

  return related;
}

/**
 * Determines if two questions are related
 * @param {object} q1 - First question
 * @param {object} q2 - Second question
 * @returns {boolean} True if related
 */
function areQuestionsRelated(q1, q2) {
  const text1 = (q1.user_message || "").toLowerCase();
  const text2 = (q2.user_message || "").toLowerCase();

  // Check for common keywords
  const keywords = [
    "notify",
    "team",
    "scope",
    "timeline",
    "priority",
    "condition",
  ];

  return keywords.some((keyword) => text1.includes(keyword) && text2.includes(keyword));
}

/**
 * Creates a followup chain for related questions
 * @param {array} relatedGroups - Groups of related question indices
 * @returns {array} Followup chain with dependencies
 */
function createFollowupChain(relatedGroups) {
  return relatedGroups.map((group, chainIndex) => ({
    chain_id: `followup-${chainIndex}`,
    sequence: group,
    message: `Question group ${chainIndex + 1}: These questions are related—answering one may affect the others.`,
  }));
}

/**
 * Generates a unique ID for a question
 * @returns {string} Question ID
 */
function generateQuestionId() {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Formats dialog for user presentation
 * @param {object} dialog - Dialog object
 * @returns {string} Formatted markdown
 */
export function formatDialogForUser(dialog) {
  if (!dialog || dialog.questions.length === 0) {
    return null;
  }

  let output = "❓ **I need clarification to create the best plan:**\n\n";

  // Add priority section if there are critical questions
  const criticalQuestions = dialog.questions.filter((q) => q.priority >= 9);
  if (criticalQuestions.length > 0) {
    output += "🔴 **Critical Questions (must answer):**\n";
    criticalQuestions.forEach((q, i) => {
      output += formatSingleQuestion(q, i + 1);
    });
    output += "\n";
  }

  // Add normal questions
  const normalQuestions = dialog.questions.filter((q) => q.priority < 9);
  if (normalQuestions.length > 0) {
    output += "🟡 **Context Questions:**\n";
    normalQuestions.forEach((q, i) => {
      output += formatSingleQuestion(q, criticalQuestions.length + i + 1);
    });
  }

  // Add suggested answers
  const withSuggestions = dialog.questions.filter((q) => q.suggested_answers?.length > 0);
  if (withSuggestions.length > 0) {
    output += "\n💡 **Quick Answers Available:**\n";
    withSuggestions.forEach((q) => {
      output += `\n- For "${q.user_message.substring(0, 50)}...": `;
      output += q.suggested_answers.join(", ") + "\n";
    });
  }

  // Add instruction for response
  output += "\n📝 Please answer these questions so I can create the perfect plan! ";
  output += `(${dialog.context.total_questions} questions total)\n`;

  return output;
}

/**
 * Formats a single question for display
 * @param {object} question - Question object
 * @param {number} index - Display index
 * @returns {string} Formatted question markdown
 */
function formatSingleQuestion(question, index) {
  let output = `\n${index}. **${question.user_message}**\n`;

  if (question.context_message) {
    output += `   *${question.context_message}*\n`;
  }

  if (question.suggested_answers && question.suggested_answers.length > 0) {
    output += `   Options: ${question.suggested_answers.join(" • ")}\n`;
  }

  return output;
}

/**
 * Processes user answers to dialog questions
 * @param {object} dialog - Dialog object
 * @param {object} answers - User answers keyed by question ID
 * @returns {object} Updated dialog with responses
 */
export function processDialogAnswers(dialog, answers) {
  const updated = { ...dialog };
  updated.state = DIALOG_STATES.IN_PROGRESS;
  updated.answered_at = new Date().toISOString();
  updated.answers = {};

  updated.questions.forEach((question) => {
    const answer = answers[question.id];

    if (answer) {
      question.state = DIALOG_STATES.RESOLVED;
      question.user_answer = answer;
      updated.answers[question.id] = {
        question: question.user_message,
        answer: answer,
        type: question.type,
      };
    }
  });

  // Check if all critical questions answered
  const criticalAnswered = updated.questions
    .filter((q) => q.priority >= 9)
    .every((q) => q.state === DIALOG_STATES.RESOLVED);

  updated.state = criticalAnswered ? DIALOG_STATES.RESOLVED : DIALOG_STATES.IN_PROGRESS;

  return updated;
}

/**
 * Creates context enrichment from dialog answers
 * @param {object} dialog - Resolved dialog
 * @returns {object} Context enrichment data
 */
export function createContextFromAnswers(dialog) {
  const context = {
    clarifications: {},
    constraints: [],
    preferences: {},
  };

  Object.entries(dialog.answers || {}).forEach(([, answer]) => {
    const questionLower = answer.question.toLowerCase();

    // Extract structured data from answers
    if (questionLower.includes("notify") || questionLower.includes("alert")) {
      context.preferences.notification_channels = [answer.answer];
    }

    if (questionLower.includes("timeline") || questionLower.includes("when")) {
      context.preferences.timeline = answer.answer;
    }

    if (questionLower.includes("scope")) {
      context.constraints.push(`Scope: ${answer.answer}`);
    }

    if (questionLower.includes("priority")) {
      context.preferences.priority = answer.answer;
    }

    context.clarifications[answer.type] = answer.answer;
  });

  return context;
}

/**
 * Validates if dialog is complete enough to proceed
 * @param {object} dialog - Dialog object
 * @returns {object} Validation result with status and missing items
 */
export function validateDialogCompletion(dialog) {
  const validation = {
    is_complete: false,
    missing_critical: [],
    total_answered: 0,
    total_questions: dialog.questions.length,
  };

  dialog.questions.forEach((question) => {
    if (question.state === DIALOG_STATES.RESOLVED) {
      validation.total_answered++;
    } else if (question.priority >= 9) {
      validation.missing_critical.push(question.user_message);
    }
  });

  // Complete if all critical questions answered
  validation.is_complete = validation.missing_critical.length === 0;

  return validation;
}

export { QUESTION_TYPES, DIALOG_STATES };
