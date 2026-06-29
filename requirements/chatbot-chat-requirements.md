# Chatbot Chat Screen Requirements

## Table of Contents

- [Chatbot Chat Screen Requirements](#chatbot-chat-screen-requirements)
  - [Table of Contents](#table-of-contents)
  - [Purpose](#purpose)
  - [Functional Requirements](#functional-requirements)
  - [Non-Functional Requirements](#non-functional-requirements)
  - [User Stories and Use Cases](#user-stories-and-use-cases)
  - [Acceptance Criteria](#acceptance-criteria)

## Purpose

Define requirements for the Chat sub-screen of Chatbot, focused on asking questions, receiving responses, and managing active chat sessions.

## Functional Requirements

1. The chat page must require an active profile context before sending questions.
2. Submitting a chat question from the Chat UI must call `POST /api/chats/dispatch` with `profileId`, `sessionId`, and `message`.
3. The `POST /api/chats/dispatch` endpoint must return a synchronous chatbot answer payload for immediate UI rendering and must not persist chat rows.
4. The backend must support `POST /api/chats` for persistent chatbot workflow integration and update stored response status as `completed` or `failed`.
5. Chatbot endpoints must call the configured webhook and forward trace context through `traceparent`.
6. If the chatbot webhook times out, the API must return an error; the persistent flow (`POST /api/chats`) must persist a failed chat response.
7. If the chatbot webhook returns no synchronous answer, the API must return an error; the persistent flow (`POST /api/chats`) must persist a failed chat response.
8. The UI must support a "new session" behavior that resets turn history and generates a new `sessionId`.
9. The UI must load quick reply prompts from `GET /api/chats/quick-reply` and allow inserting and sending them.
10. The UI must support voice input language selection for German and English, with default based on browser locale.
11. The chatbot header must provide a dedicated history icon to the left of the new-chat (`+`) action.
12. Clicking the history icon must open the history sub-screen for the selected profile.

## Non-Functional Requirements

1. UI text must be in English.
2. Chat interactions must remain usable on desktop and mobile layouts.
3. Chatbot API and webhook handling must emit structured logs including trace context.
4. Chatbot requests must have bounded execution time using a configurable timeout.

## User Stories and Use Cases

1. As a user, I want to ask profile-specific questions so responses stay aligned with selected profile context.
2. As a user, I want one-click quick replies so I can start common prompts faster.
3. As a user, I want to start a new chat session so I can separate conversations.
4. As a user, I want voice input support for English and German so I can ask questions hands-free.

## Acceptance Criteria

1. Sending a valid chat message from the Chat UI calls `POST /api/chats/dispatch` and returns a completed synchronous response when webhook succeeds.
2. If webhook timeout is reached, API returns timeout error; when using `POST /api/chats`, stored chat status is `failed`.
3. If webhook returns no synchronous answer, API returns a handled error; when using `POST /api/chats`, stored chat status is `failed`.
4. Opening a new chat session clears visible chat turns and uses a new `sessionId`.
5. Quick replies load from API and can be used to send a message.
6. Voice input language defaults from browser locale and supports manual toggle between German and English.
7. Chatbot header shows a history icon before the new-chat action and opens the history sub-screen.
