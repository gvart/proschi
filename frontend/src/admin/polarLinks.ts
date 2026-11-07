import type { PolarDashboard } from './api';

/**
 * Deep links into Polar's dashboard, from the bases GET /api/admin/billing and
 * /users/<id> send (backend/src/admin.ts polarDashboard). Checked against
 * Polar's web app (clients/apps/web, `app/(main)/to/[...path]` and
 * `dashboard/[organization]/(header)/…`): `/to/dashboard/<rest>` redirects
 * the signed-in user to `/dashboard/<their org>/<rest>`, the same on
 * sandbox.polar.sh and polar.sh, and the pages are `customers/<id>`,
 * `sales/<order id>` and `sales/subscriptions/<id>`.
 */
const join = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`;

export const polarCustomerUrl = (d: PolarDashboard, customerId: string) => join(d.customers, customerId);
export const polarOrderUrl = (d: PolarDashboard, orderId: string) => join(d.orders, orderId);
export const polarSubscriptionUrl = (d: PolarDashboard, subscriptionId: string) => join(d.subscriptions, subscriptionId);
