import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000', ...headers } });

describe('proxy', () => {
  it('tells the server components which page was asked for', () => {
    const res = proxy(request('/tickets/abc?tab=plan'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe('/tickets/abc');
  });

  it('replaces an x-pathname sent by the browser', () => {
    const res = proxy(request('/tickets', { 'x-pathname': '/setup/connections' }));
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe('/tickets');
  });

  it('still refuses a host that is not ours', () => {
    expect(proxy(request('/', { host: 'evil.example' })).status).toBe(421);
  });
});
