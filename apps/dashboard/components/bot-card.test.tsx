import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotCard } from './bot-card';

const fetchMock = vi.fn();
const open = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('open', open);
});
afterEach(() => {
  fetchMock.mockReset();
  open.mockReset();
});
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });

describe('BotCard', () => {
  it('starts not connected and offers to connect', async () => {
    fetchMock.mockResolvedValue(reply({ connected: false, installations: [], error: null }));
    render(<BotCard />);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect sdlc-agent-bot' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('connect opens the GitHub install page in a new tab', async () => {
    fetchMock.mockResolvedValueOnce(reply({ connected: false, installations: [], error: null }));
    render(<BotCard />);
    await screen.findByText('Not connected');
    fetchMock.mockResolvedValueOnce(reply({ url: 'https://github.com/apps/sdlc-agent/installations/new?state=s' })).mockResolvedValue(reply({ connected: true, installations: [], error: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Connect sdlc-agent-bot' }));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/bot/connect');
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://github.com/apps/sdlc-agent/installations/new?state=s', '_blank', 'noopener,noreferrer'));
    expect(await screen.findByText(/Finish on GitHub/)).toBeInTheDocument();
  });

  it('connects only after the code from the GitHub return page is entered', async () => {
    fetchMock.mockResolvedValueOnce(reply({ connected: false, installations: [], error: null }));
    render(<BotCard />);
    await screen.findByText('Not connected');
    fetchMock.mockResolvedValueOnce(reply({ url: 'https://broker.test/install/begin?state=s' })).mockResolvedValue(reply({ connected: true, installations: [{ id: 7, account: 'acme' }], error: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Connect sdlc-agent-bot' }));
    const input = await screen.findByLabelText('Pairing code');
    const connect = screen.getByRole('button', { name: 'Connect' });
    expect(connect).toBeDisabled();
    fetchMock.mockResolvedValueOnce(reply({ account: 'acme' }));
    await userEvent.type(input, 'abcd2345');
    await userEvent.click(connect);
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/bot/confirm');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ code: 'ABCD2345' });
    expect(await screen.findByText(/Connected to acme/)).toBeInTheDocument();
  });

  it('shows where the App is installed once it is', async () => {
    fetchMock.mockResolvedValue(reply({ connected: true, installations: [{ id: 7, account: 'acme' }], error: null }));
    render(<BotCard />);
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('shows why connecting failed', async () => {
    fetchMock.mockResolvedValueOnce(reply({ connected: false, installations: [], error: null }));
    render(<BotCard />);
    await screen.findByText('Not connected');
    fetchMock.mockResolvedValueOnce(reply({ message: 'Could not reach the sdlc-agent-bot broker: fetch failed' }, false));
    await userEvent.click(screen.getByRole('button', { name: 'Connect sdlc-agent-bot' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the sdlc-agent-bot broker');
  });
});
