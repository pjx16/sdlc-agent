import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuidelineEntry } from '@/lib/types';
import { GuidelinesGallery } from './gallery';

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

const entry = (over: Partial<GuidelineEntry>): GuidelineEntry => ({ id: 'agent:coder', kind: 'agent', label: 'Coder', description: 'Makes the tests pass.', editable: 'agents/base/coder.md', readonly: 'agents/pipeline/coder.md', model: 'sonnet', position: 'For each subtask: after the tests.', tweaks: ['Prefer small, pure functions.', 'Add JSDoc to every exported function.'], customised: false, updatedAt: null, ...over });
const catalogue: GuidelineEntry[] = [
  entry({}),
  entry({ id: 'agent:fixer', label: 'Fixer', description: 'Removes one named failure.', editable: 'agents/base/fixer.md', readonly: 'agents/pipeline/fixer.md', model: 'sonnet', customised: true, updatedAt: '2026-11-20T10:00:00.000Z', tweaks: [] }),
  entry({ id: 'format:review-comment', kind: 'format', label: 'Review comment', description: 'The comment with the review findings.', editable: 'formats/review-comment.md', readonly: undefined, model: undefined, position: undefined, tweaks: [] }),
  entry({ id: 'standard:shared-rules', kind: 'standard', label: 'Rules every agent follows', description: 'Applies to all agents.', editable: 'agents/shared-rules.md', readonly: undefined, model: undefined, position: undefined, tweaks: [] }),
];

const files: Record<string, string> = {
  'agents/base/coder.md': '# Coder\n\n## Rules\n\n- Make the smallest change.\n\n## Notes\n\nNone.\n',
  'agents/base/fixer.md': '# Fixer\n\n## Rules\n\n- Fix one failure.\n',
  'agents/pipeline/coder.md': '## Inputs\n\n- the subtask\n\n## Output `data`\n\n{ "filesChanged": [] }\n',
  'formats/review-comment.md': '## Review\n\n{{findings}}\n',
  'agents/shared-rules.md': '# Rules\n',
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => true));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/guidelines/catalogue') return reply(catalogue);
    const reset = /^\/api\/guidelines\/reset\/(.+)$/.exec(url);
    if (reset) return reply({ path: decodeURIComponent(reset[1] as string), content: '# Original\n' });
    const path = decodeURIComponent(url.replace('/api/guidelines/', ''));
    if (init?.method === 'PUT') return reply({ path, bytes: 1 });
    return files[path] === undefined ? reply({ message: 'not found' }, 404) : reply({ path, content: files[path] });
  });
});

const open = async (name: string) => {
  render(<GuidelinesGallery initial={catalogue} />);
  await userEvent.click(screen.getByRole('button', { name }));
  return await screen.findByRole('dialog');
};
const textbox = () => screen.findByLabelText(/^Text of /) as Promise<HTMLTextAreaElement>;

describe('the guidelines gallery', () => {
  it('shows the groups from the catalogue as cards, with the model on agents and Customised only where the text changed', () => {
    render(<GuidelinesGallery initial={catalogue} />);
    for (const group of ['Agents', 'How things are written', 'Standards']) expect(screen.getByRole('region', { name: group })).toBeInTheDocument();
    const agents = within(screen.getByRole('region', { name: 'Agents' }));
    expect(agents.getAllByText('sonnet')).toHaveLength(2);
    expect(within(screen.getByRole('button', { name: 'Fixer' })).getByText('Customised')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Coder' })).queryByText('Customised')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Standards' })).queryByText('sonnet')).not.toBeInTheDocument();
    expect(screen.getByText(/Each agent follows a short brief in plain words/)).toBeInTheDocument();
  });

  it('never shows a file path or a folder', () => {
    const { container } = render(<GuidelinesGallery initial={catalogue} />);
    expect(container.textContent).not.toMatch(/\.md|agents\/|formats\/|guidelines\//);
  });

  it('opens the editor at the card that was clicked, and loads its text', async () => {
    const dialog = await open('Coder');
    expect(within(dialog).getByRole('heading', { name: 'Coder', level: 2 })).toBeInTheDocument();
    expect(await textbox()).toHaveValue(files['agents/base/coder.md']);
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/guidelines/agents/base/coder.md')).toBe(true);
  });
});

