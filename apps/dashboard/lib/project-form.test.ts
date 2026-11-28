import { DEFAULT_PROJECT_SETTINGS, ProjectInputSchema, STACK_PREFILLS } from '@sdlc/shared';
import { describe, expect, it } from 'vitest';
import { applyStackChange, initialValues, toPayload } from './project-form';
import type { ProjectView } from './types';

const project: ProjectView = {
  id: 'p1', name: 'Billing', repoUrl: 'https://github.com/a/b', baseBranch: 'dev', stack: 'nestjs', installCmd: 'npm ci',
  typecheckCmd: '', testCmdTemplate: 'npx jest {files}', kbDir: 'docs/kb', claudeMdMode: 'both',
  localKeyPrefix: 'BILL', enabled: true, mirrorStatus: 'ok', mirrorError: null,
  nextLocalNumber: 1, createdAt: '', updatedAt: '',
  settings: { ...DEFAULT_PROJECT_SETTINGS, github: { ...DEFAULT_PROJECT_SETTINGS.github, approval: { ...DEFAULT_PROJECT_SETTINGS.github.approval, plan: 'Plan OK' } } },
};

describe('initialValues', () => {
  it('prefills a new project from the ts_node stack and the schema defaults', () => {
    const v = initialValues() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(v).toMatchObject({ stack: 'ts_node', baseBranch: 'dev', ...STACK_PREFILLS.ts_node, enabled: true });
    expect(v.settings.stages.solutionDesign).toEqual({ enabled: true, model: 'opus', maxTurns: '15' });
    expect(v.settings.limits.maxSubtasks).toBe('8');
    expect(v.settings.verify.redInvalidPatterns).toBe('Cannot find module\nSyntaxError\nerror TS[0-9]+');
  });

  it('loads an existing project, using empty text for unset optional values', () => {
    const v = initialValues(project) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(v.settings.github.approval).toEqual({ plan: 'Plan OK', breakdown: '', label: 'sdlc:approved' });
  });
});

describe('a new project payload', () => {
  it('passes the shared schema, loop limits included', () => {
    const v = initialValues() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    Object.assign(v, { name: 'Shipping', repoUrl: 'https://github.com/acme/shipping' });
    const r = ProjectInputSchema.safeParse(toPayload(v));
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });
});

describe('security triggers', () => {
  it('are shown one per line and sent back as a list', () => {
    const v = initialValues({ ...project, settings: { ...project.settings, securityRiskPatterns: ['payments/', 'eval\\('] } }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(v.settings.securityRiskPatterns).toBe('payments/\neval\\(');
    v.settings.securityRiskPatterns = 'payments/\n\n  crypto  ';
    expect((toPayload(v) as any).settings.securityRiskPatterns).toEqual(['payments/', 'crypto']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('toPayload', () => {
  it('turns numeric text into numbers and blank numeric text into null', () => {
    const v = initialValues(project) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    v.settings.stages.solutionDesign.maxTurns = '9';
    v.settings.limits.maxSubtasks = '';
    const p = toPayload(v) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p.settings.stages.solutionDesign.maxTurns).toBe(9);
    expect(p.settings.limits.maxReviewRounds).toBe(2);
    expect(p.settings.limits.maxSubtasks).toBeNull();
    expect(p.settings.pr.ciTimeoutMin).toBe(30);
  });

  it('splits patterns into lines and maps blank approval columns to null', () => {
    const v = initialValues(project) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    v.settings.verify.redInvalidPatterns = 'A\n\n  B  \n';
    const p = toPayload(v) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p.settings.verify.redInvalidPatterns).toEqual(['A', 'B']);
    expect(p.settings.github.approval).toEqual({ plan: 'Plan OK', breakdown: null, label: 'sdlc:approved' });
  });

  it('omits a blank local prefix so the API derives it', () => {
    const v = initialValues() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect('localKeyPrefix' in (toPayload(v) as object)).toBe(false);
  });

  it('does not mutate the form state', () => {
    const v = initialValues();
    const before = JSON.stringify(v);
    toPayload(v);
    expect(JSON.stringify(v)).toBe(before);
  });
});

describe('applyStackChange', () => {
  it('replaces untouched commands with the new stack prefill', () => {
    const next = applyStackChange(initialValues(), 'ts_node', 'nestjs');
    expect(next).toMatchObject({ stack: 'nestjs', testCmdTemplate: 'npx jest {files}' });
  });
  it('keeps commands the user customised', () => {
    const v = { ...initialValues(), testCmdTemplate: 'pnpm test {files}' };
    expect(applyStackChange(v, 'ts_node', 'nestjs').testCmdTemplate).toBe('pnpm test {files}');
  });
  it('fills commands that were emptied', () => {
    const v = { ...initialValues(), installCmd: '' };
    expect(applyStackChange(v, 'ts_node', 'nextjs').installCmd).toBe('npm ci');
  });
});

describe('GitHub as a source', () => {
  const asProject = (github: Partial<ProjectView['settings']['github']>): ProjectView => ({ ...project, settings: { ...project.settings, github: { ...project.settings.github, ...github } } });

  it('is off for a new project, and the board is two plain fields in the form', () => {
    const v = initialValues() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(v.settings.github).toMatchObject({ mode: 'off', label: 'sdlc-agent', statusField: 'Status', intakeStatus: 'Todo', projectOwner: '', projectNumber: '' });
    expect(v.settings.github.project).toBeUndefined();
    expect(toPayload(v).settings).toMatchObject({ github: { mode: 'off', project: null } });
  });

  it('turns the board fields into the API object and back', () => {
    const v = initialValues(asProject({ mode: 'projects', project: { owner: 'acme', number: 3 } })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(v.settings.github).toMatchObject({ projectOwner: 'acme', projectNumber: '3' });
    v.settings.github.projectNumber = '7';
    const payload = toPayload(v) as { settings: { github: Record<string, unknown> } };
    expect(payload.settings.github.project).toEqual({ owner: 'acme', number: 7 });
    expect('projectOwner' in payload.settings.github).toBe(false);
    expect(ProjectInputSchema.safeParse({ ...payload, name: 'x', repoUrl: 'https://github.com/a/b' }).success).toBe(true);
  });

  it('sends no board when the owner or the number is empty', () => {
    const v = initialValues(asProject({ mode: 'issues' })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    v.settings.github.projectOwner = 'acme';
    expect((toPayload(v) as { settings: { github: { project: unknown } } }).settings.github.project).toBeNull();
  });
});
