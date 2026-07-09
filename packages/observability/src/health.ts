import { CORRELATION_HEADER, correlationIdFrom, createLogger, type LogSink } from './logger.js';

/**
 * Shared /health handler for the E0 Workers service stubs — folders,
 * types, health endpoints; no features. The hello-world request carries the
 * correlation id end-to-end: inbound header → structured log → response
 * header (Contract E0 exit).
 */
export function makeHealthFetch(service: string, sink?: LogSink) {
  return (request: Request): Response => {
    const correlationId = correlationIdFrom(request);
    const logger = sink
      ? createLogger({ service, correlationId, sink })
      : createLogger({ service, correlationId });
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      logger.info('health check', { path: url.pathname });
      return Response.json(
        { service, status: 'ok' },
        { headers: { [CORRELATION_HEADER]: correlationId } },
      );
    }
    logger.warn('route not found', { path: url.pathname });
    return Response.json(
      { service, status: 'not_found' },
      { status: 404, headers: { [CORRELATION_HEADER]: correlationId } },
    );
  };
}
