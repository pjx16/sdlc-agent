export { HOST_SESSION_COOKIE, SESSION_COOKIE, pickSessionCookie } from '@sdlc/shared';
import { pickSessionCookie } from '@sdlc/shared';

/** The session token a request carries, from either cookie name. */
export const sessionTokenOf = (cookies: Record<string, string> | undefined): string | undefined => pickSessionCookie((n) => cookies?.[n])?.value;
