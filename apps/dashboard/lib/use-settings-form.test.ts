import { act, renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_GLOBAL_SETTINGS, STAGE_NAMES } from '@sdlc/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diffPaths, initialSettingsValues, toSettingsPayload } from './settings-form';
import type { GlobalSettingsView } from './types';
import { useSettingsForm } from './use-settings-form';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const settings: GlobalSettingsView = {
  budgetDailyCredits: 10, budgetWeeklyCredits: null, budgetMonthlyCredits: 150, budgetWarnPct: 80, timezone: 'UTC', pollIntervalSec: 120, stageTimeoutMin: 20,
  verifyTimeoutSec: 600, onboardingTimeoutMin: 15, githubIssueOnCreate: 'ask', workspaceRetentionDays: 7, logRetentionDays: 30, assistantTokenCap: 200000,
  stageDefaults: Object.fromEntries(STAGE_NAMES.map((st) => [st, { model: 'sonnet' as const, maxTurns: 10 }])),
  modelAliases: { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' },
  pipelinePaused: false, pausedReason: null, resetsAt: null, usageIgnoredUntil: null, budgetsApprovedAt: null, intakePaused: false,
  intakeGithubEnabled: true, intakeJiraEnabled: true, intakePasteEnabled: true,
};
const sent = () => JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
const setup = () => renderHook(() => useSettingsForm(settings));

describe('diffPaths and the payload', () => {
  it('lists the dotted paths that differ, however deep', () => {
    expect(diffPaths({ a: '1', b: { c: '2', d: '3' } }, { a: '1', b: { c: '9', d: '3' } })).toEqual(['b.c']);
    expect(diffPaths({ a: '1' }, { a: '1' })).toEqual([]);
    expect(diffPaths({ a: '1' }, { a: '1', n: 'new' })).toEqual(['n']);
  });

  it('with keys, only those settings are in the payload, with numbers as numbers and blanks as null', () => {
    const values = { ...initialSettingsValues(settings), budgetDailyCredits: '12.5', pollIntervalSec: '' };
    expect(toSettingsPayload(values, ['budgetDailyCredits', 'pollIntervalSec'])).toEqual({ budgetDailyCredits: 12.5, pollIntervalSec: null });
    expect(Object.keys(toSettingsPayload(values))).toContain('stageDefaults'); // with no keys: everything
  });
});

describe('useSettingsForm', () => {
  it('starts with nothing changed', () => {
    const { result } = setup();
    expect(result.current.dirty).toBe(false);
    expect(result.current.changed).toEqual([]);
    expect(result.current.values.budgetDailyCredits).toBe('10');
  });

  it('an edit makes it dirty and names the path; putting the old value back makes it clean again', () => {
    const { result } = setup();
    act(() => result.current.set('budgetDailyCredits', '12'));
    expect(result.current).toMatchObject({ dirty: true, changed: ['budgetDailyCredits'] });
    act(() => result.current.set('budgetDailyCredits', '10'));
    expect(result.current.dirty).toBe(false);
  });

  it('Save sends only the settings that changed, and a blank budget as null (no limit)', async () => {
    fetchMock.mockResolvedValue(reply({ ...settings, budgetDailyCredits: null, timezone: 'Asia/Kolkata' }));
    const { result } = setup();
    act(() => {
      result.current.set('budgetDailyCredits', '');
      result.current.set('timezone', 'Asia/Kolkata');
    });
    await act(async () => void (await result.current.save()));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/system/settings');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('PATCH');
    expect(sent()).toEqual({ budgetDailyCredits: null, timezone: 'Asia/Kolkata' });
  });

  it('a change inside the stage defaults sends the stage defaults, with turns as numbers', async () => {
    fetchMock.mockResolvedValue(reply(settings));
    const { result } = setup();
    act(() => {
      result.current.set('stageDefaults.solutionDesign.model', 'opus');
      result.current.set('stageDefaults.solutionDesign.maxTurns', '20');
    });
    await act(async () => void (await result.current.save()));
    expect(Object.keys(sent())).toEqual(['stageDefaults']);
    expect(sent().stageDefaults.solutionDesign).toEqual({ model: 'opus', maxTurns: 20 });
    expect(sent().stageDefaults.implement).toEqual({ model: 'sonnet', maxTurns: 10 });
  });

  it('after a save what is saved is the new baseline: clean, with a message, and the page is refreshed', async () => {
    fetchMock.mockResolvedValue(reply({ ...settings, budgetDailyCredits: 12.5 }));
    const { result } = setup();
    act(() => result.current.set('budgetDailyCredits', '12.5'));
    await act(async () => void (await result.current.save()));
    expect(result.current).toMatchObject({ dirty: false, errors: {}, message: { kind: 'ok', text: 'Saved. Changes apply from the next stage run.' } });
    expect(result.current.values.budgetDailyCredits).toBe('12.5');
    expect(refresh).toHaveBeenCalled();
  });

  it('a validation error lands on its field, nothing is lost, and it stays dirty', async () => {
    fetchMock.mockResolvedValue(reply({ fields: { budgetWarnPct: 'must be at least 1', 'modelAliases.haiku': 'required' } }, 400));
    const { result } = setup();
    act(() => result.current.set('budgetWarnPct', '0'));
    let ok = true;
    await act(async () => void (ok = await result.current.save()));
    expect(ok).toBe(false);
    expect(result.current.errors).toEqual({ budgetWarnPct: 'must be at least 1', 'modelAliases.haiku': 'required' });
    expect(result.current).toMatchObject({ dirty: true, message: { kind: 'error', text: 'Some fields need attention.' } });
    expect(result.current.values.budgetWarnPct).toBe('0');
    act(() => result.current.set('budgetWarnPct', '5'));
    expect(result.current.errors).toEqual({ 'modelAliases.haiku': 'required' }); // editing a field clears its own error
  });

  it('says when the server cannot be reached or refuses without fields', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reply({ message: 'Try later' }, 503));
    const { result } = setup();
    act(() => result.current.set('timezone', 'Europe/Paris'));
    await act(async () => void (await result.current.save()));
    expect(result.current.message).toEqual({ kind: 'error', text: 'Cannot reach the server.' });
    await act(async () => void (await result.current.save()));
    expect(result.current.message).toEqual({ kind: 'error', text: 'Try later' });
  });

  it('saving with nothing changed sends nothing', async () => {
    const { result } = setup();
    let ok = false;
    await act(async () => void (ok = await result.current.save()));
    expect(ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Discard goes back to what is saved, with no errors', async () => {
    fetchMock.mockResolvedValue(reply({ fields: { budgetWarnPct: 'bad' } }, 400));
    const { result } = setup();
    act(() => result.current.set('budgetWarnPct', '0'));
    await act(async () => void (await result.current.save()));
    act(() => result.current.discard());
    expect(result.current).toMatchObject({ dirty: false, errors: {}, message: null });
    expect(result.current.values.budgetWarnPct).toBe('80');
  });

  describe('Reset', () => {
    it('puts the defaults on the screen without saving them: the form turns dirty, nothing is sent', () => {
      const { result } = setup();
      act(() => result.current.reset());
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.dirty).toBe(true);
      expect(result.current.values.budgetDailyCredits).toBe(''); // the default is no limit
      expect(result.current.values.pollIntervalSec).toBe(String(DEFAULT_GLOBAL_SETTINGS.pollIntervalSec));
      expect(result.current.changed).toEqual(expect.arrayContaining(['budgetDailyCredits', 'budgetMonthlyCredits']));
    });

    it('leaves where tickets come from, and the GitHub issue choice, as they are', () => {
      const { result } = renderHook(() => useSettingsForm({ ...settings, intakePasteEnabled: false, githubIssueOnCreate: 'always' }));
      act(() => result.current.reset());
      expect(result.current.values).toMatchObject({ intakePasteEnabled: false, intakeGithubEnabled: true, githubIssueOnCreate: 'always' });
      expect(result.current.changed.some((p) => p.startsWith('intake') || p === 'githubIssueOnCreate')).toBe(false);
    });

    it('can be discarded, and when saved sends only what differs from what was saved', async () => {
      fetchMock.mockResolvedValue(reply(settings));
      const { result } = setup();
      act(() => result.current.reset());
      act(() => result.current.discard());
      expect(result.current.dirty).toBe(false);
      act(() => result.current.reset());
      await act(async () => void (await result.current.save()));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(Object.keys(sent())).toEqual(expect.arrayContaining(['budgetDailyCredits', 'budgetMonthlyCredits']));
      expect(Object.keys(sent())).not.toContain('timezone'); // UTC is the default and was saved as UTC
      expect(Object.keys(sent())).not.toContain('intakePasteEnabled');
    });
  });
});
