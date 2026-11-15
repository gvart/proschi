/** Certificate ids: 12 base64url characters (backend/src/certificates.ts). */
const ID = /^[A-Za-z0-9_-]{12}$/;

/** The certificate id of a practice route `c/<id>`; '' for a malformed one, undefined for another route. */
export function certificateIdOf(route: string): string | undefined {
  if (!route.startsWith('c/')) return undefined;
  const id = route.slice(2);
  return ID.test(id) ? id : '';
}

/** The practice page served at a certificate's own address, `/c/<id>`, shows `#/c/<id>`: the address it should have, or undefined. */
export function certificateAddressOf(pathname: string): string | undefined {
  const id = /^\/c\/([A-Za-z0-9_-]{12})\/?$/.exec(pathname)?.[1];
  return id ? `/practice/#/c/${id}` : undefined;
}
