import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');

/** Reads a file relative to the repository root, or returns an empty string when it is missing so the assertion fails instead of the read. */
const read = (file: string): string => {
  const full = path.join(ROOT, file);
  return existsSync(full) ? readFileSync(full, 'utf8') : '';
};

// Assertions are on booleans so a failure never prints a whole file (its text could match runner-error patterns).
describe('docs/TRACKER.md documentation', () => {
  it('exists in docs/', () => {
    expect(existsSync(path.join(ROOT, 'docs/TRACKER.md'))).toBe(true);
  });

  it('is linked from README.md with a relative markdown link', () => {
    expect(/\]\((\.\/)?docs\/TRACKER\.md(#[^)]*)?\)/.test(read('README.md'))).toBe(true);
  });

  it('is mentioned in an Added bullet under [Unreleased] in CHANGELOG.md', () => {
    const unreleased = read('CHANGELOG.md').split(/^## \[/m).find((part) => part.startsWith('Unreleased]')) ?? '';
    const added = unreleased.split(/^### /m).find((part) => part.startsWith('Added')) ?? '';
    expect(/^\s*- .*TRACKER\.md/m.test(added)).toBe(true);
  });

  it('links to docs/kb/tracker.md', () => {
    expect(/\]\((\.\/)?kb\/tracker\.md(#[^)]*)?\)/.test(read('docs/TRACKER.md'))).toBe(true);
  });

  it('uses only the placeholder Jira URL and contains no token-like strings', () => {
    const text = read('docs/TRACKER.md');
    expect(text.length > 0).toBe(true);
    const urls = text.match(/https?:\/\/[^\s)>"'`\]]+/g) ?? [];
    for (const url of urls) {
      expect(new URL(url).host, url).toBe('your-site.atlassian.net');
    }
    expect(/ATATT[A-Za-z0-9_\-=]{20,}/.test(text)).toBe(false);
    expect(/JIRA_API_TOKEN=\s*[^\s`]/.test(text)).toBe(false);
    expect(/[A-Za-z0-9+/=_-]{32,}/.test(text)).toBe(false);
  });

  describe.each([
    ['setup', /^#{2,3} .*setup/im],
    ['ticket selection', /^#{2,3} .*(which tickets|ticket selection|picked up)/im],
    ['approvals', /^#{2,3} .*approvals?/im],
    ['write-back', /^#{2,3} .*write-?back/im],
    ['failure behaviour', /^#{2,3} .*failures?/im],
    ['credential boundary', /^#{2,3} .*credential/im],
  ])('section: %s', (_name, heading) => {
    it('has its own heading in docs/TRACKER.md', () => {
      expect(heading.test(read('docs/TRACKER.md'))).toBe(true);
    });
  });

  it('links to README.md and SECURITY.md', () => {
    const text = read('docs/TRACKER.md');
    expect(/\]\((\.\.\/)README\.md(#[^)]*)?\)/.test(text)).toBe(true);
    expect(/\]\((\.\.\/)SECURITY\.md(#[^)]*)?\)/.test(text)).toBe(true);
  });
});
