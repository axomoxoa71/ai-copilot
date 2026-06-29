# Chatbot History Screen Requirements

## Table of Contents

- [Chatbot History Screen Requirements](#chatbot-history-screen-requirements)
  - [Table of Contents](#table-of-contents)
  - [Purpose](#purpose)
  - [Functional Requirements](#functional-requirements)
  - [Non-Functional Requirements](#non-functional-requirements)
  - [User Stories and Use Cases](#user-stories-and-use-cases)
  - [Acceptance Criteria](#acceptance-criteria)

## Purpose

Define requirements for the History sub-screen of Chatbot, focused on searching, filtering, and reviewing persisted chat history.

## Functional Requirements

1. Chat history must be retrievable per profile via API (`GET /api/profiles/:id/chats` and `GET /api/profiles/:id/chat-history`).
2. The history screen must provide a quality filter as a slider from 1 to 10, default `10`, and the backend must return rows where `quality <= selected value`.
3. The history API must support filtering by time period using `timePeriod` values `last_hour`, `last_day` (default), `last_week`, `last_month`, and `all`.
4. The history API must support filtering by `sessionId` text query.
5. History queries must enforce a maximum of 1000 returned rows per request.
6. When exactly 1000 chat rows are returned, the UI must inform users that not all rows may be returned and filters should be refined.
7. The history screen must render a paged grid with columns: `created_ts` (timestamp), `session_id`, `role`, `message`, and `quality`.
8. Each history row must provide an action icon to filter by that row's session id.
9. Session drill-down action must set the session filter, reset time period to `all`, reset quality to `10`, and reload results.

## Non-Functional Requirements

1. UI text must be in English.
2. History interactions must remain usable on desktop and mobile layouts.
3. History API errors shown to users must include trace ID when available.

## User Stories and Use Cases

1. As an analyst, I want to filter chat history by quality, time period, and session id so I can find relevant conversations quickly.
2. As an analyst, I want one-click session drill-down from a history row so I can inspect all turns in a specific session.

## Acceptance Criteria

1. History quality filter returns entries with `quality <= selected value`.
2. History time period dropdown supports Last Hour, Last Day (default), Last Week, Last Month, and All.
3. History query limits response size to 1000 entries and UI shows a refinement warning when exactly 1000 are returned.
4. History grid provides paging and includes Timestamp, SessionId, Role, Message, and Quality.
5. Session action icon in each row applies session filter and resets time period to All and quality to 10.
