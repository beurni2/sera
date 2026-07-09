import type { Quote } from '@platform/contracts';

/**
 * SeraDeliveryView (SE-I09 / §5.4): "Séra sees deliveryFee and (Option B)
 * amountDueAtDelivery for the doorstep flow — never commission or splits."
 * This projection is the ONLY money surface Séra code may carry; commission,
 * nets, fees, and splits are structurally absent from the type.
 */
export interface SeraDeliveryView {
  orderQuoteId: string;
  paymentMode: Quote['paymentMode'];
  deliveryFeeFcfa: number;
  /** 0 under FULL_PREPAY; productSubtotal under Option B — read, never derived here. */
  amountDueAtDeliveryFcfa: number;
}

export function toSeraDeliveryView(quote: Quote): SeraDeliveryView {
  return {
    orderQuoteId: quote.id,
    paymentMode: quote.paymentMode,
    deliveryFeeFcfa: quote.deliveryFee,
    amountDueAtDeliveryFcfa: quote.amountDueAtDelivery,
  };
}
