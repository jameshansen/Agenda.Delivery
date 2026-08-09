/**
 * Structured logging with correlation IDs for agent runs.
 *
 * In development, logs go to stdout as plain strings (readable).
 * In production, logs are JSON with level, timestamp, runId, and
 * correlation context so they can be collected by Datadog/Loki/etc.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  runId?: string;
  moduleId?: string;
  agent?: string;
  trigger?: string;
  [key: string]: unknown;
};

function formatLog(level: LogLevel, msg: string, ctx?: LogContext): string {
  const timestamp = new Date().toISOString();

  if (process.env.NODE_ENV === "production") {
    // JSON format for log aggregators
    return JSON.stringify({
      level,
      msg,
      timestamp,
      ...ctx,
    });
  }

  // Readable format for dev
  const prefix = ctx?.agent ? `[${ctx.agent}]` : "";
  const runId = ctx?.runId ? `(${ctx.runId.slice(0, 8)})` : "";
  return `${timestamp} ${level.toUpperCase()} ${prefix}${runId} ${msg}`;
}

export const log = {
  debug: (msg: string, ctx?: LogContext) => {
    if (process.env.DEBUG || process.env.NODE_ENV !== "production") {
      console.debug(formatLog("debug", msg, ctx));
    }
  },
  info: (msg: string, ctx?: LogContext) => {
    console.info(formatLog("info", msg, ctx));
  },
  warn: (msg: string, ctx?: LogContext) => {
    console.warn(formatLog("warn", msg, ctx));
  },
  error: (msg: string, ctx?: LogContext) => {
    console.error(formatLog("error", msg, ctx));
  },
};