// NEGATIVE FIXTURE (SERA-S1): a planted mint-path offender that draws its
// idempotency key from Math.random — the mint-path-entropy gate MUST fail on this.
// Not real code; never imported. Proves the gate is non-vacuous.
export function mintCommandId() {
  return 'cmd-' + Math.random().toString(16).slice(2);
}
