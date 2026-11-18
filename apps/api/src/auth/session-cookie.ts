import type { Response } from 'express';
import { HOST_SESSION_COOKIE, SESSION_COOKIE } from './constants';
import { SESSION_TTL_MS } from './session.service';

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(secure ? HOST_SESSION_COOKIE : SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_TTL_MS, path: '/' });
}
