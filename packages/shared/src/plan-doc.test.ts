import { describe, expect, it } from 'vitest';
import { planDocPath, planFileUrl } from './plan-doc';

describe('planDocPath', () => {
  it('is inside the KB folder, named after the ticket, with a safe key', () => {
    expect(planDocPath('docs/kb', 'ABC-12')).toBe('docs/kb/plans/ABC-12.md');
    expect(planDocPath('docs/kb/', '../../etc/x')).toBe('docs/kb/plans/.._.._etc_x.md');
  });
});

describe('planFileUrl', () => {
  const base = { repoUrl: 'https://github.com/acme/billing', branch: 'feature/ABC-1-export', kbDir: 'docs/kb', key: 'ABC-1', status: 'IN_HUMAN_REVIEW' };
  it('links the file on the ticket branch once it is committed', () => {
    expect(planFileUrl(base)).toBe('https://github.com/acme/billing/blob/feature/ABC-1-export/docs/kb/plans/ABC-1.md');
    expect(planFileUrl({ ...base, repoUrl: 'https://github.com/acme/billing.git', status: 'AWAITING_CI' })).toContain('/acme/billing/blob/');
  });
  it('gives no link before the file exists, after the branch is gone, without a branch, or off github.com', () => {
    expect(planFileUrl({ ...base, status: 'PLANNING' })).toBeNull();
    expect(planFileUrl({ ...base, status: 'DONE' })).toBeNull();
    expect(planFileUrl({ ...base, branch: null })).toBeNull();
    expect(planFileUrl({ ...base, repoUrl: 'https://gitlab.com/a/b' })).toBeNull();
  });
});
