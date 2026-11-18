/** Name of the dashboard session cookie, shared by the API (sets it) and the dashboard (reads it). */
export const SESSION_COOKIE = 'sdlc_session';
/** Used instead when COOKIE_SECURE=true: the `__Host-` prefix makes browsers accept the cookie only if it is Secure, has Path=/ and no Domain. */
export const HOST_SESSION_COOKIE = '__Host-sdlc_session';
/** The session cookie a request carries, under either name (the prefixed one wins), as `{ name, value }`. */
export function pickSessionCookie(get: (name: string) => string | undefined): { name: string; value: string } | null {
  for (const name of [HOST_SESSION_COOKIE, SESSION_COOKIE]) {
    const value = get(name);
    if (value) return { name, value };
  }
  return null;
}
