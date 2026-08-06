// NEGATIVE FIXTURE: a wallet/balance module — the no-wallet-no-funds gate
// MUST fail on this file. Never import this.
export interface SupplierWallet {
  supplierId: string;
  balance: number; // banned: no app computes an independent balance
}
export function holdFunds(wallet: SupplierWallet, amount: number): void {
  wallet.balance -= amount;
}

// Additional English shapes — each exists so its pattern is EXERCISED. A pattern
// no fixture line matches can be deleted without CI noticing (verifier MAJOR 1);
// `fr-pattern-coverage` fails if any of these stop being covered.
export const escrowAccount = 'banned';
export function topUp(w: SupplierWallet, amount: number): void { w.balance += amount; }
export function withdrawFunds(w: SupplierWallet, amount: number): void { w.balance -= amount; }
