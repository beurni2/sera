// NEGATIVE FIXTURE: recruitment/downline mechanics — the single-level gate
// MUST fail on this file. Never import this.
export interface ResellerNetwork {
  resellerId: string;
  downline: string[]; // banned: B+I-10 single-level only
  uplineId?: string;
}
export function recruitReseller(network: ResellerNetwork, newId: string): void {
  network.downline.push(newId);
}

// Additional English shapes — one per otherwise-unexercised pattern.
export const mlm = true; // banned
export const multiLevel = true; // banned
export const networkDepth = 3; // banned
export const referralCode = 'x'; // banned
export const sponsorTree = {}; // banned
