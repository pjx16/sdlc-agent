import { describe, expect, it } from 'vitest';
import { BoardAdviseData, RepoProfileData, missingAcceptance } from './onboarding';
import { ProjectSettingsSchema } from './project-settings';

describe('acceptance', () => {
  it('the board mapping, when there is one, must be accepted explicitly', () => {
    const board = { statusMap: {}, approval: { plan: null, breakdown: null }, intakeStatus: null, useDefaultColumns: true };
    expect(missingAcceptance({ accepted: {} })).toEqual([]);
    expect(missingAcceptance({ accepted: {}, board })).toEqual(['board']);
    expect(missingAcceptance({ accepted: { board: true }, board })).toEqual([]);
  });
});

describe('agent output', () => {
  it('repo profile needs {files} in the test command and a safe kb folder', () => {
    const ok = { stack: 'nestjs', installCmd: 'npm ci', typecheckCmd: 'npx tsc --noEmit', testCmdTemplate: 'npx jest {files}', kbDir: 'docs/kb', testFilePattern: '**/*.spec.ts', exampleTestFile: null };
    expect(RepoProfileData.safeParse(ok).success).toBe(true);
    expect(RepoProfileData.safeParse({ ...ok, testCmdTemplate: 'npx jest' }).success).toBe(false);
    expect(RepoProfileData.safeParse({ ...ok, kbDir: '../x' }).success).toBe(false);
    expect(RepoProfileData.safeParse({ ...ok, stack: 'rails' }).success).toBe(false);
  });
  it('board advice maps states to columns, several states may share one, and needs the default-columns call', () => {
    const ok = { board: { statusMap: { KB: 'In Progress', PLANNING: 'In Progress', DONE: 'Done' }, approval: { plan: 'Plan Approved', breakdown: null }, intakeStatus: 'Todo', useDefaultColumns: false } };
    expect(BoardAdviseData.safeParse(ok).success).toBe(true);
    expect(BoardAdviseData.safeParse({ board: { ...ok.board, useDefaultColumns: 'yes' } }).success).toBe(false);
    expect(BoardAdviseData.safeParse({ board: { ...ok.board, statusMap: { NOPE: 'x' } } }).success).toBe(true); // unknown states are dropped, not an error
    expect(BoardAdviseData.safeParse({ statusMap: {}, approvalStatuses: {} }).success).toBe(false);
  });
});

describe('project settings keep the new fields', () => {
  it('defaults to no approval columns, and an old Confluence setting is ignored', () => {
    const s = ProjectSettingsSchema.parse({});
    expect(s.github.approval).toEqual({ plan: null, breakdown: null, label: 'sdlc:approved' });
    expect('confluence' in s).toBe(false);
    expect(s.stages.repoProfile).toMatchObject({ model: 'sonnet' });
    expect(s.stages.onboardAdvise).toMatchObject({ model: 'haiku' });
    // Settings saved before the Confluence integration was removed still parse, and the key is dropped.
    expect('confluence' in ProjectSettingsSchema.parse({ confluence: { spaceKey: 'ENG' } })).toBe(false);
  });
});

import { GlobalSettingsSchema } from './global-settings';
describe('global stage defaults', () => {
  it('every stage has a model and a turn limit, taken from the built-in project defaults', () => {
    const d = GlobalSettingsSchema.parse({}).stageDefaults;
    expect(d.solutionDesign).toEqual({ model: 'opus', maxTurns: 15 });
    expect(d.repoProfile).toEqual({ model: 'sonnet', maxTurns: 25 });
    expect(Object.keys(d)).toContain('assist');
  });
  it('keeps what was set and refuses a bad value', () => {
    expect(GlobalSettingsSchema.parse({ stageDefaults: { solutionDesign: { model: 'haiku', maxTurns: 5 } } }).stageDefaults.solutionDesign).toEqual({ model: 'haiku', maxTurns: 5 });
    expect(GlobalSettingsSchema.safeParse({ stageDefaults: { solutionDesign: { model: 'gpt', maxTurns: 5 } } }).success).toBe(false);
    expect(GlobalSettingsSchema.safeParse({ stageDefaults: { solutionDesign: { model: 'haiku', maxTurns: 0 } } }).success).toBe(false);
  });
});
