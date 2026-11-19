import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_DIR = resolve(__dirname, '..');

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Reads a UTF-8 file relative to apps/api. */
function readApiFile(relativePath: string): string {
  return readFileSync(resolve(API_DIR, relativePath), 'utf8');
}

/** Parses apps/api/package.json. */
function readApiPackageJson(): PackageJson {
  return JSON.parse(readApiFile('package.json')) as PackageJson;
}

describe('api package.json', () => {
  it('lists prisma under dependencies so the runtime image has the migrate CLI', () => {
    expect(readApiPackageJson().dependencies).toHaveProperty('prisma');
  });

  it('does not list prisma under devDependencies', () => {
    expect(readApiPackageJson().devDependencies ?? {}).not.toHaveProperty('prisma');
  });
});

const BASE_IMAGE =
  'node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54';

interface DockerStage {
  name: string;
  from: string;
  lines: string[];
}

/** Splits a Dockerfile into stages, joining continuation lines and dropping comments. */
function parseDockerStages(dockerfile: string): DockerStage[] {
  const lines = dockerfile
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const stages: DockerStage[] = [];
  for (const line of lines) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      stages.push({ name: from[2] ?? '', from: from[1] ?? '', lines: [] });
    } else {
      stages[stages.length - 1]?.lines.push(line);
    }
  }
  return stages;
}

/** Returns the instructions of a stage that start with the given keyword. */
function instructions(stage: DockerStage, keyword: string): string[] {
  return stage.lines.filter((line) => line.toUpperCase().startsWith(`${keyword} `));
}

/** Returns the stage a COPY instruction reads from, if it uses --from. */
function copySource(line: string): string | undefined {
  return /--from=(\S+)/.exec(line)?.[1];
}

describe('api Dockerfile', () => {
  const stages = parseDockerStages(readApiFile('Dockerfile'));
  const finalStage = stages[stages.length - 1] as DockerStage;
  const depsStage = stages.find((stage) => stage.name === 'deps');
  const finalCopies = instructions(finalStage, 'COPY');

  it('has a build, a deps and a runtime stage', () => {
    expect(stages.length).toBeGreaterThanOrEqual(3);
    expect(stages.some((stage) => stage.name === 'build')).toBe(true);
    expect(depsStage).toBeDefined();
  });

  it('installs production dependencies only in the deps stage', () => {
    const installs = instructions(depsStage as DockerStage, 'RUN').filter((line) =>
      line.includes('npm ci'),
    );
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain('--omit=dev');
    expect(installs[0]).toContain('--ignore-scripts');
    expect(installs[0]).toContain('-w @sdlc/api');
  });

  it('copies node_modules into the final stage from the deps stage', () => {
    const nodeModulesCopies = finalCopies.filter((line) => line.includes('node_modules'));
    expect(nodeModulesCopies.length).toBeGreaterThan(0);
    for (const line of nodeModulesCopies) {
      expect(copySource(line)).toBe('deps');
    }
  });

  it('copies prisma, prisma.config.ts, dist and the entrypoint into the final stage', () => {
    const joined = finalCopies.join('\n');
    expect(joined).toMatch(/apps\/api\/prisma(\s|\/)/);
    expect(joined).toContain('apps/api/prisma.config.ts');
    expect(joined).toContain('apps/api/dist');
    expect(joined).toContain('apps/api/docker-entrypoint.sh');
    expect(joined).toContain('apps/api/package.json');
    expect(joined).toContain('packages/shared/dist');
    expect(joined).toContain('packages/shared/package.json');
  });

  it('uses COPY --chown=node:node and no recursive chown in the final stage', () => {
    expect(instructions(finalStage, 'RUN').some((line) => /chown\s+-R/.test(line))).toBe(false);
    expect(finalCopies.length).toBeGreaterThan(0);
    // The licence and notices under /usr/share/doc stay root-owned: the app only reads them.
    for (const line of finalCopies.filter((l) => !l.includes('/usr/share/doc/'))) {
      expect(line).toContain('--chown=node:node');
    }
  });

  it('keeps USER node, EXPOSE 4000 and WORKDIR /app/apps/api in the final stage', () => {
    expect(instructions(finalStage, 'USER')).toEqual(['USER node']);
    expect(instructions(finalStage, 'EXPOSE')).toEqual(['EXPOSE 4000']);
    expect(instructions(finalStage, 'WORKDIR')).toContain('WORKDIR /app/apps/api');
  });

  it('keeps the environment and entrypoint of the final stage', () => {
    const env = instructions(finalStage, 'ENV').join(' ');
    expect(env).toContain('NODE_ENV=production');
    expect(env).toContain('PORT=4000');
    expect(instructions(finalStage, 'ENTRYPOINT')).toEqual([
      'ENTRYPOINT ["sh", "/app/apps/api/docker-entrypoint.sh"]',
    ]);
  });

  it('uses the unchanged pinned base image in every FROM', () => {
    for (const stage of stages) {
      expect(stage.from).toBe(BASE_IMAGE);
    }
  });

  it('does not copy the dashboard or the api sources into the final stage', () => {
    for (const line of finalCopies) {
      expect(line).not.toContain('apps/dashboard');
      expect(line).not.toContain('apps/api/src');
      expect(line).not.toMatch(/\sapps\/api\/?\s+\S+$/);
    }
  });
});

