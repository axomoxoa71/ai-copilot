# AGENTS

## Table of Contents

- [AGENTS](#agents)
  - [Table of Contents](#table-of-contents)
  - [Purpose](#purpose)
  - [Scope](#scope)
  - [Core Rules](#core-rules)
  - [Best Practices](#best-practices)
  - [Logging](#logging)
  - [Security](#security)
  - [Testing](#testing)
  - [Database Conventions](#database-conventions)
  - [User Interface](#user-interface)
  - [Documentation Sync](#documentation-sync)
  - [Documentation Standards](#documentation-standards)
    - [Required Documentation Coverage](#required-documentation-coverage)
  - [Change Discipline](#change-discipline)
  - [A2A Agent Card Regeneration](#a2a-agent-card-regeneration)
  - [Implementation Notes](#implementation-notes)
  - [Validation Commands](#validation-commands)
  - [Agent Workflow](#agent-workflow)
  - [Jira Template Ticket Workflow](#jira-template-ticket-workflow)

## Purpose

This file is the canonical instruction source for coding agents in this repository.

## Scope

- Apply these instructions repository-wide unless a deeper folder-level instruction file overrides them.
- Folder-level instruction files:
  - src/.instructions.md

## Core Rules

- Keep code, tests, and documentation synchronized for every behavior change.
- Prefer minimal, focused, and safe edits over broad refactors.
- Preserve existing architectural and naming conventions.
- Keep UI text in English.

## Best Practices

- Continuously improve code, documentation, testing, and project structure where beneficial.
- Keep generated changes readable, maintainable, and verifiable.

## Logging

- Use OTEL-based logging for exceptions and errors.
- Keep logs structured and include relevant context.
- Propagate trace context across components and layers.
- Ensure UI-facing errors expose trace id when available for correlation.

## Security

- Perform security reviews for changes involving authentication, secrets, or external communication.
- Follow secure coding practices and avoid hardcoded secrets.
- Use environment variables or secure vaults for credentials.
- Validate changes against OWASP Top 10 risk areas.
- Consider static analysis tools such as semgrep, codeql, and bandit before merge.

## Testing

- Follow test-first development where practical.
- Automated tests are required for changed or added behavior.
- Add regression tests when fixing defects.
- Use descriptive test names and reliable assertions.

## Database Conventions

- Tables: snake_case plural with _t suffix.
- Columns: snake_case.
- Primary key: id.
- Date columns: _date suffix.
- Timestamp columns: _ts suffix.
- Standard timestamps:
  - created_ts default CURRENT_TIMESTAMP
  - updated_ts default CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
- Foreign keys: {referenced_table_singular}_id.
- Indexes: {table_name}_{column_name}_idx.
- Check constraints: {table_name}_{column_name}_chk.
- Use lowercase snake_case for all database objects.

## User Interface

- Use a dark theme with accessible contrast.
- Keep UI responsive across screen sizes.
- Keep design language consistent across screens.
- UI text must be in English.
- Include trace id in error surfaces when available.

## Documentation Sync

- Keep documentation in documentation/ synchronized with implementation.
- Update affected docs for behavior, interface, workflow, test, and configuration changes.

## Documentation Standards

- Every documentation markdown file must include an up-to-date table of contents.
- Keep formatting and style consistent.
- Prefer single source of truth and cross-links over duplication.
- Use examples and mermaid diagrams when appropriate.
- Ensure documentation reflects current implementation.

### Required Documentation Coverage

- README.md: high-level overview, key capabilities, quick start, links.
- requirements/*-requirements.md: detailed functional and non-functional requirements.
- documentation/implementation.md: implementation details and data flows
- documentation/architecture.md: architecture layers by using mermaid diagram(s) and additional descriptions
- documentation/installation.md: setup and runtime guidance.
- tests.md: test inventory and assertions.
- documentation/api/index.md and html for documenting the API in swagger hub (openapi) style as html

## Change Discipline

- Keep code and documentation changes consistent.
- Keep test and config updates aligned with implementation changes.

## A2A Agent Card Regeneration

- Agent cards are generated into `documentation/a2a/cards/`.
- Run `npm run generate:a2a-cards` whenever changes affect A2A card output.
- Mandatory regeneration triggers include:
  - `src/resources/agent-config.json`
  - `agent-api/a2a-handler.js`
  - Any other code or config that changes card fields, capability mapping, skills, URLs, or metadata
- Commit regenerated files in `documentation/a2a/cards/` together with the related implementation/config change.

## Implementation Notes

- Use React for UI component development.
- Use TypeScript for code development where applicable.
- Use Playwright for UI testing.
- Follow secure coding and configuration practices in all layers.

## Validation Commands

- Install dependencies: npm install
- Run dev servers: npm run dev
- Build: npm run build
- Lint: npm run lint
- Typecheck: npm run typecheck
- E2E tests: npm run test:e2e

## Agent Workflow

1. Read AGENTS.md and nearest folder-level .instructions.md files before editing.
2. Implement the smallest safe change that satisfies requirements.
3. Run relevant validation commands.
4. Update impacted documentation and tests.
5. Summarize changes, residual risks, and next actions.

## Jira Template Ticket Workflow

- If user requests a ticket from template or provides template_issue_key, use jira_create_ticket_from_template.
- Do not use jira_create_issue for template-based requests.
- If tool returns needs_placeholder_values:
  - Ask for each placeholder individually.
  - Do not batch placeholders in one prompt.
  - Retry creation with all required placeholder_values.
  - Re-prompt specific placeholders when values are empty.
