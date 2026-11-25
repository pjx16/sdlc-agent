import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRichText } from './rich-text';

const show = (text: string) => render(<p>{renderRichText(text)}</p>);

describe('renderRichText', () => {
  it('turns a URL into a link that opens in a new tab', () => {
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
