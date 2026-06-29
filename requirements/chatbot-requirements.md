# Chatbot Requirements

## Table of Contents

- [Chatbot Requirements](#chatbot-requirements)
  - [Table of Contents](#table-of-contents)
  - [Purpose](#purpose)
  - [Screen Structure](#screen-structure)
  - [Screen Requirement Documents](#screen-requirement-documents)
  - [Cross-Screen Functional Requirements](#cross-screen-functional-requirements)
  - [Cross-Screen Non-Functional Requirements](#cross-screen-non-functional-requirements)
  - [Cross-Screen User Stories](#cross-screen-user-stories)
  - [Cross-Screen Acceptance Criteria](#cross-screen-acceptance-criteria)

## Purpose

Define parent-level requirements for the Chatbot screen area and split detailed requirements into sub-screen documents.

## Screen Structure

1. Main application screen area includes Chatbot as its own screen domain.
2. Chatbot domain is split into two sub-screens:
   - Chat sub-screen
   - History sub-screen
3. Detailed requirements for sub-screens are maintained in dedicated requirement documents.

## Screen Requirement Documents

1. Chat sub-screen requirements: `requirements/chatbot-chat-requirements.md`
2. History sub-screen requirements: `requirements/chatbot-history-requirements.md`

## Cross-Screen Functional Requirements

1. Chatbot requirements must remain split by sub-screen to avoid mixing chat interaction and history exploration concerns.
2. Navigation from Chat sub-screen to History sub-screen must remain documented and implemented.
3. Shared backend/API behavior used by both sub-screens must remain traceable and documented.

## Cross-Screen Non-Functional Requirements

1. UI text must be in English.
2. Chat and history interactions must remain usable on desktop and mobile layouts.
3. All chatbot-related API errors shown to users must include trace ID when available.
4. Chatbot API and webhook handling must emit structured logs including trace context.
5. Chatbot requests must have bounded execution time using a configurable timeout.

## Cross-Screen User Stories

1. As a support engineer, I want trace IDs on failures so I can correlate frontend errors with backend logs.

## Cross-Screen Acceptance Criteria

1. Requirement details for chat behavior exist in `requirements/chatbot-chat-requirements.md`.
2. Requirement details for history behavior exist in `requirements/chatbot-history-requirements.md`.
3. Parent chatbot requirements remain synchronized with both sub-screen documents.
