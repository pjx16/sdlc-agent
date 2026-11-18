'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Re-fetches the server-rendered data of the page every few seconds. Renders nothing.
 * It skips a tick while the tab is hidden, while the person is typing in a field, and while the last refresh is still running,
 * and it runs as a transition so the page stays interactive instead of blocking on the fetch.
 */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  busy.current = pending;
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || busy.current) return;
      if (document.activeElement && TYPING.has(document.activeElement.tagName)) return;
      startTransition(() => router.refresh());
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
