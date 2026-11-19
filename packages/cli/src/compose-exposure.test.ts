import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoFile = (relative: string): string => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

/** Reads a repository file with comment lines removed, so prose cannot satisfy or break a check. */
function readWithoutComments(relative: string): string {
  return readFileSync(repoFile(relative), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/** Returns the text of one top-level service block (from its key to the next service or top-level key). */
function serviceBlock(yaml: string, service: string): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) throw new Error(`service ${service} not found`);
  const length = lines.slice(start + 1).findIndex((line) => /^ {0,2}\S/.test(line));
  return lines.slice(start, length === -1 ? undefined : start + 1 + length).join('\n');
}

describe('postgres network exposure', () => {
  it('does not publish any port for postgres in docker-compose.yml', () => {
    const block = serviceBlock(readWithoutComments('docker-compose.yml'), 'postgres');
    expect(block).not.toMatch(/^\s*ports:/m);
  });

  it('does not publish any port for postgres in deploy/docker-compose.yml', () => {
    const block = serviceBlock(readWithoutComments('deploy/docker-compose.yml'), 'postgres');
    expect(block).not.toMatch(/^\s*ports:/m);
  });

  it('maps postgres only on 127.0.0.1 with POSTGRES_PORT in docker-compose.dev.yml', () => {
    expect(existsSync(repoFile('docker-compose.dev.yml'))).toBe(true);
    const block = serviceBlock(readWithoutComments('docker-compose.dev.yml'), 'postgres');
    const mappings = [...block.matchAll(/^\s*-\s*"?([^"\n]+)"?\s*$/gm)].map((m) => m[1]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatch(/^127\.0\.0\.1:\$\{POSTGRES_PORT(:-\d+)?\}:5432$/);
  });

  it('exports COMPOSE_FILE with the dev overlay in scripts/dev.sh', () => {
    const script = readWithoutComments('scripts/dev.sh');
    expect(script).toMatch(/^export COMPOSE_FILE=docker-compose\.yml:docker-compose\.dev\.yml\s*$/m);
  });

  it.each(['docker-compose.yml', 'deploy/docker-compose.yml'])(
    'keeps postgres on the internal network only and not on agent_net in %s',
    (file) => {
      const block = serviceBlock(readWithoutComments(file), 'postgres');
      expect(block).toMatch(/networks:\s*\[internal\]/);
      expect(block).not.toContain('agent_net');
    },
  );

  it.each(['docker-compose.yml', 'deploy/docker-compose.yml'])(
    'keeps the api and worker DATABASE_URL on postgres:5432 in %s',
    (file) => {
      const yaml = readWithoutComments(file);
      for (const service of ['api', 'worker']) {
        expect(serviceBlock(yaml, service)).toMatch(/DATABASE_URL:.*@postgres:5432\//);
      }
    },
  );
});

describe('postgres network posture documentation', () => {
  const psql = 'docker compose exec postgres psql -U sdlc sdlc';
  const read = (relative: string): string => readFileSync(repoFile(relative), 'utf8');

  it.each(['README.md', 'docs/kb/database.md'])('shows the prod psql command in %s', (file) => {
    expect(read(file).includes(psql)).toBe(true);
  });

  it.each(['README.md', 'SECURITY.md', 'docs/kb/database.md'])(
    'mentions the dev-only overlay in %s',
    (file) => {
      expect(read(file).includes('docker-compose.dev.yml')).toBe(true);
    },
  );

  it('no longer documents the published 127.0.0.1:5432 mapping in the knowledge base', () => {
    const kb = read('docs/kb/database.md');
    expect(kb.includes('127.0.0.1:5432:5432')).toBe(false);
    expect(kb.includes('${POSTGRES_PORT:-5432}')).toBe(false);
  });

  it('calls out the breaking change for host connections in the unreleased changelog', () => {
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## [Unreleased]'), changelog.indexOf('\n## [', changelog.indexOf('## [Unreleased]') + 1));
    expect(/127\.0\.0\.1:5432/.test(unreleased)).toBe(true);
    expect(/breaking/i.test(unreleased)).toBe(true);
  });
});

describe('docker access and agent network hardening', () => {
  it.each(['docker-compose.yml', 'deploy/docker-compose.yml'])('gives the worker no Docker socket, only docker-proxy, in %s', (file) => {
    const yaml = readWithoutComments(file);
    expect(serviceBlock(yaml, 'worker')).not.toContain('docker.sock');
    expect(serviceBlock(yaml, 'worker')).toContain('DOCKER_HOST: tcp://docker-proxy:2375');
    expect(serviceBlock(yaml, 'docker-proxy')).toContain('/var/run/docker.sock');
    // Its own network, shared with the worker only: the api and dashboard (on internal) cannot reach it.
    expect(serviceBlock(yaml, 'docker-proxy')).toMatch(/networks:\s*\[docker_api\]/);
    expect(serviceBlock(yaml, 'worker')).toMatch(/docker_api:/);
    for (const other of ['api', 'dashboard', 'postgres', 'proxy', 'npm-mirror']) expect(serviceBlock(yaml, other), other).not.toContain('docker_api');
    expect(yaml).toMatch(/\n {2}docker_api:\s*\n\s*internal: true/);
    expect(serviceBlock(yaml, 'docker-proxy')).toContain('ALLOWED_BIND_ROOTS');
    expect(serviceBlock(yaml, 'docker-proxy')).toContain('ALLOWED_IMAGES');
  });

  it.each(['docker-compose.yml', 'deploy/docker-compose.yml'])('runs every service with no-new-privileges in %s', (file) => {
    const yaml = readWithoutComments(file);
    for (const svc of ['postgres', 'api', 'worker', 'docker-proxy', 'dashboard', 'proxy', 'npm-mirror']) expect(serviceBlock(yaml, svc), svc).toMatch(/<<: \*(nnp|unprivileged)/);
  });

  it('builds the agent image locally in a release install instead of pulling a published one', () => {
    const yaml = readWithoutComments('deploy/docker-compose.yml');
    expect(yaml).not.toContain('sdlc-agent-agent');
    expect(serviceBlock(yaml, 'agent-image')).toContain('context: ./docker/agent');
    expect(serviceBlock(yaml, 'worker')).toContain('AGENT_IMAGE: ${AGENT_IMAGE:-sdlc-agent/agent:${SDLC_VERSION}}');
  });

  it.each(['docker-compose.yml', 'deploy/docker-compose.yml'])('answers agents as llm-gateway on the agent network, and offers the npm mirror there, in %s', (file) => {
    const yaml = readWithoutComments(file);
    expect(serviceBlock(yaml, 'worker')).toMatch(/agent_net:\s*\n\s*aliases:\s*\[llm-gateway\]/);
    expect(serviceBlock(yaml, 'npm-mirror')).toMatch(/networks:\s*\[agent_net, egress\]/);
  });

  it('ships the docker-proxy and npm-mirror images with every release', () => {
    const release = readFileSync(repoFile('.github/workflows/release.yml'), 'utf8');
    for (const name of ['docker-proxy', 'npm-mirror']) {
      expect(release).toContain(`name: ${name},`);
      expect(readFileSync(repoFile('deploy/docker-compose.yml'), 'utf8')).toContain(`sdlc-agent-${name}:`);
    }
  });
});
