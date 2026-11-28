import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PREVIEW_CHARS, Markdown, safeUrl } from './markdown';

afterEach(() => vi.restoreAllMocks());

const writeText = () => {
  const spy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true });
  return spy;
};

describe('Markdown view', () => {
  it('opens on Preview, and the switch shows the raw text and back', async () => {
    render(<Markdown source={'# Title\n\nSome **bold** text'} />);
    expect(screen.getByRole('tab', { name: 'preview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'raw' }));
    expect(screen.queryByRole('heading', { name: 'Title' })).not.toBeInTheDocument();
    expect(screen.getByText(/# Title/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'preview' }));
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
  });

  it('always starts on Preview: the choice is not remembered', async () => {
    const { unmount } = render(<Markdown source="# Title" />);
    await userEvent.click(screen.getByRole('tab', { name: 'raw' }));
    unmount();
    render(<Markdown source="# Title" />);
    expect(screen.getByRole('tab', { name: 'preview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('the arrow keys move between the two views', async () => {
    render(<Markdown source="# Title" />);
    screen.getByRole('tab', { name: 'preview' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'raw' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'raw' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'preview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('toggle={false} shows no switch and no Copy', () => {
    render(<Markdown source="# Title" toggle={false} />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
  });

  it('Copy puts the raw source on the clipboard and says Copied', async () => {
    const spy = writeText();
    render(<Markdown source={'# Title\n\n- a'} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(spy).toHaveBeenCalledWith('# Title\n\n- a');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('compact and max-height are applied', () => {
    const { container } = render(<Markdown source="text" compact maxHeight="max-h-96" toggle={false} />);
    expect(container.querySelector('.markdown.compact')).not.toBeNull();
    expect(container.querySelector('.max-h-96.overflow-auto')).not.toBeNull();
  });

  it('shows a document that is too long as raw text, with a note', () => {
    render(<Markdown source={`# Big\n${'x'.repeat(MAX_PREVIEW_CHARS)}`} />);
    expect(screen.getByText(/too long to preview/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Big' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'preview' })).toBeDisabled();
  });
});

describe('GitHub-flavoured markdown', () => {
  it('renders tables, task lists and strikethrough', () => {
    const { container } = render(<Markdown source={['| a | b |', '| - | - |', '| 1 | 2 |', '', '- [x] done', '- [ ] todo', '', '~~gone~~'].join('\n')} />);
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'a' })).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    expect(boxes.every((b) => (b as HTMLInputElement).disabled)).toBe(true);
    expect(container.querySelector('del')).toHaveTextContent('gone');
  });

  it('opens absolute links in a new tab without leaking the opener, and keeps relative ones in the page', () => {
    render(<Markdown source="[site](https://example.com) and [doc](/tickets/1)" />);
    expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'site' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'doc' })).not.toHaveAttribute('target');
  });
});

describe('what an agent writes cannot inject markup', () => {
  it('shows raw HTML as text and renders no script, image or handler', () => {
    const { container } = render(<Markdown source={'<script>window.hacked = 1</script>\n\n<img src=x onerror="window.hacked = 2">\n\n<b onclick="x()">bold?</b>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:msgbox(1)'])('drops the target of the link %j', (url) => {
    render(<Markdown source={`[x](<${url}>)`} />);
    const link = screen.queryByRole('link', { name: 'x' });
    expect(link?.getAttribute('href') ?? '').toBe('');
  });

  it('safeUrl keeps http, https, mailto, anchors and relative paths, and nothing else', () => {
    for (const ok of ['http://a.b', 'https://a.b/c?d=e#f', 'mailto:a@b.c', '#section', '/tickets/1', './x', '../y', 'docs/readme.md', '//cdn.example/x']) expect(safeUrl(ok)).toBe(ok);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'ftp://x', 'java\nscript:x']) expect(safeUrl(bad)).toBe('');
  });
});

describe('plain-text messages from the pipeline (inbox, chat)', () => {
  const show = (text: string) => render(<Markdown source={text} compact toggle={false} />);

  it('turns a bare URL into a link that opens in a new tab', () => {
    show('The PR is ready.\n\nhttps://github.com/acme/app/pull/7');
    const a = screen.getByRole('link', { name: 'https://github.com/acme/app/pull/7' });
    expect(a).toHaveAttribute('href', 'https://github.com/acme/app/pull/7');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('leaves trailing punctuation outside the link', () => {
    show('See (https://example.com/a), then https://example.com/b.');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('renders **bold** and does not show the markers', () => {
    const { container } = show('Ticket **SDA-1: Fix it** is ready');
    expect(container.querySelector('strong')?.textContent).toBe('SDA-1: Fix it');
    expect(container.textContent).not.toContain('**');
  });

  it('never links other schemes, and keeps markup as text', () => {
    const { container } = show('javascript:alert(1) <script>alert(1)</script> ftp://x.test');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('code', () => {
  it('highlights a known language and leaves an unknown one plain', async () => {
    const { container } = render(<Markdown source={['```ts', 'const answer: number = 42;', '```', '', '```nonsense', 'const x = 1', '```'].join('\n')} />);
    const blocks = container.querySelectorAll('pre code');
    expect(blocks[0]?.querySelector('.hljs-keyword')).toHaveTextContent('const');
    expect(blocks[1]?.querySelector('.hljs-keyword')).toBeNull();
    expect(blocks[1]).toHaveTextContent('const x = 1');
  });

  it('knows the aliases people write', () => {
    const { container } = render(<Markdown source={['```sh', 'echo "hi"', '```', '', '```tsx', 'const a = <div />', '```'].join('\n')} />);
    expect(container.querySelectorAll('pre code .hljs-string, pre code .hljs-keyword').length).toBeGreaterThan(0);
  });

  it('each code block has its own Copy button that copies the plain code', async () => {
    const spy = writeText();
    render(<Markdown source={['```ts', 'const answer = 42;', '```'].join('\n')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('const answer = 42;\n'));
  });
});