describe('worker Dockerfile', () => {
  const stages = parseDockerStages(readFileSync(resolve(API_DIR, '../../docker/worker/Dockerfile'), 'utf8'));
  const finalStage = stages[stages.length - 1] as DockerStage;
  const depsStage = stages.find((stage) => stage.name === 'deps');
  const finalRuns = instructions(finalStage, 'RUN');
  const ghRun = finalRuns.find((line) => /apt-get install[^&]*\bgh\b/.test(line));

  it('has a build, a deps and a runtime stage', () => {
    expect(stages.length).toBeGreaterThanOrEqual(3);
    expect(stages.some((stage) => stage.name === 'build')).toBe(true);
    expect(depsStage).toBeDefined();
  });

  it('copies node_modules into the final stage from a deps stage installed with --omit=dev', () => {
    const installs = instructions(depsStage as DockerStage, 'RUN').filter((line) =>
      line.includes('npm ci'),
    );
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain('--omit=dev');
    expect(installs[0]).toContain('--ignore-scripts');
    const copies = instructions(finalStage, 'COPY').filter((line) => line.includes('node_modules'));
    expect(copies.length).toBeGreaterThan(0);
    for (const line of copies) {
      expect(copySource(line)).toBe('deps');
    }
  });

  it('copies dist and the shared package into the final stage but no sources or dashboard', () => {
    const copies = instructions(finalStage, 'COPY');
    const joined = copies.join('\n');
    expect(joined).toContain('apps/api/dist');
    expect(joined).toContain('apps/api/package.json');
    expect(joined).toContain('packages/shared/dist');
    for (const line of copies) {
      expect(line).not.toContain('apps/dashboard');
      expect(line).not.toContain('apps/api/src');
    }
  });

  it('still installs git and gh in the final stage', () => {
    const joined = finalRuns.join('\n');
    expect(joined).toMatch(/apt-get install[^&]*\bgit\b/);
    expect(ghRun).toBeDefined();
  });

  it('no longer installs gnupg', () => {
    expect(stages.flatMap((stage) => stage.lines).join('\n')).not.toContain('gnupg');
  });

  it('purges curl in the same RUN that installs gh', () => {
    expect(ghRun).toMatch(/apt-get (purge|remove)[^&]*\bcurl\b/);
    const run = ghRun as string;
    expect(run.search(/apt-get (purge|remove)/)).toBeGreaterThan(
      run.search(/apt-get install[^&]*\bgh\b/),
    );
  });

  it('keeps GIT_ASKPASS, git-askpass-token, and no system-wide safe.directory', () => {
    const lines = finalStage.lines.join('\n');
    expect(lines).toContain('GIT_ASKPASS=/usr/local/bin/git-askpass-token');
    expect(lines).toContain('GIT_TERMINAL_PROMPT=0');
    expect(lines).toMatch(/COPY docker\/worker\/git-askpass-token \/usr\/local\/bin\/git-askpass-token/);
    expect(lines).toContain('chmod +x /usr/local/bin/git-askpass-token');
    expect(lines).not.toContain('safe.directory');
  });

  it('runs as root with WORKDIR /app/apps/api and the worker command', () => {
    expect(instructions(finalStage, 'USER')).toEqual([]);
    expect(instructions(finalStage, 'WORKDIR')).toContain('WORKDIR /app/apps/api');
    expect(instructions(finalStage, 'CMD')).toEqual(['CMD ["node", "dist/worker.js"]']);
  });

  it('uses the unchanged pinned base image in every FROM', () => {
    for (const stage of stages) {
      expect(stage.from).toBe(BASE_IMAGE);
    }
  });
});

describe('CHANGELOG.md', () => {
  const changelog = readFileSync(resolve(API_DIR, '../../CHANGELOG.md'), 'utf8');
  const unreleased = changelog.split(/^## \[0\.0\.1\]/m)[0] ?? '';
  const changed = unreleased.split(/^### Changed$/m)[1]?.split(/^### /m)[0] ?? '';
  const entry = changed.split(/\r?\n/).filter((line) => /image/i.test(line) && /multi-stage/i.test(line));

  it('has one Unreleased "Changed" entry about multi-stage api and worker images', () => {
    expect(entry).toHaveLength(1);
    expect(entry[0]).toMatch(/^- /);
    expect(entry[0]).toMatch(/\bapi\b/i);
    expect(entry[0]).toMatch(/\bworker\b/i);
    expect(entry[0]).toMatch(/smaller/i);
  });

  it('says the images ship only production dependencies and prisma moved to api dependencies', () => {
    expect(entry[0]).toMatch(/production dependencies/i);
    expect(entry[0]).toMatch(/prisma/i);
    expect(entry[0]).toMatch(/dependencies/i);
  });
});
