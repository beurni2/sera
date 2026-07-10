#!/usr/bin/env node
// WO-1.3/WO-2.4 DoD: the eligibility-consumer + door-payment-emitter mocks certified 8/8
// via the pinned @platform/certification suite. The certification test
// prints formatScorecard; this runner executes it — a pass IS vitest exit 0
// (no output grepping: scorecards legitimately contain the word "failed").
import { execSync } from 'node:child_process';
try {
  const out = execSync('pnpm vitest run test/eligibility-consumer-certification.test.ts test/door-flow.test.ts 2>&1', {
    cwd: 'services/custody-service', encoding: 'utf8',
  });
  process.stdout.write(out.split('\n').filter((l) => !/^\s*$/.test(l)).join('\n') + '\n');
} catch (e) {
  console.error(String(e.stdout ?? e.message));
  process.exit(1);
}
