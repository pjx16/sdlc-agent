import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedHost } from './lib/host-allowlist';

/** Refuses requests whose Host header is not one of ours (DNS rebinding against a dashboard bound to 127.0.0.1). */
export function proxy(request: NextRequest): NextResponse {
  if (isAllowedHost(request.headers.get('host'))) return NextResponse.next();
  return new NextResponse('Unknown host. Add it to ALLOWED_HOSTS in .env if this is your address.', { status: 421 });
}

export const config = { matcher: '/((?!_next/static|_next/image).*)' };
