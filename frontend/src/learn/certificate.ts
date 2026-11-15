/**
 * The mastery certificate's links (Max; docs/design/paid-plans.md P56). Pure.
 */

/** The certificate's own address: `/c/<id>` on the site, which carries its link preview. */
export const certificateUrl = (origin: string, id: string): string => `${origin}/c/${encodeURIComponent(id)}`;

/**
 * LinkedIn's "Add licence or certification" form, filled in: the name,
 * Proschi as the issuer, the issue month and year, the certificate's address
 * and id (https://addtoprofile.linkedin.com).
 */
export function linkedInAddUrl(cert: { id: string; issuedAt: number }, url: string): string {
  const issued = new Date(cert.issuedAt * 1000);
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: 'System Design Mastery',
    organizationName: 'Proschi',
    issueYear: String(issued.getUTCFullYear()),
    issueMonth: String(issued.getUTCMonth() + 1),
    certUrl: url,
    certId: cert.id,
  });
  return `https://www.linkedin.com/profile/add?${params}`;
}
