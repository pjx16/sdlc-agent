'use client';

import { formatDateTime } from '@/lib/ticket-status';
import { formatLocal, useIsClient } from '@/lib/local-time';

/** A moment in the viewer's own time zone. The server cannot know it, so the first render is UTC and the browser then switches. */
export function LocalTime({ iso }: { iso: string | null }) {
  const client = useIsClient();
  return <>{client ? formatLocal(iso) : formatDateTime(iso)}</>;
}
