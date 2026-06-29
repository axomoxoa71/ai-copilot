import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_GREEN = "\x1b[32m";
const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERN = /(authorization|api[_-]?key|secret|token|password|passwd|cookie|set-cookie|x-api-key|openrouter)/i;
const CONFIDENTIAL_CONTENT_KEY_PATTERN = /^(prompt|response|query|content|input|output|parts?|result|text)$/i;

function getSeverityColor(status) {
  if (status === "ERROR") return ANSI_RED;
  if (status === "WARNING") return ANSI_YELLOW;
  return ANSI_GREEN;
}

function formatLogLine(status, payload) {
  const json = JSON.stringify(sanitizeForLogging(payload));
  if (!process.stdout.isTTY) {
    return json;
  }

  const level = `${ANSI_BOLD}${getSeverityColor(status)}[${status}]${ANSI_RESET}`;
  return `${level} ${json}`;
}

function parseOtlpHeaders(rawHeaders) {
  if (!rawHeaders || typeof rawHeaders !== "string") {
    return undefined;
  }

  const headerEntries = rawHeaders
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return null;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!key || !value) {
        return null;
      }
      return [key, value];
    })
    .filter((entry) => Array.isArray(entry));

  if (headerEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(headerEntries);
}

function buildSpanProcessors() {
  const exporterMode = (process.env.OTEL_TRACES_EXPORTER || "console").toLowerCase();

  if (exporterMode === "none") {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      status: "INFO",
      timestamp: new Date().toISOString(),
      endpoint: "startup",
      message: "OTEL trace exporter disabled (OTEL_TRACES_EXPORTER=none).",
    }));
    return [];
  }

  if (exporterMode === "otlp") {
    const endpoint =
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const otlpHeaders = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

    const otlpExporter = new OTLPTraceExporter({
      ...(endpoint ? { url: endpoint } : {}),
      ...(otlpHeaders ? { headers: otlpHeaders } : {}),
    });

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      status: "INFO",
      timestamp: new Date().toISOString(),
      endpoint: "startup",
      message: "OTEL trace exporter enabled (OTEL_TRACES_EXPORTER=otlp).",
    }));
    return [new SimpleSpanProcessor(otlpExporter)];
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    status: "INFO",
    timestamp: new Date().toISOString(),
    endpoint: "startup",
    message: "OTEL trace exporter enabled (console).",
  }));

  return [new SimpleSpanProcessor(new ConsoleSpanExporter())];
}

function getTraceContext() {
  const activeSpan = trace.getActiveSpan();
  const spanContext = activeSpan?.spanContext();
  return {
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
  };
}

export function traceparentFromSpanContext(spanContext) {
  if (!spanContext) {
    return null;
  }
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return {
      name: "Error",
      message: error,
    };
  }

  return {
    name: "UnknownError",
    message: "Unknown error.",
    value: error,
  };
}

export function logEvent({ status, endpoint, message, event, traceId, spanId, httpStatusCode, error, userData }) {
  const activeTrace = getTraceContext();
  const payload = {
    status,
    timestamp: new Date().toISOString(),
    ...(event !== undefined ? { event } : {}),
    endpoint,
    message,
    traceId: traceId ?? activeTrace.traceId ?? null,
    spanId: spanId ?? activeTrace.spanId ?? null,
    ...(typeof httpStatusCode === "number" ? { httpStatusCode } : {}),
    ...(error !== undefined ? { error: serializeError(error) } : {}),
    ...(userData !== undefined ? { userData } : {}),
  };

  // eslint-disable-next-line no-console
  console.log(formatLogLine(status, payload));
}

export function mapHttpStatusToLogLevel(statusCode) {
  if (statusCode >= 500) return "ERROR";
  if (statusCode >= 400) return "WARNING";
  return "INFO";
}

export function configureTelemetry() {
  const tracerProvider = new NodeTracerProvider({
    spanProcessors: buildSpanProcessors(),
  });

  tracerProvider.register();

  const tracer = trace.getTracer("agent-api", "1.0.0");
  const baseFetch = globalThis.fetch.bind(globalThis);

  // Wrap global fetch once so every outbound HTTP call carries OTEL context.
  globalThis.fetch = async function otelFetch(input, init = {}) {
    const method = String(
      init.method || (typeof input === "object" && input !== null && "method" in input ? input.method : "GET"),
    ).toUpperCase();
    const endpoint =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    const span = tracer.startSpan(`HTTP ${method}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.request.method": method,
        "url.full": endpoint,
      },
    });

    const spanContext = trace.setSpan(context.active(), span);

    return context.with(spanContext, async () => {
      const carrier = {};
      propagation.inject(context.active(), carrier);

      const headers = new Headers(
        init.headers
        || (typeof input === "object" && input !== null && "headers" in input ? input.headers : undefined),
      );

      for (const [key, value] of Object.entries(carrier)) {
        if (typeof value === "string") {
          headers.set(key, value);
        }
      }

      try {
        const response = await baseFetch(input, {
          ...init,
          headers,
        });

        span.setAttribute("http.response.status_code", response.status);
        span.setStatus(
          response.status >= 400
            ? { code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` }
            : { code: SpanStatusCode.OK },
        );

        logEvent({
          status: mapHttpStatusToLogLevel(response.status),
          endpoint,
          message: `Outbound ${method} response status ${response.status}`,
          httpStatusCode: response.status,
        });

        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown outbound request error.";
        span.recordException(error instanceof Error ? error : new Error(message));
        span.setStatus({ code: SpanStatusCode.ERROR, message });

        logEvent({
          status: "ERROR",
          endpoint,
          message: `Outbound ${method} failed: ${message}`,
          error,
        });

        throw error;
      } finally {
        span.end();
      }
    });
  };

  return {
    tracer,
  };
}

function redactSecretsInString(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  return value
    .replace(/\bsk-or-v1-[A-Za-z0-9_-]{16,}\b/g, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, `Bearer ${REDACTED}`)
    .replace(/\b[A-Za-z0-9._%+-]+:[^\s@]{8,}@/g, `${REDACTED}@`)
    .replace(/\b(x-api-key|api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, `$1=${REDACTED}`);
}

function summarizeConfidentialValue(value) {
  if (typeof value === "string") {
    return `[REDACTED_TEXT length=${value.length}]`;
  }
  if (Array.isArray(value)) {
    return `[REDACTED_ARRAY length=${value.length}]`;
  }
  if (value && typeof value === "object") {
    return `[REDACTED_OBJECT keys=${Object.keys(value).length}]`;
  }
  return REDACTED;
}

function sanitizeForLogging(value, key = "") {
  if (value === null || value === undefined) {
    return value;
  }

  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (CONFIDENTIAL_CONTENT_KEY_PATTERN.test(key)) {
    return summarizeConfidentialValue(value);
  }

  if (typeof value === "string") {
    return redactSecretsInString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogging(entry, key));
  }

  if (typeof value === "object") {
    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeForLogging(childValue, childKey);
    }
    return sanitized;
  }

  return value;
}