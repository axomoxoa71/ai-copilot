import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logEvent } from "./telemetry.js";
import { readJsonResponse } from "./response-json.js";

const WEB_LOOKUP_HINTS = [
  "current",
  "latest",
  "recent",
  "news",
  "update",
  "updates",
  "breaking",
  "right now",
  "fact check",
  "verify",
  "source",
  "sources",
  "look up",
  "lookup",
  "search the web",
  "web search",
  "weather",
  "stock",
  "price",
  "release",
  "launched",
];

export async function runWebSearch(query, usedApiEndpoints = []) {
  const trackApiEndpoint = (endpoint) => {
    if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
      return;
    }

    if (!usedApiEndpoints.includes(endpoint)) {
      usedApiEndpoints.push(endpoint);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const asksUsPresident =
    /\bpresident\b/.test(normalizedQuery)
    && /\b(united states|u\.?s\.?a?|america)\b/.test(normalizedQuery);

  if (asksUsPresident) {
    try {
      const ddgEndpoint =
        `https://api.duckduckgo.com/?format=json&q=current+president+of+united+states`;
      trackApiEndpoint(ddgEndpoint);
      const ddgResponse = await fetch(ddgEndpoint);

      if (ddgResponse.ok) {
        const ddgResult = await readJsonResponse(ddgResponse);
        const ddgPayload = ddgResult.value;

        if (!ddgResult.parsed) {
          logEvent({
            status: "WARNING",
            endpoint: "/agent-api",
            message: ddgResult.empty
              ? "DuckDuckGo response body was empty; skipping direct president lookup."
              : "DuckDuckGo response was not valid JSON; skipping direct president lookup.",
            userData: { endpoint: ddgEndpoint },
          });
        }

        if (ddgPayload && typeof ddgPayload === "object") {
          logEvent({
            status: "INFO",
            endpoint: "/agent-api",
            message: "US president lookup via DuckDuckGo",
            userData: {
              hasAbstract: Boolean(ddgPayload.AbstractText),
              hasAnswer: Boolean(ddgPayload.Answer),
            },
          });

          const snippets = [];

          if (typeof ddgPayload.AbstractText === "string" && ddgPayload.AbstractText.trim().length > 0) {
            const suffix = typeof ddgPayload.AbstractURL === "string" && ddgPayload.AbstractURL.trim().length > 0
              ? ` (${ddgPayload.AbstractURL.trim()})`
              : "";
            snippets.push(`${ddgPayload.AbstractText.trim()}${suffix}`);
          }

          if (typeof ddgPayload.Answer === "string" && ddgPayload.Answer.trim().length > 0) {
            snippets.push(ddgPayload.Answer.trim());
          }

          if (snippets.length > 0) {
            logEvent({
              status: "INFO",
              endpoint: "/agent-api",
              message: "US president lookup successful",
              userData: { resultCount: snippets.length },
            });
            return snippets.join("\n");
          }
        }
      }
    } catch (error) {
      logEvent({
        status: "WARNING",
        endpoint: "/agent-api",
        message: "Direct US president lookup failed; continuing with general DuckDuckGo web search.",
        error,
      });
    }
  }

  const instantAnswerEndpoint =
    `https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=${encodeURIComponent(query)}`;
  trackApiEndpoint(instantAnswerEndpoint);

  const instantAnswerResponse = await fetch(instantAnswerEndpoint);
  if (!instantAnswerResponse.ok) {
    return `Search is temporarily unavailable (status ${instantAnswerResponse.status}).`;
  }

  const payloadResult = await readJsonResponse(instantAnswerResponse);
  const payload = payloadResult.value;
  if (!payloadResult.parsed) {
    logEvent({
      status: "WARNING",
      endpoint: "/agent-api",
      message: payloadResult.empty
        ? "DuckDuckGo search response body was empty; returning no relevant results."
        : "DuckDuckGo search response was not valid JSON; returning no relevant results.",
      userData: { endpoint: instantAnswerEndpoint },
    });
  }

  const snippets = [];

  if (typeof payload?.AbstractText === "string" && payload.AbstractText.trim().length > 0) {
    const suffix = typeof payload.AbstractURL === "string" && payload.AbstractURL.trim().length > 0
      ? ` (${payload.AbstractURL.trim()})`
      : "";
    snippets.push(`${payload.AbstractText.trim()}${suffix}`);
  }

  if (typeof payload?.Answer === "string" && payload.Answer.trim().length > 0) {
    snippets.push(payload.Answer.trim());
  }

  const related = Array.isArray(payload?.RelatedTopics)
    ? payload.RelatedTopics.flatMap((item) => {
        if (item && typeof item.Text === "string") {
          const link = typeof item.FirstURL === "string" && item.FirstURL.trim().length > 0
            ? ` (${item.FirstURL.trim()})`
            : "";
          return [`${item.Text.trim()}${link}`];
        }

        if (item && Array.isArray(item.Topics)) {
          return item.Topics
            .filter((topic) => topic && typeof topic.Text === "string")
            .map((topic) => {
              const link = typeof topic.FirstURL === "string" && topic.FirstURL.trim().length > 0
                ? ` (${topic.FirstURL.trim()})`
                : "";
              return `${topic.Text.trim()}${link}`;
            });
        }

        return [];
      })
    : [];

  const uniqueSnippets = Array.from(new Set([...snippets, ...related]))
    .filter((value) => value.trim().length > 0)
    .slice(0, 8);

  const finalSnippets = Array.from(new Set(uniqueSnippets)).slice(0, 10);

  if (finalSnippets.length === 0) {
    return "No relevant web results found for the query.";
  }

  return finalSnippets.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export function extractUrls(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return [];
  }

  const matches = text.match(/https?:\/\/[^\s)]+/g) || [];
  return Array.from(
    new Set(
      matches.map((url) => url.replace(/[.,;:!?]+$/, "")),
    ),
  );
}

export function shouldAutoWebLookup(prompt) {
  if (typeof prompt !== "string") {
    return false;
  }

  const normalizedPrompt = prompt.trim().toLowerCase();
  if (normalizedPrompt.length === 0) {
    return false;
  }

  if (normalizedPrompt.includes("http://") || normalizedPrompt.includes("https://")) {
    return true;
  }

  return WEB_LOOKUP_HINTS.some((hint) => normalizedPrompt.includes(hint));
}

export const webSearchTool = tool(
  async ({ query }) => runWebSearch(query),
  {
    name: "web_search",
    description:
      "Search the public web for current information. Use this for real-time facts, current events, and references.",
    schema: z.object({
      query: z.string().min(3),
    }),
  },
);
