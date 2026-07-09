// NEGATIVE FIXTURE: a wallet/balance module — the no-wallet-no-funds gate
// MUST fail on this file. Never import this.
export interface SupplierWallet {
  supplierId: string;
  balance: number; // banned: no app computes an independent balance
}
export function holdFunds(wallet: SupplierWallet, amount: number): void {
  wallet.balance -= amount;
}
