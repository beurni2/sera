// NEGATIVE FIXTURE — money taken back from someone who sells or delivers.
// Their consequences are ACCESS-BASED; losses ride the Protection Fund. This
// gate MUST fail on this file. Never import this.
export const clawbackFcfa = 100; // banned
export function garnishEarnings(): void {} // banned
export const sellerCharge = 100; // banned
export function chargeSeller(): void {} // banned
export function deductFromSeller(): void {} // banned
export const sellerDebit = 100; // banned
export function debitRider(): void {} // banned

// One line per otherwise-unexercised pattern — a pattern nothing tests can be
// deleted without CI noticing.
export const prelevementSurGains = 100; // banned
export const sellerCharge = 100; // banned
export function chargeSeller(): void {} // banned
export function garnishEarnings(): void {} // banned
