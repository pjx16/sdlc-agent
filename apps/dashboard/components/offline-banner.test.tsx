import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from './offline-banner';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.useRealTimers());
const reply = (networkOffline: boolean, offlineSince: string | null = null) => ({ ok: true, json: async () => ({ settings: { networkOffline, offlineSince } }) });

describe('OfflineBanner', () => {
  it('shows nothing while online', () => {
    render(<OfflineBanner initial={{ offline: false, since: null }} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says the pipeline is paused and resumes by itself, when the page is rendered offline', () => {
    render(<OfflineBanner initial={{ offline: true, since: '2026-11-25T02:14:00Z' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('No internet connection');
    expect(screen.getByRole('status')).toHaveTextContent('resumes by itself');
  });

  it('appears and disappears without a reload', async () => {
    fetchMock.mockResolvedValueOnce(reply(true, '2026-11-25T02:14:00Z')).mockResolvedValueOnce(reply(false));
    render(<OfflineBanner initial={{ offline: false, since: null }} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    expect(fetchMock).toHaveBeenCalledWith('/api/system');
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps what it knew when the API cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    render(<OfflineBanner initial={{ offline: true, since: null }} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