describe('the editor', () => {
  it('shows the pipeline part as text only: no field to type in, and it says who manages it', async () => {
    const dialog = await open('Coder');
    await textbox();
    await userEvent.click(within(dialog).getByRole('tab', { name: /In this pipeline/ }));
    expect(await within(dialog).findByText(/managed by sdlc-agent/)).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^Text of /)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('a tweak chip adds its line under Rules, and the preview follows', async () => {
    const dialog = await open('Coder');
    await textbox();
    await userEvent.click(within(dialog).getByRole('button', { name: '+ Prefer small, pure functions.' }));
    expect(await textbox()).toHaveValue('# Coder\n\n## Rules\n\n- Make the smallest change.\n- Prefer small, pure functions.\n\n## Notes\n\nNone.\n');
    expect(within(within(dialog).getByLabelText('Preview')).getByText('Prefer small, pure functions.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Unsaved/)).toBeInTheDocument();
  });

  it('Save and Discard stay off until the text changes; Save sends the text', async () => {
    const dialog = await open('Coder');
    const box = await textbox();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeDisabled();
    await userEvent.type(box, '!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/guidelines/agents/base/coder.md' && (i as RequestInit)?.method === 'PUT')).toBe(true));
    const put = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PUT') as [string, RequestInit];
    expect(JSON.parse(String(put[1].body))).toEqual({ content: `${files['agents/base/coder.md']}!` });
    expect(await within(dialog).findByText(/Saved\. It applies from the next stage run/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Discard puts the saved text back', async () => {
    const dialog = await open('Coder');
    await userEvent.type(await textbox(), 'extra');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(await textbox()).toHaveValue(files['agents/base/coder.md']);
  });

  it('Reset to default asks first, calls the API and shows the original', async () => {
    const dialog = await open('Fixer');
    await textbox();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset to default' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/guidelines/reset/agents/base/fixer.md' && (i as RequestInit)?.method === 'POST')).toBe(true));
    expect(await textbox()).toHaveValue('# Original\n');
  });

  it('Reset does nothing when the person says no', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const dialog = await open('Fixer');
    await textbox();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset to default' }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/reset/'))).toBe(false);
  });

  it('keeps a draft when another item is opened, marks it in the list, and finds it again', async () => {
    const dialog = await open('Coder');
    await userEvent.type(await textbox(), ' draft');
    await userEvent.click(within(within(dialog).getByRole('navigation', { name: 'Guidelines' })).getByRole('button', { name: /Fixer/ }));
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Fixer', level: 3 })).toBeInTheDocument());
    expect(await textbox()).toHaveValue(files['agents/base/fixer.md']);
    expect(within(within(dialog).getByRole('navigation', { name: 'Guidelines' })).getByRole('img', { name: 'Unsaved changes' })).toBeInTheDocument();
    await userEvent.click(within(within(dialog).getByRole('navigation', { name: 'Guidelines' })).getByRole('button', { name: /Coder/ }));
    expect(await textbox()).toHaveValue(`${files['agents/base/coder.md']} draft`);
  });

  it('closing with a draft asks first, and stays open when the person says no', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const dialog = await open('Coder');
    await userEvent.type(await textbox(), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(window.confirm).toHaveBeenCalledWith('Discard your changes?');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    vi.stubGlobal('confirm', vi.fn(() => true));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closing without a draft does not ask', async () => {
    const dialog = await open('Coder');
    await textbox();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('a format lists its placeholders and warns about one that is missing', async () => {
    const dialog = await open('Review comment');
    const box = await textbox();
    expect(within(within(dialog).getByRole('region', { name: 'About this format' })).getByText('{{findings}}')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'Only text');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Missing {{findings}}');
  });

  it('shows why a file could not be opened', async () => {
    fetchMock.mockImplementation(async (url: string) => (url === '/api/guidelines/catalogue' ? reply(catalogue) : reply({ message: 'not found' }, 404)));
    const dialog = await open('Coder');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('not found');
  });
});
