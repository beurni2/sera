/**
 * Structured logger (Execution Contract §6): one correlation chain per
 * transaction, plumbed from E0. Every log line is a single JSON object
 * carrying a `correlation_id` field — no free-text logging.
 */

export interface LogLine {
  ts: string;
  level: 'info' | 'warn' | 'error';
  correlation_id: string;
  service: string;
  msg: string;
  [field: string]: unknown;
}

export type LogSink = (line: LogLine) => void;

export interface Logger {
  readonly correlationId: string;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const defaultSink: LogSink = (line) => {
  console.log(JSON.stringify(line));
};

export function createLogger(options: {
  service: string;
  correlationId: string;
  sink?: LogSink;
}): Logger {
  const { service, correlationId, sink = defaultSink } = options;
  const emit = (level: LogLine['level'], msg: string, fields?: Record<string, unknown>): void => {
    sink({
      ts: new Date().toISOString(),
      level,
      correlation_id: correlationId,
      service,
      msg,
      ...fields,
    });
  };
  return {
    correlationId,
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

export const CORRELATION_HEADER = 'x-correlation-id';

/** Read the inbound correlation id, or mint one so the chain always exists. */
export function correlationIdFrom(request: Request): string {
  return request.headers.get(CORRELATION_HEADER) ?? crypto.randomUUID();
}
