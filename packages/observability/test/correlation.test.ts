import { describe, expect, it } from 'vitest';
import { CORRELATION_HEADER, createLogger, makeHealthFetch, type LogLine } from '../src/index.js';

// Contract E0 exit: "correlation IDs flow through a hello-world transaction".

describe('structured logger', () => {
  it('emits JSON lines with a correlation_id field on every line', () => {
    const lines: LogLine[] = [];
    const logger = createLogger({
      service: 'test-service',
      correlationId: 'corr-123',
      sink: (l) => lines.push(l),
    });
    logger.info('hello', { extra: 1 });
    logger.error('boom');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.correlation_id).toBe('corr-123');
      expect(line.service).toBe('test-service');
      expect(typeof line.ts).toBe('string');
    }
    expect(lines[0]?.extra).toBe(1);
    expect(lines[1]?.level).toBe('error');
  });
});

describe('hello-world request through a service stub', () => {
  it('carries the inbound correlation id: header → structured log → response header', () => {
    const lines: LogLine[] = [];
    const fetchHandler = makeHealthFetch('storefront-service', (l) => lines.push(l));
    const request = new Request('https://storefront.shop.internal/health', {
      headers: { [CORRELATION_HEADER]: 'hello-world-chain-1' },
    });
    const response = fetchHandler(request);
    expect(response.status).toBe(200);
    expect(response.headers.get(CORRELATION_HEADER)).toBe('hello-world-chain-1');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.correlation_id).toBe('hello-world-chain-1');
    expect(lines[0]?.msg).toBe('health check');
  });

  it('mints a correlation id when none arrives, so the chain always exists', () => {
    const lines: LogLine[] = [];
    const fetchHandler = makeHealthFetch('storefront-service', (l) => lines.push(l));
    const response = fetchHandler(new Request('https://storefront.shop.internal/health'));
    const echoed = response.headers.get(CORRELATION_HEADER);
    expect(echoed).toBeTruthy();
    expect(lines[0]?.correlation_id).toBe(echoed);
  });
});
