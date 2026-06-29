# AI Lang Frameworks

This document lists major Lang ecosystem frameworks and organizes their purpose, links, and capabilities.

## Table of Contents

- [AI Lang Frameworks](#ai-lang-frameworks)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [LangChain](#langchain)
    - [Capabilities](#capabilities)
  - [LangGraph](#langgraph)
    - [Capabilities](#capabilities-1)
  - [LangSmith](#langsmith)
    - [Capabilities](#capabilities-2)
  - [LangServe](#langserve)
    - [Capabilities](#capabilities-3)
  - [LangChain Hub](#langchain-hub)
    - [Capabilities](#capabilities-4)

## Overview

The Lang ecosystem provides complementary building blocks for developing, orchestrating, observing, and deploying LLM applications.

## LangChain

| Name | Purpose | Home Page (main link) | Documentation (docu link) |
|---|---|---|---|
| LangChain | Build LLM application logic using reusable components for prompts, models, tools, and retrieval | https://www.langchain.com | https://docs.langchain.com/oss/python/langchain/overview |

### Capabilities

| Capability | Documentation (link) |
|---|---|
| Prompt templates and prompt composition | https://docs.langchain.com/oss/python/langchain/prompt-templates |
| Model abstraction and provider integrations | https://docs.langchain.com/oss/python/langchain/models |
| Tool calling and agent execution | https://docs.langchain.com/oss/python/langchain/agents |
| Retrieval-augmented generation (RAG) pipelines | https://docs.langchain.com/oss/python/langchain/rag#build-a-rag-agent-with-langchain |
| Structured output parsing | https://docs.langchain.com/oss/python/langchain/structured-output |

## LangGraph

| Name | Purpose | Home Page (main link) | Documentation (docu link) |
|---|---|---|---|
| LangGraph | Build stateful, graph-based, and controllable workflows for single and multi-agent systems | https://www.langchain.com/langgraph | https://langchain-ai.github.io/langgraph/ |

### Capabilities

| Capability | Documentation (link) |
|---|---|
| Graph-based workflow modeling | https://langchain-ai.github.io/langgraph/concepts/why-langgraph/ |
| Stateful execution and checkpointing | https://langchain-ai.github.io/langgraph/concepts/persistence/ |
| Conditional routing and branching | https://langchain-ai.github.io/langgraph/concepts/low_level/ |
| Human-in-the-loop controls | https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/ |
| Multi-agent orchestration patterns | https://langchain-ai.github.io/langgraph/concepts/multi_agent/ |

## LangSmith

| Name | Purpose | Home Page (main link) | Documentation (docu link) |
|---|---|---|---|
| LangSmith | Observe, debug, test, and evaluate LLM applications across development and production | https://www.langchain.com/langsmith | https://docs.smith.langchain.com/ |

### Capabilities

| Capability | Documentation (link) |
|---|---|
| End-to-end tracing and run inspection | https://docs.smith.langchain.com/observability/how_to_guides/log_traces |
| Prompt and run version comparison | https://docs.smith.langchain.com/prompt_engineering/how_to_guides/manage_prompts_programmatically |
| Dataset-based evaluation | https://docs.smith.langchain.com/evaluation/how_to_guides/manage_datasets_programmatically |
| Regression testing for LLM apps | https://docs.smith.langchain.com/evaluation/how_to_guides/run_evals |
| Monitoring quality, latency, and cost | https://docs.smith.langchain.com/observability/concepts |

## LangServe

| Name | Purpose | Home Page (main link) | Documentation (docu link) |
|---|---|---|---|
| LangServe | Deploy LangChain and LangGraph runnables as production-ready API endpoints | https://github.com/langchain-ai/langserve | https://github.com/langchain-ai/langserve/blob/main/README.md |

### Capabilities

| Capability | Documentation (link) |
|---|---|
| API serving for runnable chains and graphs | https://github.com/langchain-ai/langserve/blob/main/README.md |
| FastAPI integration for deployment | https://github.com/langchain-ai/langserve/blob/main/README.md |
| Input and output schema exposure | https://github.com/langchain-ai/langserve/blob/main/README.md |
| Playground endpoint support for debugging | https://github.com/langchain-ai/langserve/blob/main/README.md |
| Deployment patterns for cloud and containers | https://github.com/langchain-ai/langserve/tree/main/examples |

## LangChain Hub

| Name | Purpose | Home Page (main link) | Documentation (docu link) |
|---|---|---|---|
| LangChain Hub | Discover, share, and reuse prompt and chain artifacts across teams and projects | https://smith.langchain.com/hub | https://docs.smith.langchain.com/prompt_engineering/how_to_guides/langchain_hub |

### Capabilities

| Capability | Documentation (link) |
|---|---|
| Prompt discovery and reuse | https://smith.langchain.com/hub |
| Shared prompt artifacts across teams | https://docs.smith.langchain.com/prompt_engineering/how_to_guides/langchain_hub |
| Prompt versioning workflows | https://docs.smith.langchain.com/prompt_engineering/how_to_guides/manage_prompts_programmatically |
| Baseline prompt standardization | https://docs.smith.langchain.com/prompt_engineering/concepts |
| Integration with LangSmith prompt tooling | https://docs.smith.langchain.com/prompt_engineering |
