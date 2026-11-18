import { pickSessionCookie } from '@sdlc/shared';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://api:4000';

/** Server-side check that the browser's session cookie is still valid. */
export async function hasValidSession(): Promise<boolean> {
  const jar = await cookies();
  const session = pickSessionCookie((n) => jar.get(n)?.value);
  if (!session) return false;
  try {
    const res = await fetch(`${API_URL}/auth/session`, {
      headers: { cookie: `${session.name}=${session.value}` },
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}
