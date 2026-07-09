import { describe, expect, it } from 'vitest';
import worker, { SERVICE_NAME } from '../src/index.js';

describe(SERVICE_NAME, () => {
  it('serves /health and names itself', async () => {
    const res = worker.fetch(new Request('https://custody-service.sera.internal/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ service: SERVICE_NAME, status: 'ok' });
  });

  it('unknown routes are 404 — no features at this slice', () => {
    const res = worker.fetch(new Request('https://custody-service.sera.internal/anything'));
    expect(res.status).toBe(404);
  });
});
