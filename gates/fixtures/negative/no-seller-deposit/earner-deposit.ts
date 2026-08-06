// NEGATIVE FIXTURE — a deposit demanded of someone who SELLS or DELIVERS.
// Law 4 / standing guardrail: « zero seller deposit ». No field, no flow, no
// exception. This gate MUST fail on this file. Never import this.
export interface EarnerTerms {
  sellerDeposit: number; // banned
  resellerDeposit: number; // banned
  riderDeposit: number; // banned
  sellerReserve: number; // banned
  reserveBalance: number; // banned
}
export const depositFromSeller = 1; // banned
export const securityBond = 0; // banned
export const riderBond = 0; // banned
export const onboardingFee = 2000; // banned
export const subscriptionFee = 500; // banned
export const signupFee = 500; // banned
