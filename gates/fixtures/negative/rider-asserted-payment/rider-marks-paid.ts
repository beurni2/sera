// PLANTED NEGATIVE FIXTURE — a rider-asserted payment surface: the rider
// "confirms" a cash payment and the door state is written by hand, without
// any provider signal. The no-rider-asserted-payment gate must catch BOTH.
export function riderMarksPaid(spine: Record<string, unknown>): void {
  const riderSaysBuyerPaid = true; // screenshot shown at the door
  if (riderSaysBuyerPaid) {
    (spine as { doorPaymentConfirmed: boolean }).doorPaymentConfirmed = true;
  }
}
