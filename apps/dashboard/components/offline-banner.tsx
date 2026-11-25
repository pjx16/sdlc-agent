'use client';

import { useEffect, useState } from 'react';
import { LocalTime } from '@/components/local-time';

const POLL_MS = 15_000;

interface State {
  offline: boolean;
  since: string | null;
}

/**
 * A slim banner while the worker has no internet connection: the pipeline waits and carries on by itself. It starts from what the
 * page was rendered with and then asks the API every 15 seconds, so it appears and goes away without a reload.
 */
export function OfflineBanner({ initial }: { initial: State }) {
  const [state, setState] = useState<State>(initial);
  useEffect(() => {
    let alive = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/system');
        if (!res.ok) return;
        const body = (await res.json()) as { settings?: { networkOffline?: boolean; offlineSince?: string | null } };
        if (alive && body.settings) setState({ offline: Boolean(body.settings.networkOffline), since: body.settings.offlineSince ?? null });
      } catch {
        // The dashboard cannot reach the API: the page itself shows that. Keep what we know.
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!state.offline) return null;
  return (
    <div role="status" className="border-b border-amber bg-amber/10 px-8 py-2 text-sm">
      <strong>No internet connection.</strong> The pipeline is paused{state.since && (
        <>
          {' '}since <LocalTime iso={state.since} />
        </>
      )}
      {' '}and resumes by itself when the connection is back.
    </div>
  );
}
