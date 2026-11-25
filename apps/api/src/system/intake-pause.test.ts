import { HttpStatus } from '@nestjs/common';
import { DEFAULT_GLOBAL_SETTINGS } from '@sdlc/shared';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { isIntakePaused, pausedSourcesFor, type IntakeSource } from './intake-pause';
import { SystemSettingsService } from './system-settings.service';

describe('isIntakePaused', () => {
  it('is true for every source when the master switch is on', () => {
    const settings = { intakePaused: true, pausedIntakeSources: [] as IntakeSource[] };
    expect(isIntakePaused(settings, 'jira')).toBe(true);
    expect(isIntakePaused(settings, 'paste')).toBe(true);
  });
  it('is true only for listed sources when the master switch is off', () => {
    const settings = { intakePaused: false, pausedIntakeSources: ['paste'] as IntakeSource[] };
    expect(isIntakePaused(settings, 'paste')).toBe(true);
    expect(isIntakePaused(settings, 'jira')).toBe(false);
  });
});

describe('pausedSourcesFor', () => {
  it('returns all sources when the master switch is on', () => {
    const got = pausedSourcesFor({ intakePaused: true, pausedIntakeSources: [] });
    expect([...got].sort()).toEqual(['jira', 'paste']);
  });
  it('returns the list when the master switch is off', () => {
    expect(pausedSourcesFor({ intakePaused: false, pausedIntakeSources: ['jira'] })).toEqual(['jira']);
    expect(pausedSourcesFor({ intakePaused: false, pausedIntakeSources: [] })).toEqual([]);
  });
});

/** A faked Prisma holding one settings row; records events. */
function fakePrisma(initial: IntakeSource[] = []) {
  const d = DEFAULT_GLOBAL_SETTINGS;
  const row: Record<string, unknown> = {
    id: 'global',
    ...d,
    modelAliases: d.modelAliases,
    stageDefaults: d.stageDefaults,
    pipelinePaused: false,
    pausedReason: null,
    pausedCode: null,
    resetsAt: null,
    usageIgnoredUntil: null,
    budgetsApprovedAt: null,
    intakePaused: false,
    pausedIntakeSources: initial,
  };
  const events: { type: string; message: string }[] = [];
  const prisma = {
    globalSettings: {
      upsert: async () => row,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(row, data),
    },
    event: {
      create: async ({ data }: { data: { type: string; message: string } }) => {
        events.push(data);
        return data;
      },
    },
  };
  return { service: new SystemSettingsService(prisma as unknown as PrismaService), events };
}

describe('SystemSettingsService per-source intake pause', () => {
  it('has an empty pausedIntakeSources in the default settings view', async () => {
    const { service } = fakePrisma();
    expect((await service.settings()).pausedIntakeSources).toEqual([]);
  });
  it('adds the source and writes a state event', async () => {
    const { service, events } = fakePrisma();
    const view = await service.setSourceIntakePaused('jira', true);
    expect(view.pausedIntakeSources).toEqual(['jira']);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('state');
  });
  it('leaves no duplicate when pausing an already paused source', async () => {
    const { service } = fakePrisma(['paste']);
    const view = await service.setSourceIntakePaused('paste', true);
    expect(view.pausedIntakeSources).toEqual(['paste']);
  });
  it('removes the source on resume and keeps the others', async () => {
    const { service } = fakePrisma(['jira', 'paste']);
    const view = await service.setSourceIntakePaused('jira', false);
    expect(view.pausedIntakeSources).toEqual(['paste']);
  });
  it('rejects an unknown source such as github with a 400', async () => {
    const { service, events } = fakePrisma();
    await expect(service.setSourceIntakePaused('github', true)).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(events).toHaveLength(0);
  });
});
