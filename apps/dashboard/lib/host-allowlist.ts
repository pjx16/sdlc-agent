/** Host names the dashboard answers to. Anything else (a DNS-rebinding page pointing its own name at 127.0.0.1) is refused. */
const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'dashboard'];

/** `host` is the Host header (with or without a port). `extra` is ALLOWED_HOSTS: comma-separated names, for example the public name behind a TLS proxy. */
export function isAllowedHost(host: string | null | undefined, extra: string | undefined = process.env.ALLOWED_HOSTS): boolean {
  if (!host) return false;
  const name = host.trim().toLowerCase().replace(/:\d+$/, '');
  const allowed = [...DEFAULT_HOSTS, ...(extra ?? '').split(',').map((h) => h.trim().toLowerCase().replace(/:\d+$/, '')).filter(Boolean)];
  return allowed.includes(name);
}
