import { readCheckoutReturn, type CheckoutReturn } from '../../pricing/checkoutReturn';

/** The return from a checkout (CheckoutStatus.tsx), read once a page load: the address forgets it once the purchase shows. */
let returned: CheckoutReturn | null | undefined;

export const checkoutReturn = (): CheckoutReturn | null => (returned ??= readCheckoutReturn(window.location.href));

/** Whether this page load came back from a checkout: the settings page then shows its status at the top. */
export const checkoutReturned = (): boolean => checkoutReturn() !== null;
