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
