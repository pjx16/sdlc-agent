import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedHost } from './lib/host-allowlist';

/**
 * Refuses requests whose Host header is not one of ours (DNS rebinding against a dashboard bound to 127.0.0.1). For the others it tells the
 * server components which page was asked for (`x-pathname`), which a layout cannot otherwise see. The header is set here, so one sent by the
 * browser is replaced.
 */
export function proxy(request: NextRequest): NextResponse {
  if (!isAllowedHost(request.headers.get('host'))) return new NextResponse('Unknown host. Add it to ALLOWED_HOSTS in .env if this is your address.', { status: 421 });
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/((?!_next/static|_next/image).*)' };
