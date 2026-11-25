import { describe, expect, it, vi } from 'vitest';
import { ConnectivityMonitor, FAILED_ROUNDS_TO_OFFLINE, httpProbe, probesFromEnv, type Probe } from './connectivity-monitor';

function setup(initial: { networkOffline: boolean; offlineSince: Date | null } = { networkOffline: false, offlineSince: null }) {
  const row = { ...initial };
  const prisma = {
    globalSettings: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async ({ update }: { update: typeof row }) => void Object.assign(row, update)),
    },
    event: { create: vi.fn(async () => undefined) },
  };
  return { row, prisma };
}
const up: Probe = async () => true;
const down: Probe = async () => false;

describe('ConnectivityMonitor', () => {
  it('declares offline only after three rounds in a row where every probe failed', async () => {
    const { row, prisma } = setup();
    const m = new ConnectivityMonitor(prisma as never, [down, down]);
    for (let i = 1; i < FAILED_ROUNDS_TO_OFFLINE; i++) {
      await m.check();
      expect(row.networkOffline).toBe(false);
    }
    await m.check();
    expect(row.networkOffline).toBe(true);
    expect(row.offlineSince).toBeInstanceOf(Date);
    expect(prisma.event.create).toHaveBeenCalledTimes(1);
  });

  it('one probe that answers is enough, and a good round resets the count', async () => {
    const { row, prisma } = setup();
    let ok = false;
    const flaky: Probe = async () => ok;
    const m = new ConnectivityMonitor(prisma as never, [down, flaky]);
    await m.check();
    await m.check();
    ok = true;
    await m.check(); // answered: the two failures are forgotten
    ok = false;
    await m.check();
    await m.check();
    expect(row.networkOffline).toBe(false);
    await m.check();
    expect(row.networkOffline).toBe(true);
  });

  it('is back online on the first round that gets an answer, and says how long it was down', async () => {
    const since = new Date(Date.now() - 90_000);
    const { row, prisma } = setup({ networkOffline: true, offlineSince: since });
    const m = new ConnectivityMonitor(prisma as never, [up]);
    await m.check();
    expect(row).toEqual({ networkOffline: false, offlineSince: null });
    expect(JSON.stringify(prisma.event.create.mock.calls[0])).toContain('connection is back after');
  });

  it('a probe that throws counts as a failure, not a crash', async () => {
    const { row, prisma } = setup();
    const m = new ConnectivityMonitor(prisma as never, [async () => Promise.reject(new Error('boom'))]);
    for (let i = 0; i < FAILED_ROUNDS_TO_OFFLINE; i++) await m.check();
    expect(row.networkOffline).toBe(true);
  });

  it('with no probes (switched off) it is never offline, and clears an old offline flag', async () => {
    const { row, prisma } = setup({ networkOffline: true, offlineSince: new Date() });
    await new ConnectivityMonitor(prisma as never, []).check();
    expect(row.networkOffline).toBe(false);
  });

  it('never touches the pause switches', async () => {
    const { prisma } = setup();
    const m = new ConnectivityMonitor(prisma as never, [down]);
    for (let i = 0; i < FAILED_ROUNDS_TO_OFFLINE; i++) await m.check();
    const update = (prisma.globalSettings.upsert.mock.calls as unknown as [{ update: Record<string, unknown> }][])[0]![0].update;
    expect(Object.keys(update).sort()).toEqual(['networkOffline', 'offlineSince']);
  });
});

describe('httpProbe', () => {
  it('counts any HTTP answer as online, and a failed connection as offline', async () => {
    expect(await httpProbe('https://x.test', 100, (async () => new Response(null, { status: 503 })) as typeof fetch)()).toBe(true);
    expect(await httpProbe('https://x.test', 100, (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch)()).toBe(false);
  });
});

describe('probesFromEnv', () => {
  it('is off with CONNECTIVITY_CHECK=off, uses the default addresses, or only the https ones given', () => {
    expect(probesFromEnv({ CONNECTIVITY_CHECK: 'off' })).toBeNull();
    expect(probesFromEnv({})).toHaveLength(3);
    expect(probesFromEnv({ CONNECTIVITY_PROBES: 'https://a.test, http://insecure.test, https://b.test' })).toHaveLength(2);
    expect(probesFromEnv({ CONNECTIVITY_PROBES: 'ftp://nope' })).toHaveLength(3);
  });
});
