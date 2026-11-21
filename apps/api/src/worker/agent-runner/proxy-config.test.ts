import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const conf = readFileSync(path.resolve(__dirname, '../../../../../docker/proxy/squid.conf'), 'utf8');
const rules = conf.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

describe('squid.conf allowlist', () => {
  it('listens on 3128 for every stage and on 3129 for the Jira connector stage only', () => {
    expect(rules.filter((r) => r.startsWith('http_port'))).toEqual(['http_port 3128', 'http_port 3129']);
  });

  it('allows only the Prisma binary host on the base port (Anthropic goes through the LLM gateway, npm through the read-only mirror)', () => {
    expect(rules).toContain('acl base_domains dstdomain binaries.prisma.sh');
    expect(rules.filter((r) => r.includes('base_domains')).join('\n')).not.toMatch(/anthropic|npmjs|claude/i);
    expect(rules.filter((r) => r.startsWith('http_access allow') && r.includes('port_base'))).toEqual(['http_access allow port_base base_domains']);
  });

  it('lets the connector port reach Anthropic and claude.ai only, never Atlassian directly', () => {
    expect(rules).toContain('acl port_connector localport 3129');
    expect(rules).toContain('acl connector_domains dstdomain api.anthropic.com claude.ai platform.claude.com mcp-proxy.anthropic.com');
    expect(rules.filter((r) => r.startsWith('http_access allow') && r.includes('port_connector'))).toEqual(['http_access allow port_connector connector_domains']);
    expect(rules.join('\n')).not.toMatch(/atlassian|jira|npmjs/i);
  });

  it('only tunnels to port 443 and denies everything else, last', () => {
    expect(rules).toContain('http_access deny connect_method !ssl_ports');
    const access = rules.filter((r) => r.startsWith('http_access'));
    expect(access.at(-1)).toBe('http_access deny all');
  });
});
