# Tools

## Table of Contents

1. [Overview](#overview)
2. [Development Tools](#development-tools)
3. [Quality and Validation Tools](#quality-and-validation-tools)

## Overview

This project uses a Vite frontend and does not currently expose custom MCP tools.

## Development Tools

### Dev Server

**Description**: Starts the Vite development server with hot module replacement.

**Command**: `npm run dev`

**Output**: App served at `http://localhost:5173`

---

### Build

**Description**: Builds an optimized production bundle with Vite.

**Command**: `npm run build`

**Output**: Production bundle in `dist/`

## Quality and Validation Tools

### Type Check

**Description**: Runs TypeScript static validation with no emitted files.

**Command**: `npm run typecheck`

---

### Lint

**Description**: Runs ESLint checks across the codebase.

**Command**: `npm run lint`

---

### Secret Scan (Full Repository)

**Description**: Runs gitleaks against the full repository to detect secrets before push.

**Command**: `npm run secrets:scan`

---

### Secret Scan (Staged Changes)

**Description**: Runs gitleaks against staged changes (used by pre-commit hook).

**Command**: `npm run secrets:scan:staged`
